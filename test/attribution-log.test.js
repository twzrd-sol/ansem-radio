import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { claimId, claimText } from "../src/attribution/claim.js";
import { headFromJSON, headToJSON, signTreeHead, verifyHeadConsistency, verifyTreeHead } from "../src/attribution/head.js";
import { createAttributionLog, loadAttributionLog } from "../src/attribution/log.js";
import { issueReceipt, verifyReceipt } from "../src/attribution/receipt.js";
import { createAttributionRecord } from "../src/attribution/record.js";
import { treeRoot } from "../src/attribution/tree.js";
import { decodeBase58, encodeBase58 } from "../src/core/base58.js";
import { signerFromSeed } from "../src/core/ed25519.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/attribution-v1.json", import.meta.url), "utf8"));
const fromHex = (text) => new Uint8Array(Buffer.from(text, "hex"));
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const bytes = (text) => new TextEncoder().encode(text);

const creator = signerFromSeed(fromHex(fixture.creator_seed));
const collaborator = signerFromSeed(fromHex(fixture.collaborator_seed));
const logKey = signerFromSeed(fromHex(fixture.log_seed));
const otherKey = signerFromSeed(new Uint8Array(32).fill(4));
const BINDING = fixture.binding;

function credit(work = "clip", deliverable = fixture.deliverable_text) {
  const text = claimText({
    action: "credit",
    network: "devnet",
    creator: encodeBase58(creator.publicKey),
    binding: BINDING,
    work,
    scope: sha(fixture.scope_text),
    deliverable: sha(deliverable),
    collaborator: encodeBase58(collaborator.publicKey),
  });
  return { text, creatorSignature: creator.sign(bytes(text)), collaboratorSignature: collaborator.sign(bytes(text)) };
}

function revoke(creditText) {
  const text = claimText({
    action: "revoke",
    network: "devnet",
    creator: encodeBase58(creator.publicKey),
    binding: BINDING,
    revokes: claimId(creditText),
  });
  return { text, creatorSignature: creator.sign(bytes(text)) };
}

function clock(start = 1790000000) {
  let t = start;
  return () => (t += 60);
}

const newLog = () => createAttributionLog({ network: "devnet", headSigner: logKey, now: clock() });
const check = (receipt, key = logKey.publicKey, network = "devnet") => verifyReceipt(receipt, key, { network });

// --- golden head (a regression pin produced by this code) ---

test("the fixture's head and inclusion paths reproduce", () => {
  assert.equal(encodeBase58(logKey.publicKey), fixture.log_public_key);
  const commitments = fixture.entries.map((entry) => fromHex(entry.commitment));
  const head = signTreeHead({ treeSize: 2, timestamp: fixture.head.timestamp_unix, root: treeRoot(commitments) }, logKey);
  assert.deepEqual(headToJSON(head), fixture.head);
  assert.equal(verifyTreeHead(headFromJSON(fixture.head), decodeBase58(fixture.log_public_key)), true);

  const times = [fixture.entries[0].appended_at, fixture.entries[1].appended_at];
  const salts = fixture.entries.map((entry) => fromHex(entry.salt));
  const record = createAttributionRecord({ network: "devnet", now: () => times.shift(), randomSalt: () => salts.shift() });
  record.append({ text: fixture.entries[0].text, creatorSignature: fromHex(fixture.entries[0].signatures[0]), collaboratorSignature: fromHex(fixture.entries[0].signatures[1]) });
  record.append({ text: fixture.entries[1].text, creatorSignature: fromHex(fixture.entries[1].signatures[0]) });
  for (const index of [0, 1]) {
    const receipt = issueReceipt(record, index, headFromJSON(fixture.head));
    assert.deepEqual(receipt.path, fixture.inclusion[index]);
    assert.equal(check(receipt, decodeBase58(fixture.log_public_key)).ok, true);
  }
});

// --- appending ---

test("every append signs a head and hands back a receipt that verifies on its own", () => {
  const log = newLog();
  const first = log.append(credit());
  assert.equal(first.head.treeSize, 1);
  assert.equal(verifyTreeHead(first.head, logKey.publicKey), true);
  const result = check(first.receipt);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.claim.work, "clip");
  assert.equal(result.index, 0);

  const second = log.append(credit("edit"));
  assert.equal(second.head.treeSize, 2);
  assert.equal(check(second.receipt).ok, true);
  const third = log.append(revoke(first.entry.text));
  assert.equal(check(third.receipt).ok, true);
  assert.equal(check(third.receipt).claim.action, "revoke");
  assert.equal(log.head(), third.head);
});

test("a receipt is JSON: it survives a round trip and carries no viewer fields", () => {
  const { receipt } = newLog().append(credit());
  const copy = JSON.parse(JSON.stringify(receipt));
  assert.equal(check(copy).ok, true);
  const text = JSON.stringify(receipt).toLowerCase();
  for (const word of ["participant", "viewer", "twitch", "login", "user-hmac"]) assert.equal(text.includes(word), false, word);
  assert.deepEqual(Object.keys(receipt).sort(), ["appended_at", "commitment", "head", "index", "path", "salt", "signatures", "text", "v"]);
});

test("a receipt fails on the wrong log key, the wrong network, or any changed field", () => {
  const log = newLog();
  log.append(credit("edit"));
  const { receipt } = log.append(credit());
  const flip = (text) => (text[0] === "a" ? "b" : "a") + text.slice(1);
  const cases = [
    [check(receipt, otherKey.publicKey), /head signature/],
    [check(receipt, logKey.publicKey, "mainnet"), /claim is for devnet/],
    [check({ ...receipt, text: receipt.text.replace("work: clip", "work: edit") }), /creator signature/],
    [check({ ...receipt, signatures: [receipt.signatures[0], flip(receipt.signatures[1])] }), /collaborator signature/],
    [check({ ...receipt, salt: flip(receipt.salt) }), /commitment does not match/],
    [check({ ...receipt, appended_at: receipt.appended_at + 1 }), /commitment does not match/],
    [check({ ...receipt, commitment: flip(receipt.commitment) }), /commitment does not match/],
    [check({ ...receipt, index: 0 }), /not in the head's tree/],
    [check({ ...receipt, path: [flip(receipt.path[0])] }), /not in the head's tree/],
    [check({ ...receipt, path: [] }), /not in the head's tree/],
    [check({ ...receipt, head: { ...receipt.head, root: flip(receipt.head.root) } }), /head signature/],
    [check({ ...receipt, head: { ...receipt.head, tree_size: 3 } }), /head signature/],
    [check({ ...receipt, v: 2 }), /unknown receipt version/],
    [check(null), /unknown receipt version/],
  ];
  for (const [result, reason] of cases) {
    assert.equal(result.ok, false);
    assert.match(result.reason, reason);
  }
});

test("a head signed for another log is refused even with the right key", () => {
  const log = newLog();
  const { receipt } = log.append(credit());
  const other = signTreeHead(
    { logId: "radiolan.attribution.v2", treeSize: 1, timestamp: 1790000000, root: fromHex(receipt.head.root) },
    logKey,
  );
  assert.match(check({ ...receipt, head: headToJSON(other) }).reason, /another log/);
});

test("old receipts stay valid as the log grows, and old heads are consistent with new ones", () => {
  const log = newLog();
  const early = log.append(credit());
  for (const work of ["edit", "guest_segment"]) log.append(credit(work));
  for (let i = 0; i < 6; i += 1) log.append(credit("clip", `deliverable ${i}\n`));
  const latest = log.head();
  assert.equal(latest.treeSize, 9);
  assert.equal(check(early.receipt).ok, true);
  assert.equal(verifyHeadConsistency(early.head, latest, log.consistency(1), logKey.publicKey), true);
  assert.equal(check(log.receipt(0)).ok, true);
  assert.equal(log.receipt(0).head.tree_size, 9);
  assert.deepEqual(log.inclusion(0, 9).map(hex), log.receipt(0).path);
});

test("erasure keeps every head consistent and every issued receipt valid", () => {
  const log = newLog();
  const first = log.append(credit());
  const second = log.append(credit("edit"));
  log.append(revoke(first.entry.text));
  const before = log.signHead();

  assert.deepEqual(log.erase(0), [0, 2]);
  const after = log.signHead();
  assert.equal(hex(after.root), hex(before.root));
  assert.equal(verifyHeadConsistency(first.head, after, log.consistency(1), logKey.publicKey), true);
  assert.equal(check(first.receipt).ok, true); // the signer's own copy
  assert.equal(check(log.receipt(1)).ok, true);
  assert.equal(check(second.receipt).ok, true);
  assert.throws(() => log.receipt(0), /no live entry/);
});

test("a receipt cannot be issued under a head that does not match the record", () => {
  const log = newLog();
  log.append(credit());
  const record = createAttributionRecord({ network: "devnet" });
  record.append(credit());
  const forged = signTreeHead({ treeSize: 1, timestamp: 1, root: new Uint8Array(32) }, logKey);
  assert.throws(() => issueReceipt(record, 0, forged), /does not match this record/);
  const tooBig = signTreeHead({ treeSize: 2, timestamp: 1, root: new Uint8Array(32) }, logKey);
  assert.throws(() => issueReceipt(record, 0, tooBig), /does not match this record/);
  assert.throws(() => issueReceipt(record, 1, log.head()), /no live entry/);
});

test("a reloaded log re-verifies, has no head until it signs one, then matches the old root", () => {
  const log = newLog();
  log.append(credit());
  log.append(credit("edit"));
  const root = hex(log.head().root);
  const reloaded = loadAttributionLog(log.toLines(), { network: "devnet", headSigner: logKey, now: clock(1790009000) });
  assert.equal(reloaded.head(), null);
  assert.throws(() => reloaded.receipt(0), /no head yet/);
  assert.equal(hex(reloaded.signHead().root), root);
  assert.equal(check(reloaded.receipt(1)).ok, true);
});

test("a failed append signs no head", () => {
  const log = newLog();
  const bad = { ...credit(), creatorSignature: new Uint8Array(64) };
  assert.throws(() => log.append(bad), /creator signature/);
  assert.equal(log.head(), null);
  assert.equal(log.size, 0);
  assert.throws(() => log.signHead(), /empty log/);
  assert.throws(() => createAttributionLog({ network: "devnet" }), /headSigner/);
});
