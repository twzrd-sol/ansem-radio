// The hub's builders and decoders against REAL chain bytes (fixtures/arena-chain-fixtures.json, public data):
// the mainnet init_arena of the internal test arena, the founder's devnet deposit, request and withdraw, and the
// mainnet test arena account. The JS client is also checked against the same bytes, so all three agree.
import { AccountRole, address, type Instruction } from "@solana/kit";
import { describe, expect, it } from "vitest";

import * as ref from "../../../../src/sinks/arena.js";
import { encodeBase58 } from "../../../../src/core/base58.js";
import fixtures from "./fixtures/arena-chain-fixtures.json";
import { decodeArena, depositInstruction, initArenaInstruction, requestWithdrawInstruction, withdrawInstruction } from "./arena";

type Fixture = { data_hex: string; accounts: Array<{ pubkey: string; signer: boolean; writable: boolean }> };
type Account = Fixture["accounts"][number];
const fxAll = fixtures.instructions as Record<string, Fixture>;
function fx(name: string): Fixture {
  const f = fxAll[name];
  if (!f) throw new Error(`missing fixture ${name}`);
  return f;
}
function acct(f: Fixture, i: number): Account {
  const a = f.accounts[i];
  if (!a) throw new Error(`fixture has no account ${i}`);
  return a;
}
const hex = (u: Uint8Array | ArrayLike<number>) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const role = (r: AccountRole) => ({ signer: r === AccountRole.READONLY_SIGNER || r === AccountRole.WRITABLE_SIGNER, writable: r === AccountRole.WRITABLE || r === AccountRole.WRITABLE_SIGNER });

// Flags in a landed transaction are merged across the whole message (the fee payer is always a writable signer),
// so an instruction must match the chain exactly on data, account order and signers, and every account it marks
// writable must be writable on chain.
function sameAsChain(accounts: Array<{ pubkey: string; signer: boolean; writable: boolean }>, data: string, f: Fixture) {
  expect(data).toBe(f.data_hex);
  expect(accounts.map((a) => a.pubkey)).toEqual(f.accounts.map((a) => a.pubkey));
  expect(accounts.map((a) => a.signer)).toEqual(f.accounts.map((a) => a.signer));
  accounts.forEach((a, i) => { if (a.writable) expect(acct(f, i).writable, `${a.pubkey} writable`).toBe(true); });
}
function matchesChain(mine: Instruction, f: Fixture) {
  sameAsChain((mine.accounts ?? []).map((a) => ({ pubkey: a.address, ...role(a.role) })), hex(mine.data ?? []), f);
}
function refMatchesChain(r: { keys: Array<{ pubkey: Uint8Array; isSigner: boolean; isWritable: boolean }>; data: Uint8Array }, f: Fixture) {
  sameAsChain(r.keys.map((k) => ({ pubkey: encodeBase58(k.pubkey), signer: k.isSigner, writable: k.isWritable })), hex(r.data), f);
}

describe("arena instructions are byte-identical to transactions that landed", () => {
  it("init_arena: the mainnet internal test arena (GwYj…)", async () => {
    const f = fx("init_arena_mainnet_test_arena");
    const args = { streamer: address(acct(f, 0).pubkey), mint: address(acct(f, 2).pubkey), seasonStart: 1790553600n, seasonSeconds: 604800n, now: 1790955000n };
    matchesChain(await initArenaInstruction(args), f);
    refMatchesChain(ref.initArenaInstruction(args), f);
  });

  it("deposit, request and withdraw: the founder's devnet run", async () => {
    const d = fx("deposit_devnet_founder"), q = fx("request_devnet_founder"), w = fx("withdraw_devnet_founder");
    const fan = address(acct(d, 0).pubkey), source = address(acct(d, 4).pubkey), mint = address(acct(d, 5).pubkey);
    const streamer = address("EatwUpB2eCRcCEJgvQvzNb1hiPKqasjzXQ7NtVVFuLYX"); // streamer of the devnet rehearsal arena 6Sb5…
    matchesChain(await depositInstruction({ fan, streamer, mint, source, amount: 100_000_000n }), d);
    matchesChain(await requestWithdrawInstruction({ fan, streamer, mint }), q);
    matchesChain(await withdrawInstruction({ fan, streamer, mint, destination: address(acct(w, 4).pubkey), amount: 100_000_000n }), w);
    refMatchesChain(ref.depositInstruction({ fan, streamer, mint, source, amount: 100_000_000n }), d);
    refMatchesChain(ref.requestWithdrawInstruction({ fan, streamer, mint }), q);
    refMatchesChain(ref.withdrawInstruction({ fan, streamer, mint, destination: acct(w, 4).pubkey, amount: 100_000_000n }), w);
  });
});

describe("arena account decoding against the live mainnet account", () => {
  it("decodes the internal test arena the same way as the JS client", () => {
    const acct = fixtures.accounts.test_arena_mainnet;
    const data = Uint8Array.from(atob(acct.data_base64), (c) => c.charCodeAt(0));
    expect(acct.owner).toBe("5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf");
    const mine = decodeArena(data) as unknown as Record<string, unknown>;
    const theirs = ref.decodeArena(data) as unknown as Record<string, unknown>;
    expect(mine.streamer ?? mine["streamer"]).toBe("GbscvafBJEkWutxm3Bi6AYfXztfojW6Jj7Yaw1TM3PhT");
    for (const k of ["streamer", "mint", "decimals", "closed", "seasonStart", "seasonSeconds", "positions", "total"]) {
      expect(String(mine[k]), k).toBe(String(theirs[k]));
    }
    expect(String(theirs.seasonStart)).toBe("1790553600");
    expect(String(theirs.seasonSeconds)).toBe("604800");
  });
});
