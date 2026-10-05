// From Codex's #49, adapted to the season rule fixed after /code-review: index 0 before the start, then
// 1 + one per season, and a zero duration gives 0 (as the program) instead of throwing.
import test from "node:test";
import assert from "node:assert/strict";
import { encodeBase58 } from "../src/core/base58.js";
import { initArenaInstruction, depositInstruction, withdrawInstruction, createAccountInstruction,
  transferLamportsInstruction, mintToInstruction, initializeMintInstruction, seasonIndex } from "../src/sinks/arena.js";

const address = encodeBase58(new Uint8Array(32).fill(4));
const input = { fan: address, streamer: address, mint: address, source: address, destination: address, authority: address };
const max = (1n << 64n) - 1n;
const transfers = [depositInstruction, withdrawInstruction, mintToInstruction];

test("arena transfers reject modulo-wrapped u64s and already-rounded JavaScript numbers", () => {
  for (const build of transfers) {
    for (const amount of [max + 1n, max + 2n, (max + 2n).toString(), Number.MAX_SAFE_INTEGER + 1,
      0, -1, 1.5, Infinity, NaN, true, "01", "1e3"]) {
      assert.throws(() => build({ ...input, amount }), undefined, `amount ${String(amount)} must not be encoded`);
    }
    const instruction = build({ ...input, amount: max.toString() });
    assert.equal(Buffer.from(instruction.data).readBigUInt64LE(1), max);
    assert.equal(Buffer.from(build({ ...input, amount: "9007199254740993" }).data).readBigUInt64LE(1), 9007199254740993n);
  }
});
test("season settings cannot wrap signed times or unsigned durations", () => {
  for (const seasonStart of [1n << 63n, -(1n << 63n) - 1n, Number.MAX_SAFE_INTEGER + 1, "1e3"]) {
    assert.throws(() => initArenaInstruction({ ...input, seasonStart, seasonSeconds: 60 }));
  }
  for (const seasonSeconds of [0, -1, 59, 2419201, max + 1n, max + 61n, true]) {
    assert.throws(() => initArenaInstruction({ ...input, seasonStart: 1000, seasonSeconds }));
  }
  const instruction = initArenaInstruction({ ...input, seasonStart: (1n << 63n) - 1n, seasonSeconds: "604800" });
  assert.equal(Buffer.from(instruction.data).readBigInt64LE(1), (1n << 63n) - 1n);
  for (const bad of [max + 1n, -1, true, 1.5, "1e3"]) assert.throws(() => seasonIndex(1000, bad, 1000));
  assert.equal(seasonIndex(1000, 0, 2000), 0n);
  assert.equal(seasonIndex(1000, "60", 1060), 2n);
  assert.equal(seasonIndex(1000, "2419200", 2420200), 2n);
  assert.equal(Buffer.from(initArenaInstruction({ ...input, seasonStart: 1000, seasonSeconds: "2419200" }).data).readBigUInt64LE(9), 2419200n);
});
test("rehearsal instructions reject wrapped rent, space and decimal counts", () => {
  const account = { payer: address, account: address, owner: address, lamports: 1, space: 165 };
  for (const field of ["lamports", "space"]) for (const value of [max + 1n, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createAccountInstruction({ ...account, [field]: value }));
  }
  for (const lamports of [max + 1n, -1, true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => transferLamportsInstruction({ from: address, to: address, lamports }));
  }
  for (const decimals of [-1, 256, true, 1.5]) assert.throws(() => initializeMintInstruction({ mint: address, mintAuthority: address, decimals }));
  assert.equal(initializeMintInstruction({ mint: address, mintAuthority: address, decimals: 6 }).data[1], 6);
});
