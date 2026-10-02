import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createLedgerFeed } from "../src/live/ledger-feed.js";

const exampleText = readFileSync(new URL("../docs/examples/ledger.example.json", import.meta.url), "utf8");
const example = () => JSON.parse(exampleText);
const NOW = Date.parse("2026-10-03T13:00:00Z");
const statuses = (snapshot) => snapshot.ledger.receipts.map((receipt) => receipt.verification.status);

/**
 * `refresh()` reads the file, publishes at once, then waits for the Solana checks: every count-sensitive
 * test drives the feed through it. `start()` is used only where start-up behavior is the point.
 */
function rig({ text = exampleText, hang = false, outcome = () => ({ status: "verified", reason: null, block_time: null }), ...options } = {}) {
  const state = { text, clock: NOW, calls: [], inflight: 0, peak: 0, scheduled: [], cancelled: [], emitted: [] };
  const verifier = {
    verify: async (receipt) => {
      state.calls.push(receipt.tx);
      state.inflight += 1;
      state.peak = Math.max(state.peak, state.inflight);
      if (hang) await new Promise(() => {});
      await new Promise((resolve) => setImmediate(resolve));
      state.inflight -= 1;
      return outcome(receipt);
    },
  };
  const feed = createLedgerFeed({
    path: "/never/read/directly.json",
    readText: async () => {
      if (state.text instanceof Error) throw state.text;
      return state.text;
    },
    verifier,
    intervalMs: 5000,
    retryAfterMs: 60_000,
    schedule: (fn, ms) => { state.scheduled.push([fn, ms]); return state.scheduled.length; },
    cancel: (timer) => { state.cancelled.push(timer); },
    now: () => state.clock,
    ...options,
  });
  feed.subscribe((type, data) => state.emitted.push([type, data]));
  return { feed, state };
}

test("start publishes the receipts at once as not checked, and a hung verifier never delays it", async () => {
  const { feed, state } = rig({ hang: true });
  const first = await feed.start();
  assert.equal(first.enabled, true);
  assert.equal(first.last_error, null);
  assert.equal(first.updated_at, "2026-10-03T13:00:00.000Z");
  assert.equal(first.ledger.summary.funded.usdc, "75.00");
  assert.deepEqual(statuses(first), ["pending", "pending", "pending"]);
  assert.equal(state.emitted.length, 1);
  assert.equal(state.emitted[0][0], "receipt");
  assert.deepEqual(state.scheduled.map(([, ms]) => ms), [5000]);
  assert.equal(state.calls.length, 2, "checks began in the background, two at a time");
  feed.stop();
});

test("receipts flip to their verdicts as the checks land, and nothing internal or private is published", async () => {
  const { feed, state } = rig();
  const settled = await feed.refresh();
  assert.deepEqual(statuses(settled), ["verified", "verified", "verified"]);
  assert.equal(settled.ledger.summary.verified, 3);
  assert.equal(state.calls.length, 3);
  assert.deepEqual(state.emitted.map(([type]) => type), ["receipt", "receipt"], "not checked, then checked");
  assert.deepEqual(statuses(state.emitted[0][1]), ["pending", "pending", "pending"]);
  assert.deepEqual(statuses(state.emitted[1][1]), ["verified", "verified", "verified"]);
  const wire = JSON.stringify(state.emitted);
  assert.equal(wire.includes("checked_at"), false, "internal bookkeeping stays internal");
  assert.equal(wire.includes("/never/read"), false, "the file path is never published");
});

test("an unchanged file emits nothing and re-checks nothing; a new receipt is the only one checked", async () => {
  const { feed, state } = rig();
  await feed.refresh();
  await feed.refresh();
  assert.equal(state.calls.length, 3);
  assert.equal(state.emitted.length, 2, "no change, no event");

  const doc = example();
  doc.receipts.push({ ...doc.receipts[2], amount: "1000000", purpose: "Second commission", tx: doc.receipts[0].tx, to_label: "Another Artist" });
  state.text = JSON.stringify(doc);
  const next = await feed.refresh();
  assert.equal(state.calls.length, 4);
  assert.equal(next.ledger.receipts.length, 4);
  assert.equal(state.emitted.length, 4, "the new receipt appears at once, then its verdict");
  const early = statuses(state.emitted[2][1]);
  assert.equal(early.filter((status) => status === "pending").length, 1, "only the new receipt is not checked yet");
  assert.equal(early.filter((status) => status === "verified").length, 3, "the others keep their verdicts");
  assert.deepEqual(statuses(state.emitted[3][1]), ["verified", "verified", "verified", "verified"]);
});

test("a broken save keeps the last good ledger on air and tells the operator which field", async () => {
  const { feed, state } = rig();
  await feed.refresh();
  assert.equal(state.emitted.length, 2);

  const doc = example();
  doc.receipts[1].viewer_count = 7;
  state.text = JSON.stringify(doc);
  const broken = await feed.refresh();
  assert.equal(broken.last_error, "ledger_invalid");
  assert.equal(broken.last_detail, "receipts[1].viewer_count: unknown field");
  assert.equal(broken.ledger.receipts.length, 3, "last good ledger is kept");
  assert.deepEqual(statuses(broken), ["verified", "verified", "verified"], "and its verdicts with it");
  assert.equal(state.emitted.length, 3);

  state.text = "{ not json";
  const garbled = await feed.refresh();
  assert.equal(garbled.last_error, "ledger_invalid");
  assert.equal(garbled.last_detail, "ledger: not valid JSON");
  assert.equal(garbled.ledger.receipts.length, 3);
  assert.equal(state.emitted.length, 4);

  state.text = exampleText;
  const fixed = await feed.refresh();
  assert.equal(fixed.last_error, null);
  assert.equal(fixed.last_detail, null);
  assert.equal(state.emitted.length, 5, "the recovery is announced too");
  assert.equal(state.calls.length, 3, "a broken save never re-checks anything");
});

test("a missing file is reported honestly and never invents receipts", async () => {
  const { feed } = rig({ text: Object.assign(new Error("ENOENT: no such file, open '/home/twzrd/secret/ledger.json'"), { code: "ENOENT" }) });
  const snapshot = await feed.start();
  assert.equal(snapshot.ledger, null);
  assert.equal(snapshot.last_error, "ledger_unreadable");
  assert.equal(snapshot.last_detail, null);
  assert.equal(JSON.stringify(snapshot).includes("secret"), false, "the OS error and its path stay out of the snapshot");
  feed.stop();
});

test("final verdicts are cached; unavailable and not_found are retried after the delay, not before", async () => {
  const seen = new Map();
  const { feed, state } = rig({
    outcome: (receipt) => {
      const n = (seen.get(receipt.tx) ?? 0) + 1;
      seen.set(receipt.tx, n);
      if (receipt.kind === "support") return n === 1 ? { status: "unavailable", reason: "rpc_timeout", block_time: null } : { status: "verified", reason: null, block_time: "2026-10-03T12:00:09.000Z" };
      if (receipt.funding_source === "sponsor") return n === 1 ? { status: "not_found", reason: "unknown_or_not_finalized", block_time: null } : { status: "mismatch", reason: "amount_differs", block_time: null, chain_amount: "24000000" };
      return { status: "verified", reason: null, block_time: null };
    },
  });
  const first = await feed.refresh();
  assert.deepEqual(statuses(first), ["verified", "not_found", "unavailable"]);
  assert.equal(state.calls.length, 3);
  const emitted = state.emitted.length;

  state.clock += 30_000;
  await feed.refresh();
  assert.equal(state.calls.length, 3, "too soon to retry");
  assert.equal(state.emitted.length, emitted, "and nothing changed, so nothing is announced");

  state.clock += 31_000;
  const later = await feed.refresh();
  assert.equal(state.calls.length, 5, "only the two unsettled receipts are asked again");
  assert.deepEqual(statuses(later), ["verified", "mismatch", "verified"]);
  assert.equal(later.ledger.receipts[2].occurred_at, "2026-10-03T12:00:09.000Z");
  assert.equal(later.ledger.receipts[1].verification.chain_amount, "24000000");
  assert.equal(state.emitted.length, emitted + 1);

  state.clock += 600_000;
  await feed.refresh();
  assert.equal(state.calls.length, 5, "verified and mismatch are final for that receipt");
});

test("with no RPC configured the verdict is unverified and is asked once, not every refresh", async () => {
  const { feed, state } = rig({ outcome: () => ({ status: "unverified", reason: "rpc_not_configured", block_time: null }) });
  await feed.refresh();
  state.clock += 600_000;
  const later = await feed.refresh();
  assert.equal(state.calls.length, 3);
  assert.equal(later.ledger.summary.verified, 0);
  assert.equal(later.ledger.receipts[0].verification.status, "unverified");
});

test("checks run with bounded concurrency", async () => {
  const doc = example();
  for (let i = 0; i < 5; i += 1) doc.receipts.push({ ...doc.receipts[2], amount: String(1_000_000 * (i + 1)), purpose: `Extra ${i}` });
  const { feed, state } = rig({ text: JSON.stringify(doc), concurrency: 2 });
  await feed.refresh();
  assert.equal(state.calls.length, 8);
  assert.equal(state.peak, 2);
});

test("a tick that lands mid-pass shares it instead of starting a second one", async () => {
  const { feed, state } = rig();
  const [a, b] = await Promise.all([feed.refresh(), feed.refresh()]);
  assert.deepEqual(statuses(a), ["verified", "verified", "verified"]);
  assert.deepEqual(statuses(b), ["verified", "verified", "verified"]);
  assert.equal(state.calls.length, 3, "each receipt was asked once");
});

test("a throwing verifier or listener never breaks the feed", async () => {
  const { feed, state } = rig({ outcome: () => { throw new Error("boom /home/twzrd/secret"); } });
  feed.subscribe(() => { throw new Error("consumer bug"); });
  const snapshot = await feed.refresh();
  assert.deepEqual(statuses(snapshot), ["unavailable", "unavailable", "unavailable"]);
  assert.equal(snapshot.ledger.receipts[0].verification.reason, "verifier_failed");
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  assert.ok(state.emitted.length >= 2, "other listeners still hear every change");
});

test("the loop reschedules, stops cleanly, and one bad tick never ends it", async () => {
  const { feed, state } = rig();
  await feed.start();
  await feed.start();
  assert.equal(state.scheduled.length, 1, "start is idempotent");

  state.text = new Error("EIO");
  await state.scheduled[0][0]();
  assert.equal(state.scheduled.length, 2, "the loop survives an unreadable tick");
  assert.equal(feed.snapshot().last_error, "ledger_unreadable");

  feed.stop();
  assert.deepEqual(state.cancelled, [2]);
  const asked = state.calls.length;
  await state.scheduled[1][0]();
  assert.equal(state.calls.length, asked, "no work after stop");
  assert.equal(state.scheduled.length, 2);
  assert.equal(feed.snapshot().enabled, false);
});

test("construction and subscription are validated", () => {
  assert.throws(() => createLedgerFeed({}), /path is required/);
  assert.throws(() => createLedgerFeed({ path: "x", verifier: {} }), /verifier\.verify/);
  const { feed } = rig();
  assert.throws(() => feed.subscribe(1), /listener must be a function/);
  const seen = [];
  const off = feed.subscribe((type) => seen.push(type));
  off();
  assert.deepEqual(seen, []);
});
