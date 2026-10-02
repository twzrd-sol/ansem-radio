import assert from "node:assert/strict";
import test from "node:test";

import { createHash, randomBytes } from "node:crypto";

import { keccak256, sha3_256 } from "../src/core/keccak.js";

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const fromHex = (text) => new Uint8Array(Buffer.from(text, "hex"));

test("the sponge matches node:crypto SHA3-256 at every length across three blocks", () => {
  // Same permutation and rate as Keccak-256; only the pad byte differs. Lengths
  // 0..410 cross the 136-byte rate boundary three times, including 135 (the pad
  // byte and the final 0x80 share one byte) and 136 (an extra padding block).
  const input = randomBytes(410);
  for (let length = 0; length <= input.length; length += 1) {
    const slice = input.subarray(0, length);
    assert.equal(hex(sha3_256(slice)), createHash("sha3-256").update(slice).digest("hex"), `length ${length}`);
  }
});

test("the sponge matches node:crypto SHA3-256 on large random inputs", () => {
  for (const length of [1000, 4096, 65_537]) {
    const input = randomBytes(length);
    assert.equal(hex(sha3_256(input)), createHash("sha3-256").update(input).digest("hex"));
  }
});

test("keccak256 matches published Keccak-256 vectors, not SHA3-256", () => {
  assert.equal(hex(keccak256()), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(hex(keccak256("abc")), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.notEqual(hex(keccak256("abc")), createHash("sha3-256").update("abc").digest("hex"));
});

test("multi-part input hashes the concatenation", () => {
  assert.deepEqual(keccak256("hel", "lo"), keccak256("hello"));
  assert.deepEqual(keccak256(new Uint8Array([1, 2]), "x", new Uint8Array()), keccak256(new Uint8Array([1, 2, 0x78])));
});

// Golden vectors from attention-oracle-program, programs/evidence-ledger
// (tests/fixtures/reader_fetch_v1.json and the RFC 9162 vectors in src/merkle.rs).
// They pin this port to the program's own hash on multi-part, mixed-width input.
test("keccak256 reproduces the evidence-ledger reader.fetch.v1 golden leaves", () => {
  const u64le = (value) => {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
    return out;
  };
  const resource = new Uint8Array(createHash("sha256").update("# fetched\n").digest());
  const domain = "TWZRD:READER_FETCH_LEAF_V1";

  const solanaPayer = new Uint8Array(32).fill(0x11);
  assert.equal(
    hex(keccak256(domain, solanaPayer, resource, u64le(5000), u64le(444_956_973))),
    "7d65918d4d4f4174964914ad9eb4922818131e0613340b9e07adb32956dddd92",
  );

  const basePayer = new Uint8Array(32);
  basePayer.set(fromHex("00112233445566778899aabbccddeeff00112233"), 12);
  assert.equal(
    hex(keccak256(domain, basePayer, resource, u64le(50_000), u64le(21_000_000))),
    "ce5109c69259d21e950896ffd6e6ed2e2ed036649c156bc5bd18e60de5c00655",
  );
});

test("keccak256 reproduces the evidence-ledger RFC 9162 single-entry root", () => {
  const entry = fromHex("bfa6e9db6e3028aee847c101d694a6650d3228bb0a15d61a314d15519df84092");
  assert.equal(
    hex(keccak256(new Uint8Array([0x00]), entry)),
    "0464adcacce1e8c142e5f5f2ab4d099780344a53eaa89a3c888e2f6cdaaa784e",
  );
});

test("rejects inputs that are not bytes or strings", () => {
  assert.throws(() => keccak256(42), TypeError);
  assert.throws(() => keccak256([1, 2]), TypeError);
});
