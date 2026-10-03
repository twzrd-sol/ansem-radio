// Browser builders for radiolan-arena (programs/radiolan-arena, docs/ARENA.md), on @solana/kit. They must produce
// byte-identical instructions to src/sinks/arena.js (plan section 6); arena.spec.ts compares them. Sends nothing.
import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";

import { ARENA_PROGRAM, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM } from "./config";
import { MAX_SEASON_SECONDS, MIN_SEASON_SECONDS } from "./season";

export const ARENA_LEN = 112;
export const POSITION_LEN = 104;
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

const program = address(ARENA_PROGRAM);
const encodeAddress = (a: Address) => getAddressEncoder().encode(a);
const decodeAddress = (bytes: Uint8Array) => getAddressDecoder().decode(bytes);

/** DataView would wrap an out-of-range value silently; refuse it instead (as #49 does in the JS client). */
function checked(n: bigint, min: bigint, max: bigint): bigint {
  if (typeof n !== "bigint") throw new TypeError("expected a bigint in base units");
  if (n < min || n > max) throw new RangeError("integer outside instruction range");
  return n;
}
const u64 = (n: bigint) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, checked(n, 0n, U64_MAX), true);
  return out;
};
const i64 = (n: bigint) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, checked(n, I64_MIN, I64_MAX), true);
  return out;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const pdaWithBump = (seeds: Array<string | Uint8Array>) => getProgramDerivedAddress({ programAddress: program, seeds });
const pda = async (seeds: Array<string | Uint8Array>) => (await pdaWithBump(seeds))[0];

/** The arena PDA and its bump, ["arena", streamer, mint]. */
export const arenaPda = (streamer: Address, mint: Address) => pdaWithBump(["arena", encodeAddress(streamer) as Uint8Array, encodeAddress(mint) as Uint8Array]);
export const arenaAddress = async (streamer: Address, mint: Address) => (await arenaPda(streamer, mint))[0];
export const positionAddress = (arena: Address, fan: Address) => pda(["position", encodeAddress(arena) as Uint8Array, encodeAddress(fan) as Uint8Array]);
export const supportAddress = (arena: Address, fan: Address) => pda(["support", encodeAddress(arena) as Uint8Array, encodeAddress(fan) as Uint8Array]);

/** The fan's associated token account for a Token-2022 mint. */
export async function associatedTokenAddress(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [encodeAddress(owner) as Uint8Array, encodeAddress(address(TOKEN_2022_PROGRAM)) as Uint8Array, encodeAddress(mint) as Uint8Array],
  });
  return ata;
}

const meta = (a: Address | string, role: AccountRole) => ({ address: address(a), role });
const ix = (accounts: ReturnType<typeof meta>[], data: Uint8Array): Instruction => ({ programAddress: program, accounts, data });

/** Mirrors the program's bounds: seasons of 60 s to 28 days; `now` (seconds) also checks the start window. */
export async function initArenaInstruction({ streamer, mint, seasonStart, seasonSeconds, now }: { streamer: Address; mint: Address; seasonStart: bigint; seasonSeconds: bigint; now?: bigint }) {
  const seconds = checked(seasonSeconds, 0n, U64_MAX);
  if (seconds < MIN_SEASON_SECONDS || seconds > MAX_SEASON_SECONDS) throw new RangeError(`seasonSeconds must be ${MIN_SEASON_SECONDS} to ${MAX_SEASON_SECONDS}`);
  if (now !== undefined) {
    const start = checked(seasonStart, I64_MIN, I64_MAX);
    const t = checked(now, I64_MIN, I64_MAX);
    if (start > t + seconds || start < t - 365n * 86_400n) throw new RangeError("seasonStart must be at most one season ahead and at most 365 days back");
  }
  const arena = await arenaAddress(streamer, mint);
  return ix(
    [meta(streamer, AccountRole.WRITABLE_SIGNER), meta(arena, AccountRole.WRITABLE), meta(mint, AccountRole.READONLY), meta(SYSTEM_PROGRAM, AccountRole.READONLY)],
    concat(Uint8Array.of(0), i64(seasonStart), u64(seasonSeconds)),
  );
}

const positiveAmount = (amount: bigint) => u64(checked(amount, 1n, U64_MAX));

export async function depositInstruction({ fan, streamer, mint, source, amount }: { fan: Address; streamer: Address; mint: Address; source: Address; amount: bigint }) {
  const arena = await arenaAddress(streamer, mint);
  return ix(
    [
      meta(fan, AccountRole.WRITABLE_SIGNER),
      meta(arena, AccountRole.WRITABLE),
      meta(await positionAddress(arena, fan), AccountRole.WRITABLE),
      meta(await supportAddress(arena, fan), AccountRole.WRITABLE),
      meta(source, AccountRole.WRITABLE),
      meta(mint, AccountRole.READONLY),
      meta(TOKEN_2022_PROGRAM, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
    ],
    concat(Uint8Array.of(1), positiveAmount(amount)),
  );
}

export async function requestWithdrawInstruction({ fan, streamer, mint }: { fan: Address; streamer: Address; mint: Address }) {
  const arena = await arenaAddress(streamer, mint);
  return ix([meta(fan, AccountRole.READONLY_SIGNER), meta(arena, AccountRole.READONLY), meta(await positionAddress(arena, fan), AccountRole.WRITABLE)], Uint8Array.of(2));
}

export async function withdrawInstruction({ fan, streamer, mint, destination, amount }: { fan: Address; streamer: Address; mint: Address; destination: Address; amount: bigint }) {
  const arena = await arenaAddress(streamer, mint);
  return ix(
    [
      meta(fan, AccountRole.WRITABLE_SIGNER),
      meta(arena, AccountRole.WRITABLE),
      meta(await positionAddress(arena, fan), AccountRole.WRITABLE),
      meta(await supportAddress(arena, fan), AccountRole.WRITABLE),
      meta(destination, AccountRole.WRITABLE),
      meta(mint, AccountRole.READONLY),
      meta(TOKEN_2022_PROGRAM, AccountRole.READONLY),
    ],
    concat(Uint8Array.of(3), positiveAmount(amount)),
  );
}

export async function closeArenaInstruction({ streamer, mint }: { streamer: Address; mint: Address }) {
  return ix([meta(streamer, AccountRole.READONLY_SIGNER), meta(await arenaAddress(streamer, mint), AccountRole.WRITABLE)], Uint8Array.of(4));
}

export interface ArenaAccount {
  decimals: number;
  closed: boolean;
  streamer: Address;
  mint: Address;
  seasonStart: bigint;
  seasonSeconds: bigint;
  positions: bigint;
  total: bigint;
}

export interface PositionAccount {
  state: "active" | "requested";
  arena: Address;
  fan: Address;
  amount: bigint;
  requestedSeason: bigint;
  openedAt: bigint;
}

const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const tag = (d: Uint8Array) => new TextDecoder().decode(d.subarray(0, 8));

export function decodeArena(data: Uint8Array): ArenaAccount {
  if (data.length !== ARENA_LEN || tag(data) !== "RLARENA1") throw new Error("not an arena account");
  const v = view(data);
  return {
    decimals: data[9] ?? 0,
    closed: data[10] === 1,
    streamer: decodeAddress(data.subarray(16, 48)),
    mint: decodeAddress(data.subarray(48, 80)),
    seasonStart: v.getBigInt64(80, true),
    seasonSeconds: v.getBigUint64(88, true),
    positions: v.getBigUint64(96, true),
    total: v.getBigUint64(104, true),
  };
}

export function decodePosition(data: Uint8Array): PositionAccount {
  if (data.length !== POSITION_LEN || tag(data) !== "RLPOSIT1") throw new Error("not a position account");
  const v = view(data);
  return {
    state: data[10] === 1 ? "requested" : "active",
    arena: decodeAddress(data.subarray(16, 48)),
    fan: decodeAddress(data.subarray(48, 80)),
    amount: v.getBigUint64(80, true),
    requestedSeason: v.getBigUint64(88, true),
    openedAt: v.getBigInt64(96, true),
  };
}

/** Token amount of a Token-2022 account (base layout: amount at offset 64). */
export const tokenAmount = (data: Uint8Array) => view(data).getBigUint64(64, true);

/** The program's custom errors (docs/ARENA.md), in plain words for the failed-step screen. */
export const ARENA_ERRORS: Record<number, string> = {
  6300: "That account already exists.",
  6301: "An account in the transaction is not the one the arena expects.",
  6302: "The arena does not accept this token.",
  6303: "The arena's settings are out of bounds.",
  6304: "The arena is closed to new backing.",
  6305: "Locked until the on-chain season you asked in ends.",
  6306: "The amount is not valid.",
  6307: "A withdrawal is already requested.",
  6308: "That token account can't receive it.",
  6309: "Only the streamer can do that.",
};
