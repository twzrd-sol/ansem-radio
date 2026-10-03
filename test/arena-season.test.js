import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { encodeBase58 } from "../src/core/base58.js";
import { treeRoot } from "../src/attribution/tree.js";
import { keccak256 } from "../src/core/keccak.js";
import { MANIFEST_DOMAIN, eventPreimage, eventId, settleSeason, settlementBalances, verifySeasonReceipt } from "../src/arena/season.js";

const creator = generateKeyPairSync("ed25519");
const publicKey = encodeBase58(creator.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
const arena = encodeBase58(new Uint8Array(32).fill(42));
const id = (n) => n.toString(16).padStart(64, "0");
const start = 1791158400; // Mon 2026-10-05 UTC
const config = (changes = {}) => ({ network: "devnet", arena, creator: publicKey, season: "1", arenaSeasonStart: start,
  arenaSeasonSeconds: 5 * 86400, startsAt: start, endsAt: start + 5 * 86400, claimDeadline: start + 7 * 86400, asset: "SOL", budgetBaseUnits: "100",
  policy: { dailyCap: 10, weeklyCap: 30, weights: { question: 1, poll_response: 2, accepted_work: 5 } }, ...changes });
const signed = (event, signer = creator) => ({ event, signature: sign(null, eventPreimage(event), signer.privateKey).toString("hex") });
const credit = (account, action = account, changes = {}) => signed({ type: "credit", source: "arena_native", network: "devnet",
  arena, season: "1", accountId: id(account), actionId: id(action), action: "question", occurredAt: start + 1, ...changes });
const settle = (events, c = config()) => settleSeason(c, events, { now: c.endsAt });

test("zero-token fans earn identical shares without wallet or support position fields", () => {
  const s = settle([credit(1), credit(2)]);
  assert.deepEqual(s.receipts.map((r) => r.amountBaseUnits), ["50", "50"]);
  assert.equal(s.manifest.totalPoints, "2");
  assert.equal(s.manifest.planOnly, true);
  assert.ok(s.receipts.every((r) => verifySeasonReceipt(s.manifest, r)));
});
test("unsafe budgets fail; u64 arithmetic stays exact beyond Number precision", () => {
  assert.throws(() => settle([], config({ budgetBaseUnits: Number.MAX_SAFE_INTEGER + 1 })), /unsafe/);
  const s = settle([credit(1), credit(2), credit(3)], config({ budgetBaseUnits: "18446744073709551615" }));
  assert.deepEqual(s.receipts.map((r) => r.amountBaseUnits), Array(3).fill("6148914691236517205"));
  assert.equal(s.manifest.dustBaseUnits, "0");
  assert.throws(() => settle([], config({ budgetBaseUnits: "18446744073709551616" })), /range/);
});
test("rounding dust remains separate from unpaid allocations", () => {
  const s = settle([credit(1), credit(2), credit(3)]);
  assert.equal(s.manifest.dustBaseUnits, "1");
  assert.deepEqual(settlementBalances(s, [id(1)], { now: config().endsAt }), {
    accountingOnly: true, reportedPaidBaseUnits: "33", reservedBaseUnits: "66", carryBaseUnits: "1",
  });
  assert.equal(settlementBalances(s, [id(1)], { now: config().claimDeadline }).carryBaseUnits, "67");
});
test("empty and zero-budget seasons conserve funds without dividing by zero", () => {
  const empty = settle([]);
  assert.equal(empty.manifest.totalPoints, "0");
  assert.equal(empty.manifest.dustBaseUnits, "100");
  assert.equal(settlementBalances(empty).carryBaseUnits, "100");
  const unfunded = settle([credit(1)], config({ budgetBaseUnits: "0" }));
  assert.equal(unfunded.receipts[0].amountBaseUnits, "0");
  assert.ok(verifySeasonReceipt(unfunded.manifest, unfunded.receipts[0]));
});
test("exact event replay is idempotent; duplicate logical credits are rejected without losing other rows", () => {
  const c = credit(1);
  assert.deepEqual(settle([c, c]), settle([c]));
  const duplicate = credit(1, 1, { occurredAt: start + 2 });
  const result = settle([c, duplicate, credit(2)]);
  assert.deepEqual(result.receipts.map((r) => r.accountId), [id(2)]);
  assert.equal(result.manifest.rejectedEventCount, 2);
  assert.ok(result.rejectedEvents.every((row) => row.reason === "duplicate-logical-credit"));
});
test("daily and weekly caps apply across action types and input order", () => {
  const events = Array.from({ length: 10 }, (_, i) => credit(1, i + 1, { action: "accepted_work", occurredAt: start + 1 + Math.floor(i / 2) * 86400 }));
  const s = settle(events);
  assert.equal(s.manifest.totalPoints, "30");
  assert.deepEqual(s, settle([...events].reverse()));
});
test("valid creator revocation removes points before settlement regardless of delivery order", () => {
  const c = credit(1);
  const revoke = signed({ type: "revoke", source: "arena_native", network: "devnet", arena, season: "1",
    creditId: eventId(c.event), occurredAt: start + 2 });
  const s = settle([revoke, credit(2), c, revoke]);
  assert.deepEqual(s.receipts.map((r) => r.accountId), [id(2)]);
  assert.equal(s.receipts[0].amountBaseUnits, "100");
});
test("revocation cannot name another season, a missing credit, or predate the credit", () => {
  const c = credit(1);
  const make = (changes = {}) => signed({ type: "revoke", source: "arena_native", network: "devnet", arena,
    season: "1", creditId: eventId(c.event), occurredAt: start, ...changes });
  const predating = settle([c, make()]);
  assert.equal(predating.receipts.length, 1);
  assert.equal(predating.rejectedEvents[0].reason, "invalid-revocation");
  const rejected = settle([c, make({ creditId: id(900), occurredAt: start + 2 })]);
  assert.equal(rejected.receipts.length, 1);
  assert.equal(rejected.rejectedEvents[0].reason, "invalid-revocation");
  assert.equal(settle([c, make({ season: "2" })]).rejectedEvents[0].reason, "wrong-arena-season");
});
test("creator signature and strict native source prevent untrusted event injection", () => {
  const c = credit(1), stranger = generateKeyPairSync("ed25519");
  assert.equal(settle([signed(c.event, stranger)]).rejectedEvents[0].reason, "invalid-signature");
  assert.equal(settle([{ ...c, event: { ...c.event, accountId: id(2) } }]).rejectedEvents[0].reason, "invalid-signature");
  assert.throws(() => eventPreimage({ ...c.event, source: "twitch" }), /native/);
  assert.throws(() => eventPreimage({ ...c.event, messageCount: 100 }), /fields/);
  assert.throws(() => eventPreimage({ ...c.event, action: "prediction_win" }), /action/);
});
test("events cannot cross arena, network or time boundaries", () => {
  assert.equal(settle([credit(1, 1, { arena: publicKey })]).rejectedEvents[0].reason, "wrong-arena-season");
  assert.equal(settle([credit(1, 1, { occurredAt: start - 1 })]).rejectedEvents[0].reason, "outside-season");
  assert.equal(settle([credit(1, 1, { occurredAt: config().endsAt })]).rejectedEvents[0].reason, "outside-season");
  assert.throws(() => settleSeason(config(), [], { now: start }), /still open/);
  assert.throws(() => settle([], config({ network: "mainnet" })), /devnet/);
});
test("malformed rows are individually rejected and committed, while valid rows settle deterministically", () => {
  const good = credit(1), bad = { event: { broken: true }, signature: "not-a-signature" };
  const first = settle([good, bad, credit(2)]), reversed = settle([credit(2), bad, good]);
  assert.deepEqual(first, reversed);
  assert.equal(first.receipts.length, 2);
  assert.equal(first.manifest.rejectedEventCount, 1);
  assert.equal(first.rejectedEvents[0].reason, "malformed-event");
  assert.equal(first.rejectedEvents[0].eventId, null);
  assert.equal(settle([good, bad, bad, credit(2)]).manifest.eventSetHash, first.manifest.eventSetHash);
  assert.notEqual(first.manifest.rejectedEventsHash, settle([good, credit(2)]).manifest.rejectedEventsHash);
  assert.throws(() => settlementBalances({ ...first, rejectedEvents: [] }), /manifest mismatch/);
});
test("season ledger dates must exactly match the configured on-chain arena schedule", () => {
  assert.throws(() => settle([], config({ startsAt: start + 1 })), /arena schedule/);
  assert.throws(() => settle([], config({ arenaSeasonSeconds: 60 })), /arena schedule/);
  assert.throws(() => settle([], config({ season: "0" })), /season schedule/);
  assert.throws(() => settle([], config({ arenaSeasonSeconds: 2419201 })), /range/);
});
test("config rejects hidden holding weights, invalid caps and unapproved reward assets", () => {
  assert.throws(() => settle([], { ...config(), supportMultiplier: 5 }), /fields/);
  assert.throws(() => settle([], config({ policy: { ...config().policy, weeklyCap: 0 } })), /positive/);
  assert.throws(() => settle([], config({ asset: "RLAN" })), /asset/);
  assert.throws(() => settle([], config({ endsAt: start })), /schedule/);
  assert.throws(() => settle([], config({ season: "01" })), /unsigned/);
});
test("proofs bind account, points, amount, policy, asset and season", () => {
  const s = settle([credit(1), credit(2), credit(3)]), r = s.receipts[1];
  for (const changed of [{ accountId: id(4) }, { amountBaseUnits: "99" }, { points: "2" }, { index: 0 }, { path: [] }]) {
    assert.equal(verifySeasonReceipt(s.manifest, { ...r, ...changed }), false);
  }
  for (const changed of [{ season: "2" }, { asset: "USDC" }, { policyHash: id(8) }, { root: id(3) }, { fanCount: 4 }]) {
    assert.equal(verifySeasonReceipt({ ...s.manifest, ...changed }, r), false);
  }
});
test("cached payout trees match RFC 9162 including non-power-of-two rosters", () => {
  for (const n of [1, 2, 3, 5, 7, 16, 31, 64]) {
    const s = settle(Array.from({ length: n }, (_, i) => credit(i + 1)));
    assert.equal(s.manifest.root, Buffer.from(treeRoot(s.receipts.map((r) => Buffer.from(r.commitment, "hex")))).toString("hex"));
    assert.ok(s.receipts.every((r) => verifySeasonReceipt(s.manifest, r)));
  }
});
test("tampered snapshots and duplicate or unknown reported claims cannot release reserves", () => {
  const s = settle([credit(1), credit(2)]);
  assert.throws(() => settlementBalances(s, [id(1), id(1)]), /duplicate/);
  assert.throws(() => settlementBalances(s, [id(3)]), /accounting/);
  assert.throws(() => settlementBalances({ ...s, manifest: { ...s.manifest, dustBaseUnits: "100" } }), /manifest/);
  assert.throws(() => settlementBalances({ ...s, receipts: [s.receipts[0], s.receipts[0]] }), /duplicate/);
});
test("conservation holds for arbitrary point distributions, claims and deadlines", () => {
  for (let n = 1; n < 24; n++) {
    const events = Array.from({ length: n }, (_, i) => credit(i + 1, i + 1, { action: i % 2 ? "accepted_work" : "question" }));
    const s = settle(events, config({ budgetBaseUnits: String(97 * n + 1) }));
    for (const now of [config().endsAt, config().claimDeadline]) {
      const b = settlementBalances(s, s.receipts.filter((_, i) => i % 2 === 0).map((r) => r.accountId), { now });
      assert.equal(BigInt(b.reportedPaidBaseUnits) + BigInt(b.reservedBaseUnits) + BigInt(b.carryBaseUnits), BigInt(s.manifest.budgetBaseUnits));
    }
  }
});
test("snapshots are immutable and input mutation cannot change a settled plan", () => {
  const c = config(), event = credit(1), s = settle([event], c);
  assert.throws(() => { s.receipts[0].amountBaseUnits = "500"; }, TypeError);
  c.policy.weeklyCap = 500;
  event.event.action = "accepted_work";
  assert.equal(s.manifest.policy.weeklyCap, 30);
  assert.equal(s.receipts[0].amountBaseUnits, "100");
});
test("imported empty manifests and complete rosters must conserve points as well as money", () => {
  const reanchor = (manifest, receipts) => ({ manifest, receipts, rejectedEvents: [],
    anchorCommitment: Buffer.from(keccak256(new TextEncoder().encode(MANIFEST_DOMAIN),
      new TextEncoder().encode(JSON.stringify(manifest)))).toString("hex") });
  const empty = settle([]);
  for (const changes of [{ planOnly: false }, { claimDeadline: "invalid" }, { fanCount: -1 },
    { totalPoints: "1" }, { root: id(999) }, { dustBaseUnits: "99" }]) {
    assert.throws(() => settlementBalances(reanchor({ ...empty.manifest, ...changes }, [])));
  }
  // A zero-budget proof still verifies if someone inflates the denominator; the complete roster
  // must reject it, since no payment formula alone can establish the sum of points.
  const s = settle([credit(1)], config({ budgetBaseUnits: "0" }));
  const fake = reanchor({ ...s.manifest, totalPoints: "2" }, s.receipts);
  assert.equal(verifySeasonReceipt(fake.manifest, fake.receipts[0]), true);
  assert.throws(() => settlementBalances(fake), /accounting/);
});
