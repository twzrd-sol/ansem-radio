//! radiolan-arena against the Token-2022 program LiteSVM ships with. Each test checks the spec's
//! invariants after every step: each support account holds at
//! least its position's amount (exactly, unless someone else sent tokens in), and the arena's total
//! equals the sum of its positions.
//!
//! Run: (cd .. && cargo build-sbf) && cargo test

use base64::Engine;
use litesvm::LiteSVM;
use serde_json::Value;
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_sdk::pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::Path;

const ARENA_ID: &str = "5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf";
const T22: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const WEEK: u64 = 604_800;
const START: i64 = 1_790_000_000;
const DECIMALS: u8 = 6;

fn a(s: &str) -> Address {
    Address::from(s.parse::<Pubkey>().unwrap().to_bytes())
}
fn pda(seeds: &[&[u8]]) -> Address {
    Address::from(Pubkey::find_program_address(seeds, &ARENA_ID.parse().unwrap()).0.to_bytes())
}
fn err_code(e: &str, code: u32) -> bool {
    e.contains(&format!("Custom({code})"))
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
    svm.expire_blockhash();
    let msg = Message::new(ixs, Some(&signers[0].pubkey()));
    let tx = Transaction::new(signers, msg, svm.latest_blockhash());
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err))
}
fn create_ix(payer: &Address, account: &Address, lamports: u64, space: u64, owner: &Address) -> Instruction {
    let mut data = vec![0u8; 52];
    data[4..12].copy_from_slice(&lamports.to_le_bytes());
    data[12..20].copy_from_slice(&space.to_le_bytes());
    data[20..52].copy_from_slice(owner.as_ref());
    Instruction { program_id: Address::default(), accounts: vec![AccountMeta::new(*payer, true), AccountMeta::new(*account, true)], data }
}
fn set_time(svm: &mut LiteSVM, t: i64) {
    let mut clock = svm.get_sysvar::<solana_clock::Clock>();
    clock.unix_timestamp = t;
    svm.set_sysvar(&clock);
}
fn token_amount(svm: &LiteSVM, k: &Address) -> u64 {
    svm.get_account(k).map(|acct| u64::from_le_bytes(acct.data[64..72].try_into().unwrap())).unwrap_or(0)
}
fn exists(svm: &LiteSVM, k: &Address) -> bool {
    svm.get_account(k).map(|acct| acct.lamports > 0).unwrap_or(false)
}
fn arena_field(svm: &LiteSVM, arena: &Address, off: usize) -> u64 {
    u64::from_le_bytes(svm.get_account(arena).unwrap().data[off..off + 8].try_into().unwrap())
}
fn position_amount(svm: &LiteSVM, position: &Address) -> u64 {
    svm.get_account(position).filter(|acct| acct.lamports > 0).map(|acct| u64::from_le_bytes(acct.data[80..88].try_into().unwrap())).unwrap_or(0)
}

/// Token-2022 mint with no freeze authority, `authority` mints.
fn new_mint(svm: &mut LiteSVM, payer: &Keypair, program: &Address) -> Keypair {
    let mint = Keypair::new();
    let lamports = svm.minimum_balance_for_rent_exemption(82);
    let mut init = vec![20u8, DECIMALS];
    init.extend_from_slice(payer.pubkey().as_ref());
    init.push(0);
    let ix = Instruction { program_id: *program, accounts: vec![AccountMeta::new(mint.pubkey(), false)], data: init };
    send(svm, &[create_ix(&payer.pubkey(), &mint.pubkey(), lamports, 82, program), ix], &[payer, &mint]).unwrap();
    mint
}
fn new_token_account(svm: &mut LiteSVM, payer: &Keypair, mint: &Address, owner: &Address) -> Address {
    let acct = Keypair::new();
    let lamports = svm.minimum_balance_for_rent_exemption(165);
    let mut init = vec![18u8];
    init.extend_from_slice(owner.as_ref());
    let ix = Instruction { program_id: a(T22), accounts: vec![AccountMeta::new(acct.pubkey(), false), AccountMeta::new_readonly(*mint, false)], data: init };
    send(svm, &[create_ix(&payer.pubkey(), &acct.pubkey(), lamports, 165, &a(T22)), ix], &[payer, &acct]).unwrap();
    acct.pubkey()
}
fn mint_to(svm: &mut LiteSVM, authority: &Keypair, mint: &Address, dest: &Address, amount: u64) {
    let mut data = vec![7u8];
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction { program_id: a(T22), accounts: vec![AccountMeta::new(*mint, false), AccountMeta::new(*dest, false), AccountMeta::new_readonly(authority.pubkey(), true)], data };
    send(svm, &[ix], &[authority]).unwrap();
}
fn transfer_ix(from: &Address, mint: &Address, to: &Address, owner: &Address, amount: u64) -> Instruction {
    let mut data = vec![12u8];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(DECIMALS);
    Instruction { program_id: a(T22), accounts: vec![AccountMeta::new(*from, false), AccountMeta::new_readonly(*mint, false), AccountMeta::new(*to, false), AccountMeta::new_readonly(*owner, true)], data }
}

struct Fan {
    key: Keypair,
    wallet: Address,
    position: Address,
    support: Address,
}

struct World {
    svm: LiteSVM,
    streamer: Keypair,
    mint: Address,
    arena: Address,
    fans: Vec<Fan>,
}

impl World {
    fn new(fans: usize) -> World {
        let mut svm = LiteSVM::new();
        let so = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/deploy/radiolan_arena.so");
        assert!(so.exists(), "run cargo build-sbf in programs/radiolan-arena first");
        svm.add_program(a(ARENA_ID), &std::fs::read(so).unwrap()).unwrap();
        set_time(&mut svm, START);
        let streamer = Keypair::new();
        svm.airdrop(&streamer.pubkey(), 10_000_000_000).unwrap();
        let mint = new_mint(&mut svm, &streamer, &a(T22)).pubkey();
        let arena = pda(&[b"arena", streamer.pubkey().as_ref(), mint.as_ref()]);
        let mut w = World { svm, streamer, mint, arena, fans: vec![] };
        w.init_arena(START, WEEK).unwrap();
        for _ in 0..fans {
            let key = Keypair::new();
            w.svm.airdrop(&key.pubkey(), 1_000_000_000).unwrap();
            let wallet = new_token_account(&mut w.svm, &w.streamer, &mint, &key.pubkey());
            mint_to(&mut w.svm, &w.streamer, &mint, &wallet, 1_000_000_000);
            let position = pda(&[b"position", arena.as_ref(), key.pubkey().as_ref()]);
            let support = pda(&[b"support", arena.as_ref(), key.pubkey().as_ref()]);
            w.fans.push(Fan { key, wallet, position, support });
        }
        w
    }
    fn init_arena(&mut self, start: i64, seconds: u64) -> Result<(), String> {
        let mut data = vec![0u8];
        data.extend_from_slice(&start.to_le_bytes());
        data.extend_from_slice(&seconds.to_le_bytes());
        let ix = Instruction {
            program_id: a(ARENA_ID),
            accounts: vec![AccountMeta::new(self.streamer.pubkey(), true), AccountMeta::new(self.arena, false), AccountMeta::new_readonly(self.mint, false), AccountMeta::new_readonly(Address::default(), false)],
            data,
        };
        send(&mut self.svm, &[ix], &[&self.streamer])
    }
    fn deposit_ix(&self, i: usize, amount: u64) -> Instruction {
        let f = &self.fans[i];
        let mut data = vec![1u8];
        data.extend_from_slice(&amount.to_le_bytes());
        Instruction {
            program_id: a(ARENA_ID),
            accounts: vec![
                AccountMeta::new(f.key.pubkey(), true),
                AccountMeta::new(self.arena, false),
                AccountMeta::new(f.position, false),
                AccountMeta::new(f.support, false),
                AccountMeta::new(f.wallet, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new_readonly(a(T22), false),
                AccountMeta::new_readonly(Address::default(), false),
            ],
            data,
        }
    }
    fn deposit(&mut self, i: usize, amount: u64) -> Result<(), String> {
        let ix = self.deposit_ix(i, amount);
        let r = send(&mut self.svm, &[ix], &[&self.fans[i].key]);
        self.check();
        r
    }
    fn request(&mut self, i: usize) -> Result<(), String> {
        let f = &self.fans[i];
        let ix = Instruction {
            program_id: a(ARENA_ID),
            accounts: vec![AccountMeta::new_readonly(f.key.pubkey(), true), AccountMeta::new_readonly(self.arena, false), AccountMeta::new(f.position, false)],
            data: vec![2],
        };
        let r = send(&mut self.svm, &[ix], &[&self.fans[i].key]);
        self.check();
        r
    }
    fn withdraw_ix(&self, signer: &Address, position: &Address, support: &Address, dest: &Address, amount: u64) -> Instruction {
        let mut data = vec![3u8];
        data.extend_from_slice(&amount.to_le_bytes());
        Instruction {
            program_id: a(ARENA_ID),
            accounts: vec![
                AccountMeta::new(*signer, true),
                AccountMeta::new(self.arena, false),
                AccountMeta::new(*position, false),
                AccountMeta::new(*support, false),
                AccountMeta::new(*dest, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new_readonly(a(T22), false),
            ],
            data,
        }
    }
    fn withdraw(&mut self, i: usize, amount: u64) -> Result<(), String> {
        let f = &self.fans[i];
        let ix = self.withdraw_ix(&f.key.pubkey(), &f.position, &f.support, &f.wallet, amount);
        let r = send(&mut self.svm, &[ix], &[&self.fans[i].key]);
        self.check();
        r
    }
    fn close_arena(&mut self, signer: &Keypair) -> Result<(), String> {
        let ix = Instruction { program_id: a(ARENA_ID), accounts: vec![AccountMeta::new_readonly(signer.pubkey(), true), AccountMeta::new(self.arena, false)], data: vec![4] };
        send(&mut self.svm, &[ix], &[signer])
    }
    /// Invariants 1 and the arena total, after every step.
    fn check(&self) {
        let mut sum = 0;
        for f in &self.fans {
            let recorded = position_amount(&self.svm, &f.position);
            assert!(token_amount(&self.svm, &f.support) >= recorded, "support account holds less than its position");
            sum += recorded;
        }
        assert_eq!(arena_field(&self.svm, &self.arena, 104), sum, "arena total equals the sum of positions");
        let open = self.fans.iter().filter(|f| exists(&self.svm, &f.position)).count() as u64;
        assert_eq!(arena_field(&self.svm, &self.arena, 96), open, "arena counts its open positions");
    }
}

#[test]
fn the_real_rlan_mint_is_accepted_and_classic_or_frozen_mints_are_refused() {
    let mut w = World::new(0);
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/rlan-mint-mainnet.json")).unwrap()).unwrap();
    let data = base64::engine::general_purpose::STANDARD.decode(fixture["data_base64"].as_str().unwrap()).unwrap();
    let rlan = a(fixture["address"].as_str().unwrap());
    w.svm.set_account(rlan, Account { lamports: fixture["lamports"].as_u64().unwrap(), data, owner: a(T22), executable: false, rent_epoch: 0 }).unwrap();
    w.mint = rlan;
    w.arena = pda(&[b"arena", w.streamer.pubkey().as_ref(), rlan.as_ref()]);
    w.init_arena(START, WEEK).expect("$RLAN as it is on mainnet passes the mint check");
    assert_eq!(w.svm.get_account(&w.arena).unwrap().data[9], 6);

    let classic = new_mint(&mut w.svm, &w.streamer, &a(TOKEN)).pubkey();
    w.mint = classic;
    w.arena = pda(&[b"arena", w.streamer.pubkey().as_ref(), classic.as_ref()]);
    assert!(err_code(&w.init_arena(START, WEEK).unwrap_err(), 6302), "classic SPL mint refused");

    let frozen = Keypair::new();
    let lamports = w.svm.minimum_balance_for_rent_exemption(82);
    let mut init = vec![20u8, DECIMALS];
    init.extend_from_slice(w.streamer.pubkey().as_ref());
    init.push(1);
    init.extend_from_slice(w.streamer.pubkey().as_ref());
    let ix = Instruction { program_id: a(T22), accounts: vec![AccountMeta::new(frozen.pubkey(), false)], data: init };
    let streamer = w.streamer.insecure_clone();
    send(&mut w.svm, &[create_ix(&streamer.pubkey(), &frozen.pubkey(), lamports, 82, &a(T22)), ix], &[&streamer, &frozen]).unwrap();
    w.mint = frozen.pubkey();
    w.arena = pda(&[b"arena", w.streamer.pubkey().as_ref(), frozen.pubkey().as_ref()]);
    assert!(err_code(&w.init_arena(START, WEEK).unwrap_err(), 6302), "mint with a freeze authority refused");

    w.mint = rlan;
    w.arena = pda(&[b"arena", w.streamer.pubkey().as_ref(), rlan.as_ref()]);
    assert!(err_code(&w.init_arena(START, WEEK).unwrap_err(), 6300), "an arena is created once");
}

#[test]
fn deposits_land_one_to_one_in_the_fans_own_account() {
    let mut w = World::new(2);
    w.deposit(0, 1_000_000).unwrap();
    w.deposit(0, 250_000).unwrap();
    w.deposit(1, 7).unwrap();
    assert_eq!(token_amount(&w.svm, &w.fans[0].support), 1_250_000);
    assert_eq!(position_amount(&w.svm, &w.fans[0].position), 1_250_000);
    assert_eq!(token_amount(&w.svm, &w.fans[0].wallet), 1_000_000_000 - 1_250_000);
    assert_eq!(token_amount(&w.svm, &w.fans[1].support), 7);
    assert_eq!(arena_field(&w.svm, &w.arena, 96), 2, "two positions");
    // The support account's token authority is the position PDA, not the fan or the streamer.
    let support = w.svm.get_account(&w.fans[0].support).unwrap();
    assert_eq!(support.owner, a(T22));
    assert_eq!(&support.data[32..64], w.fans[0].position.as_ref());
    assert!(err_code(&w.deposit(0, 0).unwrap_err(), 6306), "zero deposit refused");
}

#[test]
fn a_withdrawal_releases_only_after_the_season_it_was_requested_in() {
    let mut w = World::new(1);
    w.deposit(0, 1_000_000).unwrap();
    assert!(err_code(&w.withdraw(0, 1).unwrap_err(), 6305), "locked before any request");
    set_time(&mut w.svm, START + 3 * 86_400);
    w.request(0).unwrap();
    assert!(err_code(&w.request(0).unwrap_err(), 6307), "one request at a time");
    set_time(&mut w.svm, START + WEEK as i64 - 1);
    assert!(err_code(&w.withdraw(0, 1).unwrap_err(), 6305), "still the same season");
    set_time(&mut w.svm, START + WEEK as i64);
    assert!(err_code(&w.withdraw(0, 1_000_001).unwrap_err(), 6306), "more than the position");
    w.withdraw(0, 400_000).unwrap();
    assert_eq!(position_amount(&w.svm, &w.fans[0].position), 600_000);
    assert_eq!(token_amount(&w.svm, &w.fans[0].wallet), 1_000_000_000 - 600_000);
    // Still released: the rest can follow later in the same or any later season.
    set_time(&mut w.svm, START + 5 * WEEK as i64);
    w.withdraw(0, 600_000).unwrap();
    assert_eq!(token_amount(&w.svm, &w.fans[0].wallet), 1_000_000_000);
}

#[test]
fn a_full_withdrawal_closes_both_accounts_and_returns_the_rent() {
    let mut w = World::new(1);
    let before = w.svm.get_balance(&w.fans[0].key.pubkey()).unwrap();
    w.deposit(0, 5_000).unwrap();
    w.request(0).unwrap();
    set_time(&mut w.svm, START + WEEK as i64 + 1);
    w.withdraw(0, 5_000).unwrap();
    assert!(!exists(&w.svm, &w.fans[0].position) && !exists(&w.svm, &w.fans[0].support), "both accounts closed");
    assert_eq!(arena_field(&w.svm, &w.arena, 96), 0);
    let after = w.svm.get_balance(&w.fans[0].key.pubkey()).unwrap();
    assert!(before - after < 50_000, "only transaction fees were spent, rent came back: {}", before - after);
    // The fan can come back: a new deposit opens a fresh position.
    w.deposit(0, 9).unwrap();
    assert_eq!(position_amount(&w.svm, &w.fans[0].position), 9);
}

#[test]
fn depositing_again_cancels_a_pending_request() {
    let mut w = World::new(1);
    w.deposit(0, 100).unwrap();
    w.request(0).unwrap();
    w.deposit(0, 1).unwrap();
    set_time(&mut w.svm, START + 2 * WEEK as i64);
    assert!(err_code(&w.withdraw(0, 1).unwrap_err(), 6305), "the fan chose to stay; a new request is needed");
    w.request(0).unwrap();
    set_time(&mut w.svm, START + 3 * WEEK as i64);
    w.withdraw(0, 101).unwrap();
}

#[test]
fn nobody_else_can_move_a_fans_tokens() {
    let mut w = World::new(2);
    w.deposit(0, 1_000).unwrap();
    w.request(0).unwrap();
    set_time(&mut w.svm, START + WEEK as i64);
    let (victim_position, victim_support) = (w.fans[0].position, w.fans[0].support);
    let thief = w.fans[1].key.insecure_clone();
    let thief_wallet = w.fans[1].wallet;
    // Fan 1 signs for fan 0's position, paying to their own wallet.
    let ix = w.withdraw_ix(&thief.pubkey(), &victim_position, &victim_support, &thief_wallet, 1_000);
    assert!(err_code(&send(&mut w.svm, &[ix], &[&thief]).unwrap_err(), 6301));
    // Fan 0 cannot send to someone else's wallet either.
    let victim = w.fans[0].key.insecure_clone();
    let ix = w.withdraw_ix(&victim.pubkey(), &victim_position, &victim_support, &thief_wallet, 1_000);
    assert!(err_code(&send(&mut w.svm, &[ix], &[&victim]).unwrap_err(), 6308));
    // The streamer cannot withdraw it.
    let streamer = w.streamer.insecure_clone();
    let streamer_wallet = new_token_account(&mut w.svm, &streamer, &w.mint, &streamer.pubkey());
    let ix = w.withdraw_ix(&streamer.pubkey(), &victim_position, &victim_support, &streamer_wallet, 1_000);
    assert!(err_code(&send(&mut w.svm, &[ix], &[&streamer]).unwrap_err(), 6301));
    // A direct Token-2022 transfer out of the support account needs the position PDA's signature.
    let ix = transfer_ix(&victim_support, &w.mint, &thief_wallet, &thief.pubkey(), 1_000);
    assert!(send(&mut w.svm, &[ix], &[&thief]).is_err());
    assert_eq!(token_amount(&w.svm, &victim_support), 1_000);
    w.check();
}

#[test]
fn closing_the_arena_releases_everyone_and_stops_deposits() {
    let mut w = World::new(2);
    w.deposit(0, 10).unwrap();
    w.deposit(1, 20).unwrap();
    let outsider = Keypair::new();
    w.svm.airdrop(&outsider.pubkey(), 1_000_000_000).unwrap();
    assert!(err_code(&w.close_arena(&outsider).unwrap_err(), 6309), "only the streamer closes");
    let streamer = w.streamer.insecure_clone();
    w.close_arena(&streamer).unwrap();
    assert!(err_code(&w.close_arena(&streamer).unwrap_err(), 6304));
    assert!(err_code(&w.deposit(0, 1).unwrap_err(), 6304), "no deposits after close");
    // No request and no season boundary needed.
    w.withdraw(0, 10).unwrap();
    w.withdraw(1, 5).unwrap();
    w.withdraw(1, 15).unwrap();
    assert_eq!(arena_field(&w.svm, &w.arena, 104), 0);
}

#[test]
fn tokens_someone_else_sends_in_go_to_the_fan_on_full_withdrawal() {
    let mut w = World::new(2);
    w.deposit(0, 1_000).unwrap();
    let donor = w.fans[1].key.insecure_clone();
    let ix = transfer_ix(&w.fans[1].wallet, &w.mint, &w.fans[0].support, &donor.pubkey(), 55);
    send(&mut w.svm, &[ix], &[&donor]).unwrap();
    w.check();
    assert_eq!(position_amount(&w.svm, &w.fans[0].position), 1_000, "a donation does not change the recorded position");
    w.request(0).unwrap();
    set_time(&mut w.svm, START + WEEK as i64);
    w.withdraw(0, 1_000).unwrap();
    assert_eq!(token_amount(&w.svm, &w.fans[0].wallet), 1_000_000_000 + 55);
    assert!(!exists(&w.svm, &w.fans[0].support));
}

#[test]
fn lamports_sent_to_a_future_position_address_do_not_block_the_fan() {
    let mut w = World::new(1);
    let (position, support) = (w.fans[0].position, w.fans[0].support);
    w.svm.airdrop(&position, 1).unwrap();
    w.svm.airdrop(&support, 1).unwrap();
    w.deposit(0, 3).unwrap();
    assert_eq!(position_amount(&w.svm, &position), 3);
}

#[test]
fn wrong_mint_wrong_program_and_wrong_pdas_are_refused() {
    let mut w = World::new(2);
    let other = new_mint(&mut w.svm, &w.streamer, &a(T22)).pubkey();
    let mut ix = w.deposit_ix(0, 1);
    ix.accounts[5] = AccountMeta::new_readonly(other, false);
    assert!(err_code(&send(&mut w.svm, &[ix], &[&w.fans[0].key]).unwrap_err(), 6302));
    let mut ix = w.deposit_ix(0, 1);
    ix.accounts[6] = AccountMeta::new_readonly(a(TOKEN), false);
    assert!(err_code(&send(&mut w.svm, &[ix], &[&w.fans[0].key]).unwrap_err(), 6301));
    let mut ix = w.deposit_ix(0, 1);
    ix.accounts[2] = AccountMeta::new(w.fans[1].position, false);
    assert!(err_code(&send(&mut w.svm, &[ix], &[&w.fans[0].key]).unwrap_err(), 6301));
    w.check();
}

#[test]
fn season_settings_are_bounded_so_a_streamer_cannot_lock_fans_in() {
    let mut w = World::new(0);
    for (start, seconds) in [
        (START, 59),
        (START, 28 * 86_400 + 1),
        (START, u64::MAX),
        (START + WEEK as i64 + 1, WEEK),
        (START - 365 * 86_400 - 1, WEEK),
        (i64::MIN, WEEK),
    ] {
        let other = new_mint(&mut w.svm, &w.streamer.insecure_clone(), &a(T22)).pubkey();
        w.mint = other;
        w.arena = pda(&[b"arena", w.streamer.pubkey().as_ref(), other.as_ref()]);
        assert!(err_code(&w.init_arena(start, seconds).unwrap_err(), 6303), "start {start} seconds {seconds}");
    }
    for (start, seconds) in [(START + WEEK as i64, WEEK), (START + 28 * 86_400, 28 * 86_400), (START - 365 * 86_400, 60)] {
        let other = new_mint(&mut w.svm, &w.streamer.insecure_clone(), &a(T22)).pubkey();
        w.mint = other;
        w.arena = pda(&[b"arena", w.streamer.pubkey().as_ref(), other.as_ref()]);
        w.init_arena(start, seconds).expect("edge of the window is allowed");
    }
}

/// A Token-2022 account for `mint` owned by `owner` holding `amount`, written directly (the real
/// $RLAN has no mint authority, so tokens cannot be minted in a test).
fn put_token_account(svm: &mut LiteSVM, mint: &Address, owner: &Address, amount: u64) -> Address {
    let k = Keypair::new().pubkey();
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1;
    let lamports = svm.minimum_balance_for_rent_exemption(165);
    svm.set_account(k, Account { lamports, data: d, owner: a(T22), executable: false, rent_epoch: 0 }).unwrap();
    k
}

#[test]
fn a_full_cycle_on_the_real_rlan_mint() {
    let mut w = World::new(0);
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/rlan-mint-mainnet.json")).unwrap()).unwrap();
    let data = base64::engine::general_purpose::STANDARD.decode(fixture["data_base64"].as_str().unwrap()).unwrap();
    let rlan = a(fixture["address"].as_str().unwrap());
    w.svm.set_account(rlan, Account { lamports: fixture["lamports"].as_u64().unwrap(), data, owner: a(T22), executable: false, rent_epoch: 0 }).unwrap();
    w.mint = rlan;
    w.arena = pda(&[b"arena", w.streamer.pubkey().as_ref(), rlan.as_ref()]);
    w.init_arena(START, WEEK).unwrap();
    let key = Keypair::new();
    w.svm.airdrop(&key.pubkey(), 1_000_000_000).unwrap();
    let wallet = put_token_account(&mut w.svm, &rlan, &key.pubkey(), 3_517_409_000_000);
    let position = pda(&[b"position", w.arena.as_ref(), key.pubkey().as_ref()]);
    let support = pda(&[b"support", w.arena.as_ref(), key.pubkey().as_ref()]);
    w.fans.push(Fan { key, wallet, position, support });
    w.deposit(0, 1_000_000_000_000).unwrap();
    assert_eq!(token_amount(&w.svm, &support), 1_000_000_000_000);
    w.request(0).unwrap();
    set_time(&mut w.svm, START + WEEK as i64);
    w.withdraw(0, 1_000_000_000_000).unwrap();
    assert_eq!(token_amount(&w.svm, &wallet), 3_517_409_000_000);
    assert!(!exists(&w.svm, &position));
}

#[test]
fn a_closed_arena_still_lets_a_fan_request_and_withdraw() {
    let mut w = World::new(1);
    w.deposit(0, 10).unwrap();
    let streamer = w.streamer.insecure_clone();
    w.close_arena(&streamer).unwrap();
    w.request(0).unwrap();
    w.withdraw(0, 10).unwrap();
}

#[test]
fn a_request_before_the_first_season_releases_when_it_starts() {
    let mut w = World::new(1);
    // A second arena whose first season starts a full season from now (the latest allowed).
    let other = new_mint(&mut w.svm, &w.streamer.insecure_clone(), &a(T22)).pubkey();
    let wallet = new_token_account(&mut w.svm, &w.streamer.insecure_clone(), &other, &w.fans[0].key.pubkey());
    mint_to(&mut w.svm, &w.streamer.insecure_clone(), &other, &wallet, 1_000);
    w.mint = other;
    w.arena = pda(&[b"arena", w.streamer.pubkey().as_ref(), other.as_ref()]);
    w.init_arena(START + WEEK as i64, WEEK).unwrap();
    let key = w.fans[0].key.insecure_clone();
    w.fans[0] = Fan { wallet, position: pda(&[b"position", w.arena.as_ref(), key.pubkey().as_ref()]), support: pda(&[b"support", w.arena.as_ref(), key.pubkey().as_ref()]), key };
    w.deposit(0, 1_000).unwrap();
    w.request(0).unwrap();
    set_time(&mut w.svm, START + WEEK as i64 - 1);
    assert!(err_code(&w.withdraw(0, 1_000).unwrap_err(), 6305));
    set_time(&mut w.svm, START + WEEK as i64);
    w.withdraw(0, 1_000).expect("released when the first season starts: at most one season after the request");
}

// ---- open markets (tag 5): only OPERATOR_OPENER may open, and only the RLAN mint ----------------------

fn open_market_ix(payer: &Address, slug: &[u8], mint: &Address) -> Instruction {
    let market = pda(&[b"open", slug]);
    let arena = pda(&[b"arena", market.as_ref(), mint.as_ref()]);
    let mut data = vec![5u8, slug.len() as u8];
    data.extend_from_slice(slug);
    data.extend_from_slice(&START.to_le_bytes());
    data.extend_from_slice(&WEEK.to_le_bytes());
    Instruction {
        program_id: a(ARENA_ID),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(market, false),
            AccountMeta::new(arena, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(a("11111111111111111111111111111111"), false),
        ],
        data,
    }
}

fn load_rlan_mint(svm: &mut LiteSVM) -> Address {
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/rlan-mint-mainnet.json")).unwrap()).unwrap();
    let data = base64::engine::general_purpose::STANDARD.decode(fixture["data_base64"].as_str().unwrap()).unwrap();
    let rlan = a(fixture["address"].as_str().unwrap());
    svm.set_account(rlan, Account { lamports: fixture["lamports"].as_u64().unwrap(), data, owner: a(T22), executable: false, rent_epoch: 0 }).unwrap();
    rlan
}

#[test]
fn a_non_opener_is_refused_even_for_the_real_rlan_mint() {
    let mut w = World::new(0);
    let rlan = load_rlan_mint(&mut w.svm);
    let payer = Keypair::new();
    w.svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    let ix = open_market_ix(&payer.pubkey(), b"jynxzi", &rlan);
    let err = send(&mut w.svm, &[ix], &[&payer]).unwrap_err();
    assert!(err_code(&err, 6310), "not the operator: {err}");
    assert!(!exists(&w.svm, &pda(&[b"open", b"jynxzi"])), "no market account was created");
}

#[test]
fn the_streamer_of_an_existing_arena_cannot_open_a_market_either() {
    let mut w = World::new(0);
    let rlan = load_rlan_mint(&mut w.svm);
    let streamer = w.streamer.insecure_clone();
    let ix = open_market_ix(&streamer.pubkey(), b"somebody", &rlan);
    assert!(err_code(&send(&mut w.svm, &[ix], &[&streamer]).unwrap_err(), 6310));
}

#[test]
fn an_open_market_without_the_payer_signature_is_refused_before_anything_else() {
    let mut w = World::new(0);
    let rlan = load_rlan_mint(&mut w.svm);
    let payer = Keypair::new();
    let sender = w.streamer.insecure_clone();
    let mut ix = open_market_ix(&payer.pubkey(), b"jynxzi", &rlan);
    ix.accounts[0].is_signer = false;
    assert!(send(&mut w.svm, &[ix], &[&sender]).is_err());
    assert!(!exists(&w.svm, &pda(&[b"open", b"jynxzi"])));
}
