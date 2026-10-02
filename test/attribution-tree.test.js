import assert from "node:assert/strict";
import test from "node:test";

import { decodeBase58 } from "../src/core/base58.js";
import { signerFromSeed } from "../src/core/ed25519.js";
import {
  headFromJSON,
  headToJSON,
  signTreeHead,
  treeHeadPreimage,
  verifyHeadConsistency,
  verifyTreeHead,
} from "../src/attribution/head.js";
import {
  MAX_PATH,
  consistencyPath,
  inclusionPath,
  leafHash,
  treeRoot,
  verifyConsistency,
  verifyInclusion,
} from "../src/attribution/tree.js";

const h = (text) => new Uint8Array(Buffer.from(text.replace(/^0x/, ""), "hex"));
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const flip = (bytes, at = 0) => {
  const out = bytes.slice();
  out[at] ^= 1;
  return out;
};
const entries = (n, seed = 1) => Array.from({ length: n }, (_, i) => new Uint8Array(32).fill((i * 7 + seed) % 256));

// RFC 9162 vectors from attention-oracle-program @ bd1ef2e,
// programs/evidence-ledger/src/merkle.rs, generated there by an independent
// Python reference (twzrd_agent_intel.log_rfc6962).
const RFC_ENTRIES = [
  "bfa6e9db6e3028aee847c101d694a6650d3228bb0a15d61a314d15519df84092",
  "c9c234e81d7adaeaf06a14d8491939615fc6a2d274f22dbef59a9936963f8042",
  "179abcf64241a8a8a4fab33e6fc1b41d1316dac6d1f2968e8d5be2e1b8ab0cb4",
  "138397b786bdf628b32490b0deebb6d64e36769a3bc07debae3c645d5d4ec684",
  "1a486827057fa9510c14609c7f0a15496727381676f07bd240d6b13b6045f149",
  "292a198e4d28ddc57ea0d5aa061b31d6cdf44f818235bb5f5bce60bae151d961",
  "c7ec410c7dfda5df684546d86b9c460ff652088699b9220bdf855c4fde4e27bc",
].map(h);
const RFC_ROOT = h("c038f111c37786a5a278066e2ee900615e130751b92fbdf856fd0eeb00907063");
const RFC_PROOFS = {
  0: ["85c6efa74a3f8df92067bee4dc044583028702e36c56c0b922a0878989feae90", "79c05a6bd16b979b34a22af095395d17bbcce9af6ef1175773fc8d806f29cfa7", "389bcd7937d4198b25379234e06f75e1a7e31c4439d029b53966717a5d6eb742"],
  3: ["4ba08d6d42a1d406a150952b2db948908c86dbafb486805f46302e1d05f997e0", "6595bde26347325f385f51b0a5beacc80ab9f248cfa59c6a2fb76a66da3de6ce", "389bcd7937d4198b25379234e06f75e1a7e31c4439d029b53966717a5d6eb742"],
  6: ["ade14d197e79dd19c4d533bf3935388da3f7ebd13691cd956a1403629d8e2be3", "da4611d74d0d361299318656555fff41c556fb801f1e8184555032c3d4534559"],
};
const RFC_SINGLE_ROOT = h("0464adcacce1e8c142e5f5f2ab4d099780344a53eaa89a3c888e2f6cdaaa784e");

// an independent public receipt log, signed by an independent
// Python implementation. Genesis head: verbatim in an internal repository
// packages/twzrd-x402-gate/test/log-inclusion-offline.test.ts @ fb659ab86.
// Size-7 head and the 1 -> 7 consistency path: fetched from
// https://intel.twzrd.xyz/v1/log/sth and /v1/log/proof/consistency on
// 2026-10-01. Used only as test data.
const TWZRD_LOG_KEY = decodeBase58("Ak5SQwHpuQAqU7ty7ZWX7qgF39A9yi72c22KNn8sHzvS");
const TWZRD_GENESIS_LEAF = h("f7e88f2666a0590d8cf7d426d4842e29a23b66607f2c0a691bf6fc7d0d63ba8f");
const TWZRD_GENESIS = {
  logId: "intel.twzrd.xyz/v6",
  treeSize: 1,
  timestamp: 1788450541,
  root: h("811e1fee65f06c5cfcfee8f338e933c1d3dd261c4c09b8f2793b62bea7ea6db4"),
  signature: decodeBase58("5tgH6Y9x1pcE5eDWjaNb8reUpuy88A5xNanSsJu1A5hEgKbH2kwZtAev6ifE9RWTspkvkvhvuLEGtPbpEN5yVete"),
};
const TWZRD_SIZE_7 = {
  logId: "intel.twzrd.xyz/v6",
  treeSize: 7,
  timestamp: 1790813567,
  root: h("1c1a5f794035749bbb47a7251955ed12f019a9c0034a7bc043a31eb0cb8f19f3"),
  signature: decodeBase58("5yyfo1NgsVZUhtmdc6zj9knrSnt2JpHHBsaVVHs7AhuSS2EkWLBZqDafU9ZTTYeZEGvv232Bg8mpaQGS8ASrV5tK"),
};
const TWZRD_1_TO_7 = [
  "d866a884403e864fd4b36e6c78ab1dadf18126eb87d3f3b41d972aa4d98b11bc",
  "3c26a150cb2568620eb5306f7ea16c413b9d6e42b319f184b21f7aaa9902a95d",
  "c3d2248ce71b13875e8012b1c7515b6317ff08aa70e186673aa7f9d4999d4982",
].map(h);

// --- independent vectors ---

test("root and inclusion paths match the program's RFC 9162 vectors", () => {
  assert.equal(hex(treeRoot(RFC_ENTRIES)), hex(RFC_ROOT));
  assert.equal(hex(treeRoot(RFC_ENTRIES, 1)), hex(RFC_SINGLE_ROOT));
  for (const [index, proof] of Object.entries(RFC_PROOFS)) {
    assert.deepEqual(inclusionPath(RFC_ENTRIES, Number(index)).map(hex), proof);
    assert.equal(verifyInclusion(RFC_ENTRIES[index], Number(index), 7, proof.map(h), RFC_ROOT), true);
  }
  assert.equal(verifyInclusion(RFC_ENTRIES[0], 0, 1, [], RFC_SINGLE_ROOT), true);
});

test("inclusion rejects what the program rejects, and binds size only as far as it does", () => {
  const p3 = RFC_PROOFS[3].map(h);
  const p6 = RFC_PROOFS[6].map(h);
  assert.equal(verifyInclusion(RFC_ENTRIES[3], 2, 7, p3, RFC_ROOT), false);
  // Same as the program: index 3's path has the same shape at sizes 5..8, so it
  // also verifies at 8. The size must come from a signed head, never the path.
  assert.equal(verifyInclusion(RFC_ENTRIES[3], 3, 8, p3, RFC_ROOT), true);
  assert.equal(verifyInclusion(RFC_ENTRIES[6], 6, 8, p6, RFC_ROOT), false);
  assert.equal(verifyInclusion(RFC_ENTRIES[3], 7, 7, p3, RFC_ROOT), false);
  assert.equal(verifyInclusion(RFC_ENTRIES[3], 3, 0, p3, RFC_ROOT), false);
  assert.equal(verifyInclusion(RFC_ENTRIES[0], 3, 7, p3, RFC_ROOT), false);
  assert.equal(verifyInclusion(RFC_ENTRIES[3], 3, 7, p3, flip(RFC_ROOT)), false);
  assert.equal(verifyInclusion(RFC_ENTRIES[3], 3, 7, [...p3.slice(0, 2), p3[2].subarray(1)], RFC_ROOT), false);
});

test("signed heads match TWZRD's public log byte for byte", () => {
  assert.equal(verifyTreeHead(TWZRD_GENESIS, TWZRD_LOG_KEY), true);
  assert.equal(verifyTreeHead(TWZRD_SIZE_7, TWZRD_LOG_KEY), true);
  assert.equal(hex(leafHash(TWZRD_GENESIS_LEAF)), hex(TWZRD_GENESIS.root));
  assert.equal(verifyTreeHead({ ...TWZRD_SIZE_7, timestamp: TWZRD_SIZE_7.timestamp + 1 }, TWZRD_LOG_KEY), false);
  assert.equal(verifyTreeHead({ ...TWZRD_SIZE_7, logId: "radiolan.attribution.v1" }, TWZRD_LOG_KEY), false);
});

test("consistency matches TWZRD's public 1 -> 7 proof", () => {
  assert.equal(verifyConsistency(1, 7, TWZRD_1_TO_7, TWZRD_GENESIS.root, TWZRD_SIZE_7.root), true);
  assert.equal(verifyHeadConsistency(TWZRD_GENESIS, TWZRD_SIZE_7, TWZRD_1_TO_7, TWZRD_LOG_KEY), true);
  assert.equal(verifyConsistency(1, 7, TWZRD_1_TO_7, flip(TWZRD_GENESIS.root), TWZRD_SIZE_7.root), false);
  assert.equal(verifyConsistency(1, 7, TWZRD_1_TO_7, TWZRD_GENESIS.root, flip(TWZRD_SIZE_7.root)), false);
  assert.equal(verifyConsistency(1, 7, [TWZRD_1_TO_7[0], flip(TWZRD_1_TO_7[1]), TWZRD_1_TO_7[2]], TWZRD_GENESIS.root, TWZRD_SIZE_7.root), false);
  // Like inclusion paths, a consistency path does not bind the sizes: this one
  // has the same shape for 1 -> 5..8. Sizes must come from signed heads, which
  // verifyHeadConsistency takes them from.
  for (const size of [5, 6, 8]) assert.equal(verifyConsistency(1, size, TWZRD_1_TO_7, TWZRD_GENESIS.root, TWZRD_SIZE_7.root), true);
  for (const size of [4, 9]) assert.equal(verifyConsistency(1, size, TWZRD_1_TO_7, TWZRD_GENESIS.root, TWZRD_SIZE_7.root), false);
  assert.equal(verifyHeadConsistency(TWZRD_GENESIS, { ...TWZRD_SIZE_7, treeSize: 6 }, TWZRD_1_TO_7, TWZRD_LOG_KEY), false);
  assert.equal(verifyConsistency(1, 7, TWZRD_1_TO_7.slice(0, 2), TWZRD_GENESIS.root, TWZRD_SIZE_7.root), false);
});

// --- generator and verifier agree everywhere, and disagree on any change ---

test("every inclusion and consistency proof up to 40 entries verifies", () => {
  for (let size = 1; size <= 40; size += 1) {
    const log = entries(size);
    const root = treeRoot(log);
    for (let index = 0; index < size; index += 1) {
      assert.equal(verifyInclusion(log[index], index, size, inclusionPath(log, index), root), true, `inclusion ${index}/${size}`);
    }
    for (let old = 1; old <= size; old += 1) {
      const path = consistencyPath(log, old, size);
      assert.equal(verifyConsistency(old, size, path, treeRoot(log, old), root), true, `consistency ${old}->${size}`);
    }
  }
});

test("any changed node, root or entry breaks a proof", () => {
  for (const size of [2, 3, 5, 8, 13, 21]) {
    const log = entries(size);
    const root = treeRoot(log);
    for (let index = 0; index < size; index += 1) {
      const path = inclusionPath(log, index);
      path.forEach((_, at) => {
        const bad = path.map((node, i) => (i === at ? flip(node, 5) : node));
        assert.equal(verifyInclusion(log[index], index, size, bad, root), false);
      });
      assert.equal(verifyInclusion(flip(log[index], 31), index, size, path, root), false);
    }
    for (let old = 1; old < size; old += 1) {
      const path = consistencyPath(log, old, size);
      const oldRoot = treeRoot(log, old);
      path.forEach((_, at) => {
        const bad = path.map((node, i) => (i === at ? flip(node, 9) : node));
        assert.equal(verifyConsistency(old, size, bad, oldRoot, root), false, `${old}->${size} node ${at}`);
      });
      // A log that rewrote an old entry is not consistent with the old head.
      const rewritten = log.map((entry, i) => (i === 0 ? flip(entry) : entry));
      assert.equal(verifyConsistency(old, size, consistencyPath(rewritten, old, size), oldRoot, treeRoot(rewritten)), false);
    }
  }
});

test("a short path cannot prove against a smaller tree's root under a larger size", () => {
  // Without the program's final "sn == 0" check, index 0's size-4 path and
  // size-4 root would also pass as a size-8 tree.
  const log = entries(8);
  const path4 = inclusionPath(log, 0, 4);
  assert.equal(verifyInclusion(log[0], 0, 4, path4, treeRoot(log, 4)), true);
  assert.equal(verifyInclusion(log[0], 0, 8, path4, treeRoot(log, 4)), false);
  assert.equal(verifyInclusion(log[0], 0, 8, inclusionPath(log, 0, 8), treeRoot(log, 8)), true);
});

test("equal sizes need an empty proof and equal roots; bad shapes are false, not errors", () => {
  const log = entries(5);
  const root = treeRoot(log);
  assert.deepEqual(consistencyPath(log, 5), []);
  assert.equal(verifyConsistency(5, 5, [], root, root), true);
  assert.equal(verifyConsistency(5, 5, [root], root, root), false);
  assert.equal(verifyConsistency(5, 5, [], root, flip(root)), false);
  assert.equal(verifyConsistency(3, 5, [], treeRoot(log, 3), root), false);
  assert.equal(verifyConsistency(0, 5, [], root, root), false);
  assert.equal(verifyConsistency(6, 5, [], root, root), false);
  assert.equal(verifyConsistency(3, 5, "nope", treeRoot(log, 3), root), false);
  assert.equal(verifyInclusion(log[0], 0, 5, Array(MAX_PATH + 1).fill(root), root), false);
  assert.equal(verifyInclusion(log[0], -1, 5, [], root), false);
  assert.equal(verifyInclusion(log[0], 0, 2 ** 53, [], root), false);
  assert.throws(() => treeRoot([]), RangeError);
  assert.throws(() => treeRoot(log, 6), RangeError);
  assert.throws(() => inclusionPath(log, 5), RangeError);
  assert.throws(() => consistencyPath(log, 0), RangeError);
  assert.throws(() => leafHash(new Uint8Array(31)), TypeError);
});

// --- Radio LAN heads ---

test("a head's preimage is the program's layout", () => {
  const root = new Uint8Array(32).fill(0xab);
  const pre = treeHeadPreimage({ logId: "radiolan.attribution.v1", treeSize: 258, timestamp: 1790000000, root });
  assert.equal(pre.length, 24 + 2 + 23 + 8 + 8 + 32);
  assert.equal(Buffer.from(pre.subarray(0, 24)).toString(), "TWZRD:RECEIPT_LOG_STH_V1");
  assert.equal(hex(pre.subarray(24, 26)), "1700");
  assert.equal(Buffer.from(pre.subarray(26, 49)).toString(), "radiolan.attribution.v1");
  assert.equal(hex(pre.subarray(49, 57)), "0201000000000000");
  assert.equal(hex(pre.subarray(57, 65)), "803bb16a00000000"); // 1790000000 = 0x6ab13b80
  assert.equal(hex(pre.subarray(65)), hex(root));
  assert.throws(() => treeHeadPreimage({ logId: "x".repeat(65), treeSize: 1, timestamp: 0, root }), /1..64/);
  assert.throws(() => treeHeadPreimage({ logId: "", treeSize: 1, timestamp: 0, root }), /1..64/);
  assert.throws(() => treeHeadPreimage({ logId: "a", treeSize: 0, timestamp: 0, root }), /tree size/);
});

test("Radio LAN heads sign, verify, survive JSON, and refuse any change", () => {
  const logKey = signerFromSeed(new Uint8Array(32).fill(3));
  const log = entries(9);
  const head = signTreeHead({ treeSize: 9, timestamp: 1790000000, root: treeRoot(log) }, logKey);
  assert.equal(head.logId, "radiolan.attribution.v1");
  assert.equal(verifyTreeHead(head, logKey.publicKey), true);
  assert.equal(verifyTreeHead(headFromJSON(headToJSON(head)), logKey.publicKey), true);
  assert.equal(verifyTreeHead(head, signerFromSeed(new Uint8Array(32).fill(4)).publicKey), false);
  for (const change of [{ treeSize: 10 }, { timestamp: 1790000001 }, { root: flip(head.root) }, { signature: flip(head.signature) }]) {
    assert.equal(verifyTreeHead({ ...head, ...change }, logKey.publicKey), false);
  }
  assert.equal(verifyTreeHead({ ...head, treeSize: "9" }, logKey.publicKey), false);
  assert.throws(() => headFromJSON({ ...headToJSON(head), root: "AB".repeat(32) }), /lowercase hex/);

  const older = signTreeHead({ treeSize: 4, timestamp: 1789999000, root: treeRoot(log, 4) }, logKey);
  assert.equal(verifyHeadConsistency(older, head, consistencyPath(log, 4, 9), logKey.publicKey), true);
  const otherLog = signTreeHead({ logId: "radiolan.attribution.v2", treeSize: 9, timestamp: 1790000000, root: treeRoot(log) }, logKey);
  assert.equal(verifyHeadConsistency(older, otherLog, consistencyPath(log, 4, 9), logKey.publicKey), false);
});
