import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { ClaimError, claimId, claimText, parseClaimText } from "../src/attribution/claim.js";
import {
  createAttributionRecord,
  entryCommitment,
  loadAttributionRecord,
  recordDigest,
} from "../src/attribution/record.js";
import { encodeBase58 } from "../src/core/base58.js";
import { signerFromSeed } from "../src/core/ed25519.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/attribution-v1.json", import.meta.url), "utf8"));
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const fromHex = (text) => new Uint8Array(Buffer.from(text, "hex"));
const sha = (text) => createHash("sha256").update(text).digest("hex");
const bytes = (text) => new TextEncoder().encode(text);

const creator = signerFromSeed(fromHex(fixture.creator_seed));
const collaborator = signerFromSeed(fromHex(fixture.collaborator_seed));
const stranger = signerFromSeed(new Uint8Array(32).fill(9));
const CREATOR = encodeBase58(creator.publicKey);
const COLLABORATOR = encodeBase58(collaborator.publicKey);
const BINDING = "bb".repeat(32);

function credit(overrides = {}) {
  return claimText({
    action: "credit",
    network: "devnet",
    creator: CREATOR,
    binding: BINDING,
    work: "clip",
    scope: sha(fixture.scope_text),
    deliverable: sha(fixture.deliverable_text),
    collaborator: COLLABORATOR,
    ...overrides,
  });
}

function signedCredit(text = credit()) {
  return { text, creatorSignature: creator.sign(bytes(text)), collaboratorSignature: collaborator.sign(bytes(text)) };
}

function revokeOf(creditText, signer = creator, overrides = {}) {
  const text = claimText({
    action: "revoke",
    network: "devnet",
    creator: encodeBase58(signer.publicKey),
    binding: BINDING,
    revokes: claimId(creditText),
    ...overrides,
  });
  return { text, creatorSignature: signer.sign(bytes(text)) };
}

function fixtureRecord() {
  const times = fixture.entries.map((entry) => entry.appended_at);
  const salts = fixture.entries.map((entry) => fromHex(entry.salt));
  return createAttributionRecord({ network: "devnet", now: () => times.shift(), randomSalt: () => salts.shift() });
}

// --- claim text ---

test("claim text is the fixed, wallet-readable layout", () => {
  assert.equal(credit(), fixture.entries[0].text);
  assert.ok(credit().startsWith("Radio LAN attribution\nversion: 1\naction: credit\nnetwork: devnet\n"));
  const parsed = parseClaimText(credit());
  assert.equal(parsed.collaborator, COLLABORATOR);
  assert.equal(parsed.log, "radiolan.attribution.v1");
  assert.equal(claimId(credit()), fixture.entries[0].claim_id);
});

test("claim text that is not byte-for-byte canonical is refused", () => {
  const text = credit();
  const variants = [
    text.replace(/\n/g, "\r\n"),
    text.slice(0, -1),
    `${text}\n`,
    text.replace("work: clip", "work:  clip"),
    text.replace("work: clip", "work: clip "),
    text.replace(sha(fixture.scope_text), sha(fixture.scope_text).toUpperCase()),
    text.replace("network: devnet\nlog: radiolan.attribution.v1\n", "log: radiolan.attribution.v1\nnetwork: devnet\n"),
    text.replace("Radio LAN attribution", "Radio LAN Attribution"),
    text.replace("version: 1", "version: 2"),
    text.replace("log: radiolan.attribution.v1", "log: radiolan.attribution.v2"),
    `${text}extra: field\n`,
    text.replace(`collaborator: ${COLLABORATOR}\n`, `collaborator: ${COLLABORATOR}\ncollaborator: ${COLLABORATOR}\n`),
  ];
  for (const variant of variants) assert.throws(() => parseClaimText(variant), ClaimError, JSON.stringify(variant));
});

test("claims refuse unknown work, networks and fields, bad hashes and self-credit", () => {
  assert.throws(() => credit({ work: "raid" }), /work must be one of clip, edit, guest_segment/);
  assert.throws(() => credit({ network: "testnet" }), /network/);
  assert.throws(() => credit({ scope: "ab" }), /scope/);
  assert.throws(() => credit({ collaborator: "nope" }), /collaborator/);
  assert.throws(() => credit({ collaborator: CREATOR }), /must not be the creator/);
  assert.throws(() => credit({ amount: "5" }), /unknown claim fields: amount/);
  assert.throws(() => credit({ participant_id: "user-hmac:00" }), /unknown claim fields/);
  assert.throws(() => credit({ log: "other.log" }), /log must be/);
  for (const work of ["clip", "edit", "guest_segment"]) assert.equal(parseClaimText(credit({ work })).work, work);
});

// --- golden fixture (a regression pin produced by this code; primitives are pinned elsewhere) ---

test("the fixture's credit and revoke reproduce their digests and commitments", () => {
  const record = fixtureRecord();
  const first = record.append({
    text: fixture.entries[0].text,
    creatorSignature: fromHex(fixture.entries[0].signatures[0]),
    collaboratorSignature: fromHex(fixture.entries[0].signatures[1]),
  });
  const second = record.append({
    text: fixture.entries[1].text,
    creatorSignature: fromHex(fixture.entries[1].signatures[0]),
  });
  for (const [entry, expected] of [[first, fixture.entries[0]], [second, fixture.entries[1]]]) {
    const signatures = expected.signatures.map(fromHex);
    assert.equal(hex(recordDigest(expected.text, signatures, expected.appended_at)), expected.record_digest);
    assert.equal(hex(entryCommitment(fromHex(expected.salt), fromHex(expected.record_digest))), expected.commitment);
    assert.equal(hex(entry.commitment), expected.commitment);
    assert.equal(entry.claim_id, expected.claim_id);
  }
  // Ed25519 is deterministic, so the fixture's signatures are exactly what the seeds produce.
  assert.equal(hex(creator.sign(bytes(fixture.entries[0].text))), fixture.entries[0].signatures[0]);
  assert.equal(record.isCredited(fixture.entries[0].claim_id), false);
});

test("the digest covers the server time and every signature, not only the claim", () => {
  const text = credit();
  const sigs = [creator.sign(bytes(text)), collaborator.sign(bytes(text))];
  const base = hex(recordDigest(text, sigs, 100));
  assert.notEqual(hex(recordDigest(text, sigs, 101)), base);
  assert.notEqual(hex(recordDigest(text, [sigs[0]], 100)), base);
  assert.notEqual(hex(recordDigest(text, [sigs[1], sigs[0]], 100)), base);
  const salt = new Uint8Array(32);
  assert.notEqual(hex(entryCommitment(salt, fromHex(base))), hex(entryCommitment(salt.fill(1), fromHex(base))));
});

// --- appending ---

test("a credit needs both signatures over the exact claim text", () => {
  const record = createAttributionRecord({ network: "devnet" });
  const good = signedCredit();
  assert.throws(() => record.append({ ...good, creatorSignature: stranger.sign(bytes(good.text)) }), /creator signature/);
  assert.throws(() => record.append({ ...good, collaboratorSignature: stranger.sign(bytes(good.text)) }), /collaborator signature/);
  assert.throws(
    () => record.append({ ...good, creatorSignature: good.collaboratorSignature, collaboratorSignature: good.creatorSignature }),
    /creator signature/,
  );
  const other = credit({ work: "edit" });
  assert.throws(() => record.append({ ...good, text: other }), /creator signature/);
  assert.throws(() => record.append({ text: good.text, creatorSignature: good.creatorSignature }), /collaborator signature must be 64 bytes/);
  assert.equal(record.size, 0);
  const entry = record.append(good);
  assert.equal(entry.index, 0);
  assert.equal(record.isCredited(claimId(good.text)), true);
  assert.throws(() => record.append(good), /already in the record/);
});

test("a record takes claims for its own network only", () => {
  const record = createAttributionRecord({ network: "mainnet" });
  assert.throws(() => record.append(signedCredit()), /claim is for devnet, record is mainnet/);
  assert.throws(() => createAttributionRecord({ network: "testnet" }), /network/);
});

test("revokes: creator only, same wallet and binding, live target, once", () => {
  const record = createAttributionRecord({ network: "devnet" });
  const good = signedCredit();
  record.append(good);

  const byStranger = revokeOf(good.text, stranger);
  assert.throws(() => record.append(byStranger), /only the crediting wallet and binding/);
  const otherBinding = revokeOf(good.text, creator, { binding: "cc".repeat(32) });
  assert.throws(() => record.append(otherBinding), /only the crediting wallet and binding/);
  const unknown = revokeOf(credit({ work: "edit" }));
  assert.throws(() => record.append(unknown), /no live credit/);
  const revoke = revokeOf(good.text);
  assert.throws(
    () => record.append({ ...revoke, collaboratorSignature: collaborator.sign(bytes(revoke.text)) }),
    /creator only/,
  );
  assert.throws(() => record.append({ ...revoke, creatorSignature: stranger.sign(bytes(revoke.text)) }), /creator signature/);

  record.append(revoke);
  assert.equal(record.isCredited(claimId(good.text)), false);
  assert.throws(() => record.append(revoke), /already revoked/);
  const revokeOfRevoke = claimText({ action: "revoke", network: "devnet", creator: CREATOR, binding: BINDING, revokes: claimId(revoke.text) });
  assert.throws(() => record.append({ text: revokeOfRevoke, creatorSignature: creator.sign(bytes(revokeOfRevoke)) }), /no live credit/);
  assert.equal(record.size, 2);
});

test("a failed append changes nothing", () => {
  const salts = [];
  const record = createAttributionRecord({
    network: "devnet",
    randomSalt: () => {
      salts.push(1);
      return new Uint8Array(32);
    },
  });
  assert.throws(() => record.append({ ...signedCredit(), creatorSignature: new Uint8Array(64) }));
  assert.equal(record.size, 0);
  assert.equal(salts.length, 0);
  assert.throws(() => createAttributionRecord({ network: "devnet", now: () => -1 }).append(signedCredit()), /unix seconds/);
  assert.throws(() => createAttributionRecord({ network: "devnet", randomSalt: () => new Uint8Array(31) }).append(signedCredit()), /salt/);
});

test("entries hold no viewer, participant or Twitch fields", () => {
  const record = createAttributionRecord({ network: "devnet" });
  const entry = record.append(signedCredit());
  const serialized = record.toLines().join("\n");
  for (const word of ["participant", "viewer", "twitch", "login", "user-hmac"]) {
    assert.equal(serialized.toLowerCase().includes(word), false, word);
  }
  assert.deepEqual(Object.keys(entry).sort(), ["appended_at", "claim", "claim_id", "commitment", "index", "salt", "signatures", "text"]);
});

// --- erasure ---

test("erasing a credit erases its revoke too, and the commitments stay byte-identical", () => {
  const record = createAttributionRecord({ network: "devnet" });
  const first = signedCredit();
  const second = signedCredit(credit({ work: "guest_segment" }));
  record.append(first);
  record.append(second);
  record.append(revokeOf(first.text));
  const before = record.commitments().map(hex);

  assert.deepEqual(record.erase(0), [0, 2]);
  assert.deepEqual(record.commitments().map(hex), before);
  assert.equal(record.entry(0).erased, true);
  assert.equal(record.entry(2).erased, true);
  assert.deepEqual(Object.keys(record.entry(0)).sort(), ["commitment", "erased", "index"]);
  assert.equal(record.entry(1).erased, undefined);
  assert.equal(record.isCredited(claimId(second.text)), true);
  // Only the erased credit has "work: clip"; the live one is a guest segment.
  assert.equal(record.toLines().join("\n").includes("work: clip"), false);
  assert.equal(record.toLines().join("\n").includes("work: guest_segment"), true);
  assert.throws(() => record.erase(0), /no live entry/);
});

test("erasing a revoke erases its credit, so the credit is not silently reinstated", () => {
  const record = createAttributionRecord({ network: "devnet" });
  const good = signedCredit();
  record.append(good);
  record.append(revokeOf(good.text));
  assert.deepEqual(record.erase(1), [0, 1]);
  assert.equal(record.isCredited(claimId(good.text)), false);
});

test("commitments are copies, so callers cannot change the record", () => {
  const record = createAttributionRecord({ network: "devnet" });
  const salt = new Uint8Array(32).fill(3);
  const own = createAttributionRecord({ network: "devnet", randomSalt: () => salt });
  own.append(signedCredit());
  const before = hex(own.commitments()[0]);
  own.commitments()[0].fill(0);
  salt.fill(0);
  assert.equal(hex(own.commitments()[0]), before);
  assert.equal(record.size, 0);
  assert.equal(loadAttributionRecord(own.toLines(), { network: "devnet" }).size, 1);
});

// --- storage ---

test("stored lines load back, re-verified, tombstones included", () => {
  const record = createAttributionRecord({ network: "devnet" });
  const first = signedCredit();
  record.append(first);
  record.append(signedCredit(credit({ work: "edit" })));
  record.append(revokeOf(first.text));
  record.erase(1);
  const loaded = loadAttributionRecord(record.toLines(), { network: "devnet" });
  assert.deepEqual(loaded.commitments().map(hex), record.commitments().map(hex));
  assert.deepEqual(loaded.toLines(), record.toLines());
  assert.equal(loaded.isCredited(claimId(first.text)), false);
});

test("loading refuses any tampered line", () => {
  const record = createAttributionRecord({ network: "devnet" });
  record.append(signedCredit());
  const [line] = record.toLines();
  const raw = JSON.parse(line);
  const tamper = (change) => JSON.stringify({ ...raw, ...change(raw) });
  const flip = (text) => (text[0] === "a" ? "b" : "a") + text.slice(1);
  const cases = [
    [tamper((r) => ({ text: r.text.replace("work: clip", "work: edit") })), /creator signature/],
    [tamper((r) => ({ signatures: [flip(r.signatures[0]), r.signatures[1]] })), /creator signature/],
    [tamper((r) => ({ signatures: [r.signatures[0], flip(r.signatures[1])] })), /collaborator signature/],
    [tamper((r) => ({ signatures: [r.signatures[0]] })), /collaborator signature must be 64 bytes/],
    [tamper((r) => ({ salt: flip(r.salt) })), /commitment does not match/],
    [tamper((r) => ({ appended_at: r.appended_at + 1 })), /commitment does not match/],
    [tamper((r) => ({ commitment: flip(r.commitment) })), /commitment does not match/],
    [tamper(() => ({ index: 1 })), /wrong version or index/],
    [tamper(() => ({ v: 2 })), /wrong version or index/],
    ["{not json", /not JSON/],
  ];
  for (const [bad, error] of cases) {
    assert.throws(() => loadAttributionRecord([bad], { network: "devnet" }), error, bad);
  }
  assert.throws(() => loadAttributionRecord([line], { network: "mainnet" }), /record is mainnet/);
});
