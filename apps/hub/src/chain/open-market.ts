// Permissionless open markets (the tag 5 `init_open_market` instruction, RLOPEN01 accounts).
// Builders match `src/sinks/arena.js` and the pinned fixture. Sends nothing.
import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";

import { ARENA_PROGRAM, SYSTEM_PROGRAM } from "./config";
import { arenaAddress } from "./arena";
import { MAX_SEASON_SECONDS, MIN_SEASON_SECONDS } from "./season";

export const OPEN_MARKET_LEN = 128;

/** Radio LAN on ClawPump: every permissionless market is denominated in this mint. */
export const RLAN_MINT = "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy";

const program = address(ARENA_PROGRAM);
const systemProgram = address(SYSTEM_PROGRAM);
const encodeAddress = (a: Address) => getAddressEncoder().encode(a);
const decodeAddress = (bytes: Uint8Array) => getAddressDecoder().decode(bytes);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const SLUG = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export const slugForTwitchLogin = (login: string): string => {
  const slug = login.toLowerCase().replace(/_+$/, "");
  if (!SLUG.test(slug)) throw new TypeError(`bad listing slug for ${login}`);
  return slug;
};

/** The permissionless market PDA, ["open", slug]. Its address becomes the arena's streamer, so close needs no signer. */
export async function openMarketAddress(slug: string): Promise<{ address: Address; bump: number }> {
  if (!SLUG.test(slug)) throw new TypeError("open market slug must be 3-32 listing characters");
  const [market, bump] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: [new TextEncoder().encode("open"), new TextEncoder().encode(slug)],
  });
  return { address: market, bump };
}

/** One market per slug, denominated in the ClawPump mint. The payer stays the only signer; mirrors the program bounds. */
export async function initOpenMarketInstruction({ payer, slug, seasonStart, seasonSeconds, now }: { payer: Address; slug: string; seasonStart: bigint; seasonSeconds: bigint; now?: bigint }) {
  const mint = address(RLAN_MINT);
  if (seasonSeconds < MIN_SEASON_SECONDS || seasonSeconds > MAX_SEASON_SECONDS) throw new RangeError(`seasonSeconds must be ${MIN_SEASON_SECONDS} to ${MAX_SEASON_SECONDS}`);
  if (now !== undefined && (seasonStart > now + seasonSeconds || seasonStart < now - 365n * 86_400n)) {
    throw new RangeError("seasonStart must be at most one season ahead and at most 365 days back");
  }
  const bytes = new TextEncoder().encode(slug);
  if (bytes.length < 3 || bytes.length > 32) throw new RangeError("slug is 3-32 bytes");
  const market = await openMarketAddress(slug);
  const arena = await arenaAddress(market.address, mint);
  const start = new Uint8Array(8);
  new DataView(start.buffer).setBigInt64(0, seasonStart, true);
  const seconds = new Uint8Array(8);
  new DataView(seconds.buffer).setBigUint64(0, seasonSeconds, true);
  return {
    programAddress: program,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: market.address, role: AccountRole.WRITABLE },
      { address: arena, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
      { address: systemProgram, role: AccountRole.READONLY },
    ],
    data: concat(Uint8Array.of(5, bytes.length), bytes, start, seconds),
  } satisfies Instruction;
}

export interface OpenMarketAccount {
  bump: number;
  slug: string;
  mint: Address;
  arena: Address;
  seasonStart: bigint;
  seasonSeconds: bigint;
}

/** 128 B record, magic RLOPEN01: bump@8, slug_len@9, slug@10..42, mint@42..74, arena@74..106, start@106..114, seconds@114..122, zero pad. */
export function decodeOpenMarket(data: Uint8Array): OpenMarketAccount {
  const tag = new TextDecoder().decode(data.subarray(0, 8));
  if (data.length !== OPEN_MARKET_LEN || tag !== "RLOPEN01") throw new Error("not an open market account");
  const slugLen = data[9]!;
  if (slugLen > 32) throw new Error("bad slug length");
  return Object.freeze({
    bump: data[8]!,
    slug: new TextDecoder().decode(data.subarray(10, 10 + slugLen)),
    mint: decodeAddress(data.subarray(42, 74)),
    arena: decodeAddress(data.subarray(74, 106)),
    seasonStart: new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(106, true),
    seasonSeconds: new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(114, true),
  });
}
