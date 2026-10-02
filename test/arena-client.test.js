import assert from "node:assert/strict";
import test from "node:test";

import { encodeBase58 } from "../src/core/base58.js";
import { signerFromSeed } from "../src/core/ed25519.js";
import {
  ARENA_LEN,
  ARENA_PROGRAM_ID,
  POSITION_LEN,
  arenaAddress,
  decodeArena,
  decodePosition,
  depositInstruction,
  initArenaInstruction,
  positionAddress,
  requestWithdrawInstruction,
  seasonIndex,
  supportAddress,
  withdrawAvailableAt,
  withdrawInstruction,
} from "../src/sinks/arena.js";

const streamer = encodeBase58(signerFromSeed(new Uint8Array(32).fill(1)).publicKey);
const fan = encodeBase58(signerFromSeed(new Uint8Array(32).fill(2)).publicKey);
const mint = "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy";
const keys = (ix) => ix.keys.map((k) => [encodeBase58(k.pubkey), k.isSigner, k.isWritable]);

test("instructions carry the program's tags, amounts and account order", () => {
  const arena = encodeBase58(arenaAddress(streamer, mint).address);
  const init = initArenaInstruction({ streamer, mint, seasonStart: 1_790_000_000, seasonSeconds: 604_800 });
  assert.equal(encodeBase58(init.programId), ARENA_PROGRAM_ID);
  assert.deepEqual([...init.data.slice(0, 1)], [0]);
  assert.equal(init.data.length, 17);
  assert.deepEqual(keys(init)[1], [arena, false, true]);

  const deposit = depositInstruction({ fan, streamer, mint, source: fan, amount: 1_000_000n });
  assert.deepEqual([...deposit.data], [1, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]);
  assert.deepEqual(keys(deposit).slice(0, 4), [
    [fan, true, true],
    [arena, false, true],
    [encodeBase58(positionAddress(arena, fan).address), false, true],
    [encodeBase58(supportAddress(arena, fan).address), false, true],
  ]);
  assert.equal(keys(deposit)[6][0], "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

  assert.deepEqual([...requestWithdrawInstruction({ fan, streamer, mint }).data], [2]);
  const withdraw = withdrawInstruction({ fan, streamer, mint, destination: fan, amount: 5 });
  assert.equal(withdraw.data[0], 3);
  assert.equal(withdraw.keys.length, 7);
  assert.throws(() => depositInstruction({ fan, streamer, mint, source: fan, amount: 0 }));
  assert.throws(() => initArenaInstruction({ streamer, mint, seasonStart: 0, seasonSeconds: 0 }));
  assert.throws(() => initArenaInstruction({ streamer, mint, seasonStart: 0, seasonSeconds: 59 }), RangeError);
  assert.throws(() => initArenaInstruction({ streamer, mint, seasonStart: 0, seasonSeconds: 28 * 86_400 + 1 }), RangeError);
  assert.throws(() => initArenaInstruction({ streamer, mint, seasonStart: 1000 + 61, seasonSeconds: 60, now: 1000 }), RangeError);
  assert.throws(() => initArenaInstruction({ streamer, mint, seasonStart: 1000 - 365 * 86_400 - 1, seasonSeconds: 60, now: 1000 }), RangeError);
  initArenaInstruction({ streamer, mint, seasonStart: 1060, seasonSeconds: 60, now: 1000 });
});

test("arena and position accounts decode from the program's layout", () => {
  const a = new Uint8Array(ARENA_LEN);
  a.set(new TextEncoder().encode("RLARENA1"));
  a[9] = 6;
  a[10] = 1;
  new DataView(a.buffer).setBigInt64(80, 1_790_000_000n, true);
  new DataView(a.buffer).setBigUint64(88, 604_800n, true);
  new DataView(a.buffer).setBigUint64(104, 42n, true);
  const arena = decodeArena(a);
  assert.equal(arena.decimals, 6);
  assert.equal(arena.closed, true);
  assert.equal(arena.total, 42n);
  assert.throws(() => decodeArena(new Uint8Array(ARENA_LEN)));

  const p = new Uint8Array(POSITION_LEN);
  p.set(new TextEncoder().encode("RLPOSIT1"));
  p[10] = 1;
  new DataView(p.buffer).setBigUint64(80, 7n, true);
  assert.deepEqual([decodePosition(p).state, decodePosition(p).amount], ["requested", 7n]);
});

test("season index matches the program's rule", () => {
  assert.equal(seasonIndex(1000, 100, 999), 0n);
  assert.equal(seasonIndex(1000, 100, 1000), 1n);
  assert.equal(seasonIndex(1000, 100, 1099), 1n);
  assert.equal(seasonIndex(1000, 100, 1100), 2n);
  assert.equal(seasonIndex(1000, 100, 0), 0n);
  assert.equal(seasonIndex(5, 0, 10), 0n, "zeroed buffer: no throw, like the program");
});

test("sendAndConfirm keeps polling through a rate-limited status call", async () => {
  const { createRpc } = await import("../src/core/solana.js");
  let polls = 0;
  const fetchImpl = async (_url, { body }) => {
    const { method, id } = JSON.parse(body);
    if (method === "sendTransaction") return { ok: true, json: async () => ({ jsonrpc: "2.0", id, result: "sig" }) };
    polls += 1;
    if (polls === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id, result: { value: [{ confirmationStatus: "confirmed", err: null }] } }) };
  };
  const rpc = createRpc("http://rpc.invalid", { fetchImpl });
  assert.equal(await rpc.sendAndConfirm(new Uint8Array(1), { pollMs: 1, sleep: async () => {} }), "sig");
  assert.equal(polls, 2);
});

test("a request made in season R is available when season R + 1 begins", () => {
  // Pre-start request (R = 0) is available at the start; R = 1 one season later.
  assert.equal(withdrawAvailableAt(1000, 100, 0), 1000n);
  assert.equal(withdrawAvailableAt(1000, 100, 1), 1100n);
  for (const r of [0n, 1n, 2n, 31n]) {
    const at = withdrawAvailableAt(1000, 100, r);
    assert.equal(seasonIndex(1000, 100, at), r + 1n, "the program unlocks exactly then");
    assert.equal(seasonIndex(1000, 100, at - 1n), r, "and not a second earlier");
  }
  // The devnet run on 2026-10-02: arena start 1790945390, 90 s seasons, requested in 31, released in 32.
  assert.equal(seasonIndex(1790945390, 90, withdrawAvailableAt(1790945390, 90, 31)), 32n);
});
