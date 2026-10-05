/**
 * Client for the Radio LAN arena (`programs/radiolan-arena`): optional fan support
 * positions in a Token-2022 mint. Builds instructions in the program's byte layout, derives its
 * addresses and decodes its accounts. Also builds the few Token-2022 and System instructions a
 * devnet rehearsal needs (a test mint, a token account, mint-to). Sends nothing.
 */

import { decodeBase58, encodeBase58 } from "../core/base58.js";
import { findProgramAddress } from "../core/solana.js";

export const ARENA_PROGRAM_ID = "5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const ARENA_LEN = 112;
export const POSITION_LEN = 104;
export const MINT_LEN = 82;
export const TOKEN_ACCOUNT_LEN = 165;
export const MIN_SEASON_SECONDS = 60;
export const MAX_SEASON_SECONDS = 28 * 86_400;

const key = (value) => (typeof value === "string" ? decodeBase58(value) : value);
const meta = (pubkey, isSigner, isWritable) => ({ pubkey: key(pubkey), isSigner, isWritable });
const utf8 = (text) => new TextEncoder().encode(text);
const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
/**
 * An integer in [min, max] from a safe number, a BigInt or a plain decimal string; anything else throws.
 * DataView would otherwise wrap an out-of-range value silently (found during bounds review).
 */
function checkedInteger(value, min, max) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new RangeError("unsafe integer: use a decimal string or BigInt");
  if (!["number", "bigint", "string"].includes(typeof value) || (typeof value === "string" && !/^-?(0|[1-9][0-9]*)$/.test(value))) {
    throw new TypeError("expected an integer in base units");
  }
  const n = BigInt(value);
  if (n < min || n > max) throw new RangeError("integer outside instruction range");
  return n;
}
const u64 = (value) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, checkedInteger(value, 0n, U64_MAX), true);
  return out;
};
const i64 = (value) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, checkedInteger(value, I64_MIN, I64_MAX), true);
  return out;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const readU64 = (d, off) => new DataView(d.buffer, d.byteOffset).getBigUint64(off, true);
const readI64 = (d, off) => new DataView(d.buffer, d.byteOffset).getBigInt64(off, true);
const b58 = (d, off) => encodeBase58(d.slice(off, off + 32));

export function arenaAddress(streamer, mint) {
  return findProgramAddress([utf8("arena"), key(streamer), key(mint)], ARENA_PROGRAM_ID);
}
/** Market PDA. Its address is the arena's streamer, and it has no signer. */
export function openMarketAddress(slug) {
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(slug)) throw new TypeError("open market slug must be 3-32 listing characters");
  return findProgramAddress([utf8("open"), utf8(slug)], ARENA_PROGRAM_ID);
}
export function positionAddress(arena, fan) {
  return findProgramAddress([utf8("position"), key(arena), key(fan)], ARENA_PROGRAM_ID);
}
export function supportAddress(arena, fan) {
  return findProgramAddress([utf8("support"), key(arena), key(fan)], ARENA_PROGRAM_ID);
}

const ix = (keys, data) => ({ programId: key(ARENA_PROGRAM_ID), keys, data });

/** Mirrors the program's bounds; `now` (seconds) also checks the start window. */
export function initArenaInstruction({ streamer, mint, seasonStart, seasonSeconds, now }) {
  const seconds = checkedInteger(seasonSeconds, 0n, U64_MAX);
  if (seconds < BigInt(MIN_SEASON_SECONDS) || seconds > BigInt(MAX_SEASON_SECONDS)) throw new RangeError(`seasonSeconds must be ${MIN_SEASON_SECONDS} to ${MAX_SEASON_SECONDS}`);
  if (now !== undefined) {
    const start = checkedInteger(seasonStart, I64_MIN, I64_MAX);
    const t = checkedInteger(now, I64_MIN, I64_MAX);
    if (start > t + seconds || start < t - 365n * 86_400n) throw new RangeError("seasonStart must be at most one season ahead and at most 365 days back");
  }
  const arena = arenaAddress(streamer, mint).address;
  return ix([meta(streamer, true, true), meta(arena, false, true), meta(mint, false, false), meta(SYSTEM_PROGRAM, false, false)], concat([0], i64(seasonStart), u64(seasonSeconds)));
}

/** Tag 5. Only the operator opener key may be the payer, and only for the $RLAN mint (the program checks both). The streamer does not sign, and no key can close the market. */
export function initOpenMarketInstruction({ payer, slug, mint, seasonStart, seasonSeconds, now }) {
  const seconds = checkedInteger(seasonSeconds, 0n, U64_MAX);
  if (seconds < BigInt(MIN_SEASON_SECONDS) || seconds > BigInt(MAX_SEASON_SECONDS)) throw new RangeError(`seasonSeconds must be ${MIN_SEASON_SECONDS} to ${MAX_SEASON_SECONDS}`);
  if (now !== undefined) {
    const start = checkedInteger(seasonStart, I64_MIN, I64_MAX);
    const t = checkedInteger(now, I64_MIN, I64_MAX);
    if (start > t + seconds || start < t - 365n * 86_400n) throw new RangeError("seasonStart must be at most one season ahead and at most 365 days back");
  }
  const market = openMarketAddress(slug).address;
  const arena = arenaAddress(market, mint).address;
  const slugBytes = utf8(slug);
  return ix(
    [meta(payer, true, true), meta(market, false, true), meta(arena, false, true), meta(mint, false, false), meta(SYSTEM_PROGRAM, false, false)],
    concat([5], Uint8Array.of(slugBytes.length), slugBytes, i64(seasonStart), u64(seasonSeconds)),
  );
}

function positiveAmount(amount) {
  return u64(checkedInteger(amount, 1n, U64_MAX));
}

export function depositInstruction({ fan, streamer, mint, source, amount }) {
  const arena = arenaAddress(streamer, mint).address;
  return ix(
    [
      meta(fan, true, true),
      meta(arena, false, true),
      meta(positionAddress(arena, fan).address, false, true),
      meta(supportAddress(arena, fan).address, false, true),
      meta(source, false, true),
      meta(mint, false, false),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
      meta(SYSTEM_PROGRAM, false, false),
    ],
    concat([1], positiveAmount(amount)),
  );
}

export function requestWithdrawInstruction({ fan, streamer, mint }) {
  const arena = arenaAddress(streamer, mint).address;
  return ix([meta(fan, true, false), meta(arena, false, false), meta(positionAddress(arena, fan).address, false, true)], Uint8Array.of(2));
}

export function withdrawInstruction({ fan, streamer, mint, destination, amount }) {
  const arena = arenaAddress(streamer, mint).address;
  return ix(
    [
      meta(fan, true, true),
      meta(arena, false, true),
      meta(positionAddress(arena, fan).address, false, true),
      meta(supportAddress(arena, fan).address, false, true),
      meta(destination, false, true),
      meta(mint, false, false),
      meta(TOKEN_2022_PROGRAM_ID, false, false),
    ],
    concat([3], positiveAmount(amount)),
  );
}

export function closeArenaInstruction({ streamer, mint }) {
  return ix([meta(streamer, true, false), meta(arenaAddress(streamer, mint).address, false, true)], Uint8Array.of(4));
}

export function decodeArena(data) {
  if (data.length !== ARENA_LEN || new TextDecoder().decode(data.slice(0, 8)) !== "RLARENA1") throw new Error("not an arena account");
  return {
    decimals: data[9],
    closed: data[10] === 1,
    streamer: b58(data, 16),
    mint: b58(data, 48),
    seasonStart: readI64(data, 80),
    seasonSeconds: readU64(data, 88),
    positions: readU64(data, 96),
    total: readU64(data, 104),
  };
}

export function decodePosition(data) {
  if (data.length !== POSITION_LEN || new TextDecoder().decode(data.slice(0, 8)) !== "RLPOSIT1") throw new Error("not a position account");
  return {
    state: data[10] === 1 ? "requested" : "active",
    arena: b58(data, 16),
    fan: b58(data, 48),
    amount: readU64(data, 80),
    requestedSeason: readU64(data, 88),
    openedAt: readI64(data, 96),
  };
}

/** The program's season index at `now` (seconds): 0 before the start, then 1 + one per season. */
export function seasonIndex(seasonStart, seasonSeconds, now) {
  const start = checkedInteger(seasonStart, I64_MIN, I64_MAX);
  const seconds = checkedInteger(seasonSeconds, 0n, U64_MAX);
  const t = checkedInteger(now, I64_MIN, I64_MAX);
  if (t < start || seconds === 0n) return 0n;
  return 1n + (t - start) / seconds;
}

/**
 * When a withdrawal requested in season `requestedSeason` becomes available: the start of season
 * requestedSeason + 1, which is seasonStart + requestedSeason × seasonSeconds (season 0 is the time before
 * the start, so a request made then is available at the start). A closed arena is available at once.
 */
export function withdrawAvailableAt(seasonStart, seasonSeconds, requestedSeason) {
  const start = checkedInteger(seasonStart, I64_MIN, I64_MAX);
  const seconds = checkedInteger(seasonSeconds, 0n, U64_MAX);
  return start + checkedInteger(requestedSeason, 0n, U64_MAX) * seconds;
}

/** Token balance of a token account's data (Token-2022 base layout). */
export function tokenAmount(data) {
  return readU64(data, 64);
}

// --- System and Token-2022 instructions for a devnet rehearsal ---

export function createAccountInstruction({ payer, account, lamports, space, owner }) {
  return { programId: key(SYSTEM_PROGRAM), keys: [meta(payer, true, true), meta(account, true, true)], data: concat(u64(0).slice(0, 4), u64(lamports), u64(space), key(owner)) };
}
export function transferLamportsInstruction({ from, to, lamports }) {
  return { programId: key(SYSTEM_PROGRAM), keys: [meta(from, true, true), meta(to, false, true)], data: concat(Uint8Array.of(2, 0, 0, 0), u64(lamports)) };
}
/** InitializeMint2 (20): no freeze authority. */
export function initializeMintInstruction({ mint, decimals, mintAuthority }) {
  const checkedDecimals = Number(checkedInteger(decimals, 0n, 255n));
  return { programId: key(TOKEN_2022_PROGRAM_ID), keys: [meta(mint, false, true)], data: concat(Uint8Array.of(20, checkedDecimals), key(mintAuthority), Uint8Array.of(0)) };
}
/** InitializeAccount3 (18). */
export function initializeAccountInstruction({ account, mint, owner }) {
  return { programId: key(TOKEN_2022_PROGRAM_ID), keys: [meta(account, false, true), meta(mint, false, false)], data: concat(Uint8Array.of(18), key(owner)) };
}
/** MintTo (7). */
export function mintToInstruction({ mint, destination, authority, amount }) {
  return { programId: key(TOKEN_2022_PROGRAM_ID), keys: [meta(mint, false, true), meta(destination, false, true), meta(authority, true, false)], data: concat(Uint8Array.of(7), positiveAmount(amount)) };
}
