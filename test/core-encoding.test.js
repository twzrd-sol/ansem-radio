import assert from "node:assert/strict";
import test from "node:test";

import { randomBytes } from "node:crypto";

import { decodeBase58, decodePublicKey, encodeBase58 } from "../src/core/base58.js";
import { signerFromSeed, verifyEd25519 } from "../src/core/ed25519.js";

const fromHex = (text) => new Uint8Array(Buffer.from(text, "hex"));
const hex = (bytes) => Buffer.from(bytes).toString("hex");

// Program ids as bytes, from attention-oracle-program programs/evidence-ledger:
// src/lib.rs (ID) and src/instructions/anchor.rs (ED25519_PROGRAM_ID).
const KNOWN_KEYS = [
  ["11111111111111111111111111111111", "00".repeat(32)],
  [
    "BzBAYJxUtJp6mUkJPjEYjd8vdb2FUGnAfB5X9LqrQ72W",
    "a33a77e8b55ef0aafebb486d262e16429fa3b34321df63863ef1901626012f97",
  ],
  [
    "Ed25519SigVerify111111111111111111111111111",
    "037d46d67c93fbbe12f9428f838d40ff0570744927f48a64fcca704480000000",
  ],
];

test("base58 encodes and decodes known Solana program ids", () => {
  for (const [text, bytes] of KNOWN_KEYS) {
    assert.equal(encodeBase58(fromHex(bytes)), text);
    assert.equal(hex(decodeBase58(text)), bytes);
    assert.equal(hex(decodePublicKey(text)), bytes);
  }
});

test("base58 round-trips random bytes, including leading zeros", () => {
  for (let i = 0; i < 200; i += 1) {
    const bytes = new Uint8Array(randomBytes(1 + (i % 40)));
    if (i % 5 === 0) bytes.fill(0, 0, Math.min(3, bytes.length));
    assert.deepEqual(decodeBase58(encodeBase58(bytes)), bytes);
  }
  assert.equal(encodeBase58(new Uint8Array()), "");
  assert.deepEqual(decodeBase58(""), new Uint8Array());
});

test("base58 refuses characters outside the alphabet and keys of the wrong length", () => {
  for (const bad of ["0", "O", "I", "l", "abc+", " 1"]) assert.throws(() => decodeBase58(bad), TypeError);
  assert.throws(() => decodePublicKey("1111"), /32 bytes/);
  assert.throws(() => decodePublicKey("BzBAYJxUtJp6mUkJPjEYjd8vdb2FUGnAfB5X9LqrQ72W1"), /32 bytes/);
  assert.throws(() => decodePublicKey("not base58!"), /base58/);
  assert.throws(() => encodeBase58("abc"), TypeError);
});

test("Ed25519 reproduces RFC 8032 test 1", () => {
  const signer = signerFromSeed(fromHex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"));
  assert.equal(hex(signer.publicKey), "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
  const signature = signer.sign(new Uint8Array());
  assert.equal(
    hex(signature),
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  );
  assert.equal(verifyEd25519(signer.publicKey, new Uint8Array(), signature), true);
});

test("Ed25519 verification is false, never a throw, for wrong or malformed input", () => {
  const signer = signerFromSeed(new Uint8Array(32).fill(7));
  const message = new TextEncoder().encode("hello");
  const signature = signer.sign(message);
  assert.equal(verifyEd25519(signer.publicKey, message, signature), true);
  assert.equal(verifyEd25519(signer.publicKey, new TextEncoder().encode("hellO"), signature), false);
  const flipped = signature.slice();
  flipped[10] ^= 1;
  assert.equal(verifyEd25519(signer.publicKey, message, flipped), false);
  assert.equal(verifyEd25519(signerFromSeed(new Uint8Array(32).fill(8)).publicKey, message, signature), false);
  assert.equal(verifyEd25519(signer.publicKey.subarray(1), message, signature), false);
  assert.equal(verifyEd25519(signer.publicKey, message, signature.subarray(1)), false);
  assert.equal(verifyEd25519(new Uint8Array(32).fill(0xff), message, signature), false);
  assert.equal(verifyEd25519(signer.publicKey, "hello", signature), false);
  assert.throws(() => signerFromSeed(new Uint8Array(31)), /32 bytes/);
});
