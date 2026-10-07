// Byte compatibility for the permissionless open market (tag 5). The hub doesn't send anything; the point is that
// its builder produces the exact bytes and accounts `src/sinks/arena.js` produces.
import { AccountRole, address, getAddressEncoder, type Address, type Instruction } from "@solana/kit";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { decodeOpenMarket, initOpenMarketInstruction, openMarketAddress, RLAN_MINT, slugForTwitchLogin } from "./open-market";
import { SYSTEM_PROGRAM } from "./config";


const fixture = (await readFile(new URL("./fixtures/open-market-fixtures.json", import.meta.url), "utf8").then(JSON.parse)) as {
  program: string;
  payer: string;
  slug: string;
  seasonStart: number;
  seasonSeconds: number;
  market: string;
  marketBump: number;
  arena: string;
  rlanMint: string;
  dataHex: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
};

const roleOf = (f: { isSigner: boolean; isWritable: boolean }) =>
  f.isSigner && f.isWritable ? AccountRole.WRITABLE_SIGNER : f.isSigner ? AccountRole.READONLY_SIGNER : f.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;

describe("open market (tag 5)", () => {
  it("builds the init_open_market instruction byte-identically to the reference implementation", async () => {
    const ix = await initOpenMarketInstruction({
      payer: address(fixture.payer),
      slug: fixture.slug,
      seasonStart: BigInt(fixture.seasonStart),
      seasonSeconds: BigInt(fixture.seasonSeconds),
      now: BigInt(fixture.seasonStart),
    });
    expect(Buffer.from(ix.data).toString("hex")).toBe(fixture.dataHex);
    expect(ix.accounts.map((a) => ({ pubkey: a.address, isSigner: (a.role & 2) !== 0, isWritable: (a.role & 1) !== 0 }))).toEqual(
      fixture.accounts.map((a) => ({ pubkey: a.pubkey, isSigner: a.isSigner, isWritable: a.isWritable })),
    );
    expect(ix.accounts.length).toBe(5);
  });

  it("derives the market and arena PDAs the reference implementation derives", async () => {
    const market = await openMarketAddress(fixture.slug);
    expect(market.address).toBe(address(fixture.market));
    expect(market.bump).toBe(fixture.marketBump);
  });

  it("decodeOpenMarket round-trips the RLOPEN01 record", async () => {
    const slugBytes = new TextEncoder().encode(fixture.slug);
    const record = new Uint8Array(128);
    record.set(new TextEncoder().encode("RLOPEN01"), 0);
    record[8] = fixture.marketBump;
    record[9] = fixture.slug.length;
    record.set(slugBytes, 10);
    record.set(getAddressEncoder().encode(address(fixture.arena)) as Uint8Array, 74);
    record.set(getAddressEncoder().encode(address(RLAN_MINT)) as Uint8Array, 42);
    new DataView(record.buffer).setBigInt64(106, BigInt(fixture.seasonStart), true);
    new DataView(record.buffer).setBigUint64(114, BigInt(fixture.seasonSeconds), true);
    const decoded = decodeOpenMarket(record);
    expect(decoded.slug).toBe(fixture.slug);
    expect(decoded.bump).toBe(fixture.marketBump);
    expect(decoded.arena).toBe(address(fixture.arena));
    expect(decoded.mint).toBe(address(RLAN_MINT));
    expect(decoded.seasonSeconds).toBe(BigInt(fixture.seasonSeconds));
    expect(() => decodeOpenMarket(record.subarray(0, 100))).toThrow();
  });

  it("accepts the Twitch login slug and refuses outside characters", () => {
    expect(slugForTwitchLogin("radiolanlive")).toBe("radiolanlive");
    expect(() => slugForTwitchLogin("UPPER")).not.toThrow();
    expect(() => slugForTwitchLogin("bad/slug")).toThrow();
  });
});
