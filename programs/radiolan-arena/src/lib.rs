//! Radio LAN arena: optional fan support positions (Pinocchio).
//!
//! The arena itself is free to play; nothing here gates participation.
//! A fan may commit tokens of the arena's mint to back a streamer. Each fan's tokens
//! sit in their own program-owned Token-2022 account, PDA `["support", arena, fan]`, whose
//! token authority is the fan's position PDA `["position", arena, fan]`. No instruction moves
//! those tokens anywhere except back to that fan.
//!
//! Withdrawal: the fan requests at any time; the tokens release once the season the request
//! was made in has ended. If the streamer closes the arena, every position releases at once.
//! Depositing again cancels a pending request (the fan chose to stay).
//!
//! The accepted mint is set when the arena is created: Token-2022 only, no freeze authority,
//! and no extensions except the metadata pointer and token metadata, so a deposit lands 1:1
//! (no transfer fee, no hook, no permanent delegate). `$RLAN` passes; a classic SPL mint is
//! refused.

#![cfg_attr(not(test), no_std)]

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    program_error::ProgramError,
    pubkey::{self, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

/// 5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf
pub const ID: Pubkey = [
    0x40, 0xca, 0xee, 0x22, 0x50, 0xee, 0x59, 0x3f, 0x61, 0x0d, 0x46, 0x72, 0xaf, 0x1e, 0xee, 0x0a,
    0xc8, 0xfb, 0xba, 0x4a, 0x1e, 0x6a, 0x51, 0x03, 0xa3, 0xad, 0x97, 0x7e, 0xaa, 0x69, 0xb6, 0xae,
];
/// Token-2022, TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
pub const TOKEN_2022_ID: Pubkey = [
    0x06, 0xdd, 0xf6, 0xe1, 0xee, 0x75, 0x8f, 0xde, 0x18, 0x42, 0x5d, 0xbc, 0xe4, 0x6c, 0xcd, 0xda,
    0xb6, 0x1a, 0xfc, 0x4d, 0x83, 0xb9, 0x0d, 0x27, 0xfe, 0xbd, 0xf9, 0x28, 0xd8, 0xa1, 0x8b, 0xfc,
];
pub const SYSTEM_ID: Pubkey = [0u8; 32];

const ARENA_SEED: &[u8] = b"arena";
const POSITION_SEED: &[u8] = b"position";
const SUPPORT_SEED: &[u8] = b"support";
const ARENA_MAGIC: [u8; 8] = *b"RLARENA1";
const POSITION_MAGIC: [u8; 8] = *b"RLPOSIT1";
pub const ARENA_LEN: usize = 112;
pub const POSITION_LEN: usize = 104;
/// A Token-2022 account with no extensions; enough for mints that pass `check_mint`.
pub const TOKEN_ACCOUNT_LEN: usize = 165;
const MINT_BASE_LEN: usize = 82;
const ACCOUNT_TYPE_OFFSET: usize = 165;
const EXT_METADATA_POINTER: u16 = 18;
const EXT_TOKEN_METADATA: u16 = 19;
/// A Token-2022 multisig account is this long; it would pass the mint layout checks otherwise.
const MULTISIG_LEN: usize = 355;
/// Season length bounds: a streamer cannot hold a fan longer than one season after a request.
pub const MIN_SEASON_SECONDS: u64 = 60;
pub const MAX_SEASON_SECONDS: u64 = 28 * 86_400;


const ACTIVE: u8 = 0;
const REQUESTED: u8 = 1;

#[repr(u32)]
pub enum ArenaError {
    AlreadyExists = 6300,
    WrongAccount = 6301,
    BadMint = 6302,
    BadConfig = 6303,
    ArenaClosed = 6304,
    Locked = 6305,
    BadAmount = 6306,
    AlreadyRequested = 6307,
    BadTokenAccount = 6308,
    NotStreamer = 6309,
}
impl From<ArenaError> for ProgramError {
    fn from(e: ArenaError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::program_entrypoint!(process_instruction);
#[cfg(not(feature = "no-entrypoint"))]
pinocchio::default_allocator!();
#[cfg(not(feature = "no-entrypoint"))]
pinocchio::nostd_panic_handler!();

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if program_id != &ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (tag, rest) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => init_arena(accounts, rest),
        1 => deposit(accounts, rest),
        2 => request_withdraw(accounts),
        3 => withdraw(accounts, rest),
        4 => close_arena(accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn read<const N: usize>(data: &[u8], off: usize) -> Result<[u8; N], ProgramError> {
    let b = data.get(off..off + N).ok_or(ProgramError::InvalidInstructionData)?;
    let mut out = [0u8; N];
    out.copy_from_slice(b);
    Ok(out)
}
fn u64_at(d: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(d[off..off + 8].try_into().unwrap())
}
fn key_at(d: &[u8], off: usize) -> Pubkey {
    d[off..off + 32].try_into().unwrap()
}

/// Season index at `now`: 0 before `start` (the waiting period counts as its own season), then
/// 1 + one per `seconds`. A request made in season k releases when season k + 1 begins.
pub fn season_index(start: i64, seconds: u64, now: i64) -> u64 {
    if now < start || seconds == 0 {
        0
    } else {
        ((now as i128 - start as i128) as u64 / seconds).saturating_add(1)
    }
}

/// A Token-2022 mint a deposit can trust 1:1. Returns its decimals.
pub fn check_mint(d: &[u8]) -> Result<u8, ProgramError> {
    if d.len() < MINT_BASE_LEN || d.len() == MULTISIG_LEN || d[45] != 1 {
        return Err(ArenaError::BadMint.into());
    }
    // A freeze authority could freeze a support account and break the withdrawal promise.
    if d[46..50] != [0, 0, 0, 0] {
        return Err(ArenaError::BadMint.into());
    }
    if d.len() == MINT_BASE_LEN {
        return Ok(d[44]);
    }
    if d.len() <= ACCOUNT_TYPE_OFFSET || d[ACCOUNT_TYPE_OFFSET] != 1 || d[MINT_BASE_LEN..ACCOUNT_TYPE_OFFSET].iter().any(|b| *b != 0) {
        return Err(ArenaError::BadMint.into());
    }
    let mut i = ACCOUNT_TYPE_OFFSET + 1;
    while i + 4 <= d.len() {
        let kind = u16::from_le_bytes([d[i], d[i + 1]]);
        let len = u16::from_le_bytes([d[i + 2], d[i + 3]]) as usize;
        if kind == 0 {
            break;
        }
        if kind != EXT_METADATA_POINTER && kind != EXT_TOKEN_METADATA {
            return Err(ArenaError::BadMint.into());
        }
        i += 4 + len;
        if i > d.len() {
            return Err(ArenaError::BadMint.into());
        }
    }
    Ok(d[44])
}

pub struct Arena {
    pub bump: u8,
    pub decimals: u8,
    pub closed: bool,
    pub streamer: Pubkey,
    pub mint: Pubkey,
    pub season_start: i64,
    pub season_seconds: u64,
    pub positions: u64,
    pub total: u64,
}
impl Arena {
    fn load(ai: &AccountInfo) -> Result<Self, ProgramError> {
        if ai.owner() != &ID {
            return Err(ArenaError::WrongAccount.into());
        }
        let d = ai.try_borrow_data()?;
        if d.len() != ARENA_LEN || d[0..8] != ARENA_MAGIC {
            return Err(ArenaError::WrongAccount.into());
        }
        Ok(Arena {
            bump: d[8],
            decimals: d[9],
            closed: d[10] == 1,
            streamer: key_at(&d, 16),
            mint: key_at(&d, 48),
            season_start: u64_at(&d, 80) as i64,
            season_seconds: u64_at(&d, 88),
            positions: u64_at(&d, 96),
            total: u64_at(&d, 104),
        })
    }
    fn store(&self, ai: &AccountInfo) -> ProgramResult {
        let mut d = ai.try_borrow_mut_data()?;
        d[0..8].copy_from_slice(&ARENA_MAGIC);
        d[8] = self.bump;
        d[9] = self.decimals;
        d[10] = self.closed as u8;
        d[16..48].copy_from_slice(&self.streamer);
        d[48..80].copy_from_slice(&self.mint);
        d[80..88].copy_from_slice(&self.season_start.to_le_bytes());
        d[88..96].copy_from_slice(&self.season_seconds.to_le_bytes());
        d[96..104].copy_from_slice(&self.positions.to_le_bytes());
        d[104..112].copy_from_slice(&self.total.to_le_bytes());
        Ok(())
    }
    fn season(&self, now: i64) -> u64 {
        season_index(self.season_start, self.season_seconds, now)
    }
}

pub struct Position {
    pub bump: u8,
    pub support_bump: u8,
    pub state: u8,
    pub arena: Pubkey,
    pub fan: Pubkey,
    pub amount: u64,
    pub requested_season: u64,
    pub opened_at: i64,
}
impl Position {
    fn load(ai: &AccountInfo) -> Result<Self, ProgramError> {
        if ai.owner() != &ID {
            return Err(ArenaError::WrongAccount.into());
        }
        let d = ai.try_borrow_data()?;
        if d.len() != POSITION_LEN || d[0..8] != POSITION_MAGIC {
            return Err(ArenaError::WrongAccount.into());
        }
        Ok(Position {
            bump: d[8],
            support_bump: d[9],
            state: d[10],
            arena: key_at(&d, 16),
            fan: key_at(&d, 48),
            amount: u64_at(&d, 80),
            requested_season: u64_at(&d, 88),
            opened_at: u64_at(&d, 96) as i64,
        })
    }
    fn store(&self, ai: &AccountInfo) -> ProgramResult {
        let mut d = ai.try_borrow_mut_data()?;
        d[0..8].copy_from_slice(&POSITION_MAGIC);
        d[8] = self.bump;
        d[9] = self.support_bump;
        d[10] = self.state;
        d[16..48].copy_from_slice(&self.arena);
        d[48..80].copy_from_slice(&self.fan);
        d[80..88].copy_from_slice(&self.amount.to_le_bytes());
        d[88..96].copy_from_slice(&self.requested_season.to_le_bytes());
        d[96..104].copy_from_slice(&self.opened_at.to_le_bytes());
        Ok(())
    }
}

/// Create the PDA `target` owned by `owner`. An address that already holds lamports but no data
/// (anyone can send lamports to it) is topped up, allocated and assigned instead of refused.
fn create_pda(payer: &AccountInfo, target: &AccountInfo, space: usize, owner: &Pubkey, seeds: &[Seed]) -> ProgramResult {
    if target.owner() != &SYSTEM_ID || target.data_len() != 0 {
        return Err(ArenaError::AlreadyExists.into());
    }
    let rent = Rent::get()?.minimum_balance(space);
    let signer = [Signer::from(seeds)];
    let have = target.lamports();
    if have == 0 {
        let mut data = [0u8; 52];
        data[4..12].copy_from_slice(&rent.to_le_bytes());
        data[12..20].copy_from_slice(&(space as u64).to_le_bytes());
        data[20..52].copy_from_slice(owner);
        let metas = [AccountMeta::writable_signer(payer.key()), AccountMeta::writable_signer(target.key())];
        let ix = Instruction { program_id: &SYSTEM_ID, accounts: &metas, data: &data };
        return pinocchio::cpi::slice_invoke_signed(&ix, &[payer, target], &signer);
    }
    if have < rent {
        let mut data = [0u8; 12];
        data[0] = 2; // Transfer
        data[4..12].copy_from_slice(&(rent - have).to_le_bytes());
        let metas = [AccountMeta::writable_signer(payer.key()), AccountMeta::writable(target.key())];
        let ix = Instruction { program_id: &SYSTEM_ID, accounts: &metas, data: &data };
        pinocchio::cpi::slice_invoke(&ix, &[payer, target])?;
    }
    let metas = [AccountMeta::writable_signer(target.key())];
    let mut allocate = [0u8; 12];
    allocate[0] = 8; // Allocate
    allocate[4..12].copy_from_slice(&(space as u64).to_le_bytes());
    let ix = Instruction { program_id: &SYSTEM_ID, accounts: &metas, data: &allocate };
    pinocchio::cpi::slice_invoke_signed(&ix, &[target], &signer)?;
    let mut assign = [0u8; 36];
    assign[0] = 1; // Assign
    assign[4..36].copy_from_slice(owner);
    let ix = Instruction { program_id: &SYSTEM_ID, accounts: &metas, data: &assign };
    pinocchio::cpi::slice_invoke_signed(&ix, &[target], &signer)
}

/// Token-2022 TransferChecked (12).
fn transfer_checked(from: &AccountInfo, mint: &AccountInfo, to: &AccountInfo, authority: &AccountInfo, amount: u64, decimals: u8, signer: &[Signer]) -> ProgramResult {
    let mut data = [0u8; 10];
    data[0] = 12;
    data[1..9].copy_from_slice(&amount.to_le_bytes());
    data[9] = decimals;
    let metas = [AccountMeta::writable(from.key()), AccountMeta::readonly(mint.key()), AccountMeta::writable(to.key()), AccountMeta::readonly_signer(authority.key())];
    let ix = Instruction { program_id: &TOKEN_2022_ID, accounts: &metas, data: &data };
    pinocchio::cpi::slice_invoke_signed(&ix, &[from, mint, to, authority], signer)
}

/// A Token-2022 account for `mint`, owned by `owner`, initialized. Returns its balance.
fn token_account(ai: &AccountInfo, mint: &Pubkey, owner: &Pubkey) -> Result<u64, ProgramError> {
    if ai.owner() != &TOKEN_2022_ID {
        return Err(ArenaError::BadTokenAccount.into());
    }
    let d = ai.try_borrow_data()?;
    if d.len() < TOKEN_ACCOUNT_LEN || (d.len() > TOKEN_ACCOUNT_LEN && d[ACCOUNT_TYPE_OFFSET] != 2) {
        return Err(ArenaError::BadTokenAccount.into());
    }
    if &d[0..32] != mint || &d[32..64] != owner || d[108] != 1 {
        return Err(ArenaError::BadTokenAccount.into());
    }
    Ok(u64_at(&d, 64))
}

fn now() -> Result<i64, ProgramError> {
    Ok(Clock::get()?.unix_timestamp)
}

/// Accounts: [streamer (signer, writable), arena PDA ["arena", streamer, mint] (writable), mint, system]
/// Data: [season_start i64][season_seconds u64]
fn init_arena(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [streamer, arena_ai, mint, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !streamer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.key() != &SYSTEM_ID || mint.owner() != &TOKEN_2022_ID {
        return Err(ArenaError::BadMint.into());
    }
    let decimals = check_mint(&mint.try_borrow_data()?)?;
    let season_start = i64::from_le_bytes(read::<8>(data, 0)?);
    let season_seconds = u64::from_le_bytes(read::<8>(data, 8)?);
    // Bounded so a streamer cannot choose settings that keep a requested withdrawal locked longer than
    // one season: a season lasts a minute to four weeks, and the first starts within one season.
    let created = now()?;
    if data.len() != 16
        || !(MIN_SEASON_SECONDS..=MAX_SEASON_SECONDS).contains(&season_seconds)
        || season_start > created.saturating_add(season_seconds as i64)
        || season_start < created.saturating_sub(365 * 86_400)
    {
        return Err(ArenaError::BadConfig.into());
    }
    let (arena_key, bump) = pubkey::find_program_address(&[ARENA_SEED, streamer.key(), mint.key()], &ID);
    if arena_ai.key() != &arena_key {
        return Err(ArenaError::WrongAccount.into());
    }
    let b = [bump];
    create_pda(streamer, arena_ai, ARENA_LEN, &ID, &[Seed::from(ARENA_SEED), Seed::from(streamer.key().as_ref()), Seed::from(mint.key().as_ref()), Seed::from(b.as_ref())])?;
    Arena { bump, decimals, closed: false, streamer: *streamer.key(), mint: *mint.key(), season_start, season_seconds, positions: 0, total: 0 }.store(arena_ai)
}

/// Accounts: [fan (signer, writable), arena (writable), position PDA (writable), support PDA (writable),
///            fan's source token account (writable), mint, token-2022, system]
/// Data: [amount u64]
fn deposit(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [fan, arena_ai, position_ai, support_ai, source, mint, token, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !fan.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if token.key() != &TOKEN_2022_ID || system.key() != &SYSTEM_ID {
        return Err(ArenaError::WrongAccount.into());
    }
    let mut arena = Arena::load(arena_ai)?;
    if mint.key() != &arena.mint {
        return Err(ArenaError::BadMint.into());
    }
    if arena.closed {
        return Err(ArenaError::ArenaClosed.into());
    }
    let amount = u64::from_le_bytes(read::<8>(data, 0)?);
    if amount == 0 || data.len() != 8 {
        return Err(ArenaError::BadAmount.into());
    }
    let (position_key, bump) = pubkey::find_program_address(&[POSITION_SEED, arena_ai.key(), fan.key()], &ID);
    let (support_key, support_bump) = pubkey::find_program_address(&[SUPPORT_SEED, arena_ai.key(), fan.key()], &ID);
    if position_ai.key() != &position_key || support_ai.key() != &support_key {
        return Err(ArenaError::WrongAccount.into());
    }
    let mut position = if position_ai.owner() == &ID {
        let p = Position::load(position_ai)?;
        if &p.arena != arena_ai.key() || &p.fan != fan.key() {
            return Err(ArenaError::WrongAccount.into());
        }
        p
    } else {
        let pb = [bump];
        create_pda(fan, position_ai, POSITION_LEN, &ID, &[Seed::from(POSITION_SEED), Seed::from(arena_ai.key().as_ref()), Seed::from(fan.key().as_ref()), Seed::from(pb.as_ref())])?;
        let sb = [support_bump];
        create_pda(fan, support_ai, TOKEN_ACCOUNT_LEN, &TOKEN_2022_ID, &[Seed::from(SUPPORT_SEED), Seed::from(arena_ai.key().as_ref()), Seed::from(fan.key().as_ref()), Seed::from(sb.as_ref())])?;
        // InitializeAccount3 (18): the position PDA is the support account's token authority.
        let mut init = [0u8; 33];
        init[0] = 18;
        init[1..33].copy_from_slice(&position_key);
        let metas = [AccountMeta::writable(support_ai.key()), AccountMeta::readonly(mint.key())];
        let ix = Instruction { program_id: &TOKEN_2022_ID, accounts: &metas, data: &init };
        pinocchio::cpi::slice_invoke(&ix, &[support_ai, mint])?;
        arena.positions = arena.positions.checked_add(1).ok_or(ArenaError::BadAmount)?;
        Position { bump, support_bump, state: ACTIVE, arena: *arena_ai.key(), fan: *fan.key(), amount: 0, requested_season: 0, opened_at: now()? }
    };
    transfer_checked(source, mint, support_ai, fan, amount, arena.decimals, &[])?;
    position.amount = position.amount.checked_add(amount).ok_or(ArenaError::BadAmount)?;
    position.state = ACTIVE;
    position.requested_season = 0;
    arena.total = arena.total.checked_add(amount).ok_or(ArenaError::BadAmount)?;
    position.store(position_ai)?;
    arena.store(arena_ai)
}

/// Accounts: [fan (signer), arena, position (writable)]
fn request_withdraw(accounts: &[AccountInfo]) -> ProgramResult {
    let [fan, arena_ai, position_ai] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !fan.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let arena = Arena::load(arena_ai)?;
    let mut position = Position::load(position_ai)?;
    if &position.arena != arena_ai.key() || &position.fan != fan.key() {
        return Err(ArenaError::WrongAccount.into());
    }
    if position.state == REQUESTED {
        return Err(ArenaError::AlreadyRequested.into());
    }
    position.state = REQUESTED;
    position.requested_season = arena.season(now()?);
    position.store(position_ai)
}

/// Accounts: [fan (signer, writable), arena (writable), position (writable), support (writable),
///            destination token account owned by the fan (writable), mint, token-2022]
/// Data: [amount u64]. Withdrawing the whole position also sends anything others sent to the
/// support account, closes it and the position, and returns both rents to the fan.
fn withdraw(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [fan, arena_ai, position_ai, support_ai, dest, mint, token] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !fan.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if token.key() != &TOKEN_2022_ID {
        return Err(ArenaError::WrongAccount.into());
    }
    let mut arena = Arena::load(arena_ai)?;
    if mint.key() != &arena.mint {
        return Err(ArenaError::BadMint.into());
    }
    let mut position = Position::load(position_ai)?;
    if &position.arena != arena_ai.key() || &position.fan != fan.key() {
        return Err(ArenaError::WrongAccount.into());
    }
    let pb = [position.bump];
    let position_seeds = [Seed::from(POSITION_SEED), Seed::from(arena_ai.key().as_ref()), Seed::from(fan.key().as_ref()), Seed::from(pb.as_ref())];
    if position_ai.key() != &pubkey::create_program_address(&[POSITION_SEED, arena_ai.key(), fan.key(), &pb], &ID)? {
        return Err(ArenaError::WrongAccount.into());
    }
    if support_ai.key() != &pubkey::create_program_address(&[SUPPORT_SEED, arena_ai.key(), fan.key(), &[position.support_bump]], &ID)? {
        return Err(ArenaError::WrongAccount.into());
    }
    let unlocked = arena.closed || (position.state == REQUESTED && arena.season(now()?) > position.requested_season);
    if !unlocked {
        return Err(ArenaError::Locked.into());
    }
    let amount = u64::from_le_bytes(read::<8>(data, 0)?);
    if amount == 0 || amount > position.amount || data.len() != 8 {
        return Err(ArenaError::BadAmount.into());
    }
    token_account(dest, &arena.mint, fan.key())?;
    let held = token_account(support_ai, &arena.mint, position_ai.key())?;
    if held < position.amount {
        return Err(ArenaError::BadTokenAccount.into());
    }
    let full = amount == position.amount;
    let send = if full { held } else { amount };
    let signer = [Signer::from(&position_seeds)];
    transfer_checked(support_ai, mint, dest, position_ai, send, arena.decimals, &signer)?;
    position.amount -= amount;
    arena.total = arena.total.checked_sub(amount).ok_or(ArenaError::BadAmount)?;
    if !full {
        position.store(position_ai)?;
        return arena.store(arena_ai);
    }
    // CloseAccount (9): the support account's rent goes to the fan.
    let metas = [AccountMeta::writable(support_ai.key()), AccountMeta::writable(fan.key()), AccountMeta::readonly_signer(position_ai.key())];
    let ix = Instruction { program_id: &TOKEN_2022_ID, accounts: &metas, data: &[9] };
    pinocchio::cpi::slice_invoke_signed(&ix, &[support_ai, fan, position_ai], &signer)?;
    {
        let lamports = position_ai.lamports();
        *fan.try_borrow_mut_lamports()? = fan.lamports().checked_add(lamports).ok_or(ArenaError::BadAmount)?;
        *position_ai.try_borrow_mut_lamports()? = 0;
    }
    position_ai.close()?;
    arena.positions = arena.positions.checked_sub(1).ok_or(ArenaError::BadAmount)?;
    arena.store(arena_ai)
}

/// Accounts: [streamer (signer), arena (writable)]. Irreversible: every position releases at once
/// and no deposit is accepted.
fn close_arena(accounts: &[AccountInfo]) -> ProgramResult {
    let [streamer, arena_ai] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !streamer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut arena = Arena::load(arena_ai)?;
    if &arena.streamer != streamer.key() {
        return Err(ArenaError::NotStreamer.into());
    }
    if arena.closed {
        return Err(ArenaError::ArenaClosed.into());
    }
    arena.closed = true;
    arena.store(arena_ai)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mint(freeze: bool, exts: &[(u16, usize)]) -> std::vec::Vec<u8> {
        let mut d = std::vec![0u8; MINT_BASE_LEN];
        d[44] = 6;
        d[45] = 1;
        if freeze {
            d[46] = 1;
        }
        if !exts.is_empty() {
            d.resize(ACCOUNT_TYPE_OFFSET + 1, 0);
            d[ACCOUNT_TYPE_OFFSET] = 1;
            for (kind, len) in exts {
                d.extend_from_slice(&kind.to_le_bytes());
                d.extend_from_slice(&(*len as u16).to_le_bytes());
                d.extend(std::iter::repeat(7u8).take(*len));
            }
        }
        d
    }

    #[test]
    fn mints_with_only_metadata_extensions_pass() {
        assert_eq!(check_mint(&mint(false, &[])).ok(), Some(6));
        assert_eq!(check_mint(&mint(false, &[(18, 64), (19, 173)])).ok(), Some(6));
    }

    #[test]
    fn freeze_authority_fees_hooks_and_delegates_are_refused() {
        assert!(check_mint(&mint(true, &[])).is_err());
        for kind in [1u16, 3, 6, 9, 12, 14, 20] {
            assert!(check_mint(&mint(false, &[(18, 64), (kind, 8)])).is_err(), "extension {kind}");
        }
        let mut uninit = mint(false, &[]);
        uninit[45] = 0;
        assert!(check_mint(&uninit).is_err());
        let mut truncated = mint(false, &[(19, 40)]);
        truncated.truncate(truncated.len() - 1);
        assert!(check_mint(&truncated).is_err());
    }

    #[test]
    fn extreme_times_do_not_overflow() {
        assert_eq!(season_index(i64::MIN, 60, i64::MAX), u64::MAX / 60 + 1);
        assert_eq!(season_index(0, u64::MAX, i64::MAX), 1);
        assert_eq!(season_index(5, 0, 10), 0);
    }

    #[test]
    fn a_multisig_shaped_account_is_not_a_mint() {
        let mut d = std::vec![0u8; MULTISIG_LEN];
        d[45] = 1;
        assert!(check_mint(&d).is_err());
    }

    #[test]
    fn seasons_count_from_the_start() {
        assert_eq!(season_index(1000, 100, 0), 0);
        assert_eq!(season_index(1000, 100, 999), 0);
        assert_eq!(season_index(1000, 100, 1000), 1);
        assert_eq!(season_index(1000, 100, 1099), 1);
        assert_eq!(season_index(1000, 100, 1100), 2);
        assert_eq!(season_index(1000, 604_800, 1000 + 3 * 604_800 + 5), 4);
    }
}
