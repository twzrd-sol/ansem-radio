import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BANNED_WORDS } from "../src/agents/brain.js";
import { loadLedger, summarize, toPublicLedger } from "../src/ledger/ledger.js";
import { LedgerError, formatUsdc, isSolanaAddress, isSolanaSignature, normalizeReceipt, parseBaseUnits, receiptId } from "../src/ledger/receipt.js";
import { formatRecap } from "../src/ledger/recap.js";

const example = () => JSON.parse(readFileSync(new URL("../docs/examples/ledger.example.json", import.meta.url), "utf8"));
const funding = () => example().receipts[0];
const support = () => example().receipts[2];
const rejects = (fn, pattern) => assert.throws(fn, (error) => error instanceof LedgerError && pattern.test(error.message), String(pattern));
const bannedWords = new RegExp(`\\b(${BANNED_WORDS.join("|")})\\b`, "i");

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encode58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (; value > 0n; value /= 58n) out = ALPHABET[Number(value % 58n)] + out;
  return "1".repeat(bytes.findIndex((byte) => byte !== 0) === -1 ? bytes.length : bytes.findIndex((byte) => byte !== 0)) + out;
}
const bytes = (count) => Uint8Array.from({ length: count }, (_, i) => ((i * 37 + 11) % 250) + 1);

test("base units are exact integers and format without floats", () => {
  assert.equal(formatUsdc("25000000"), "25.00");
  assert.equal(formatUsdc("500000"), "0.50");
  assert.equal(formatUsdc("1"), "0.000001");
  assert.equal(formatUsdc("0"), "0.00");
  assert.equal(formatUsdc("123456789012"), "123,456.789012");
  assert.equal(formatUsdc("9007199254740993"), "9,007,199,254.740993", "past 2^53 a float would round this");
  assert.equal(formatUsdc(-1_500_000n), "-1.50");

  assert.equal(parseBaseUnits("999999999999999999"), 999999999999999999n);
  for (const bad of [25, "1.5", "-5", "0", "01", "", "1e6", " 5", "1234567890123456789", null, undefined]) {
    rejects(() => parseBaseUnits(bad), /positive integer string of USDC base units/);
  }
});

test("a receipt is normalized in a fixed field order with a derived, deterministic id", () => {
  const receipt = normalizeReceipt(support());
  assert.deepEqual(Object.keys(receipt), ["id", "kind", "amount", "from_label", "to_label", "to_address", "to_custody", "purpose", "tx", "occurred_at"]);
  assert.deepEqual(Object.keys(normalizeReceipt(funding())).slice(0, 3), ["id", "kind", "funding_source"]);
  assert.match(receipt.id, /^r_[0-9a-f]{16}$/);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(receipt.occurred_at, "2026-10-03T12:00:00.000Z");

  assert.equal(normalizeReceipt(support()).id, receipt.id);
  const shuffled = Object.fromEntries(Object.entries(support()).reverse());
  assert.equal(normalizeReceipt(shuffled).id, receipt.id, "key order does not matter");
  assert.notEqual(normalizeReceipt({ ...support(), amount: "40000001" }).id, receipt.id);
  assert.equal(receipt.id, receiptId(receipt));

  assert.equal(normalizeReceipt({ ...support(), id: receipt.id }).id, receipt.id);
  rejects(() => normalizeReceipt({ ...support(), id: "r_0000000000000000" }), /does not match the receipt/);
});

test("only whitelisted fields are accepted, so private or Twitch data cannot ride along", () => {
  for (const field of ["viewer_count", "game_id", "login", "message", "chat_text", "participant_id", "display_name", "raw"]) {
    assert.throws(
      () => normalizeReceipt({ ...support(), [field]: "SECRET-VALUE" }, "receipts[2]"),
      (error) => error instanceof LedgerError && error.message.includes(`receipts[2].${field}: unknown field`) && !error.message.includes("SECRET-VALUE"),
      field,
    );
  }
});

test("free text obeys the on-stream vocabulary: no links, no invisible characters, none of the banned words", () => {
  const bad = (field, value) => normalizeReceipt({ ...support(), [field]: value }, "r");
  rejects(() => bad("purpose", "see https://example.com now"), /r\.purpose: contains a link/);
  rejects(() => bad("purpose", "art at foo.com"), /contains a link/);
  rejects(() => bad("to_label", "www.example.org"), /contains a link/);
  rejects(() => bad("purpose", "payout for art"), /"payout"/);
  rejects(() => bad("from_label", "Price Labs"), /"price"/);
  // Token words follow the agents' list, lifted by the operator on 2026-10-01.
  assert.equal(bad("from_label", "Token Labs").from_label, "Token Labs");
  rejects(() => bad("purpose", "buy a beat"), /"buy"/);
  rejects(() => bad("purpose", "line\nbreak"), /control or invisible/);
  rejects(() => bad("purpose", `a${String.fromCodePoint(0x200b)}b`), /control or invisible/);
  rejects(() => bad("to_label", `${String.fromCodePoint(0x202e)}Artist`), /control or invisible/);
  rejects(() => bad("purpose", "x".repeat(141)), /1 to 140 characters/);
  rejects(() => bad("purpose", "   "), /1 to 140 characters/);
  rejects(() => bad("purpose", 42), /must be text/);
  assert.equal(bad("purpose", "  Overlay   art ").purpose, "Overlay art");
  assert.equal(bad("to_label", "Ünï Artist 🎨").to_label, "Ünï Artist 🎨");
  assert.equal(bad("purpose", "Bettor-free art").purpose, "Bettor-free art", "whole words only");
});

test("kind, source, custody, address and signature rules", () => {
  const bad = (patch, base = support()) => normalizeReceipt({ ...base, ...patch }, "r");
  rejects(() => bad({ kind: "tip" }), /r\.kind: must be one of funding, support, fee, refund/);
  rejects(() => bad({ funding_source: "sponsor" }), /only funding receipts have a source/);
  rejects(() => bad({ funding_source: undefined }, { ...funding(), funding_source: undefined }), /funding_source: must be one of sponsor, supporter, operator_bootstrap/);
  rejects(() => bad({ funding_source: "viewer" }, funding()), /funding_source: must be one of/);
  rejects(() => bad({ to_custody: "exchange" }), /to_custody: must be one of self_custody, operator_wallet, custodial_service/);
  rejects(() => bad({ to_address: "not-an-address" }), /to_address: must be a base58 Solana address/);
  rejects(() => bad({ to_address: `0${support().to_address.slice(1)}` }), /to_address/);
  rejects(() => bad({ tx: "short" }), /tx: must be a base58 Solana transaction signature/);
  rejects(() => bad({ occurred_at: "yesterday" }), /occurred_at: must be an ISO timestamp/);
  rejects(() => bad({ occurred_at: "2026-13-45T99:00:00Z" }), /occurred_at/);
  rejects(() => normalizeReceipt(null, "r"), /r: must be an object/);
  rejects(() => normalizeReceipt([], "r"), /r: must be an object/);
  for (const source of ["sponsor", "supporter", "operator_bootstrap"]) {
    assert.equal(bad({ funding_source: source }, funding()).funding_source, source);
  }
  for (const kind of ["support", "fee", "refund"]) assert.equal(bad({ kind }).kind, kind);
});

test("addresses are 32 bytes and signatures 64: a typo or truncation is refused before it reaches the RPC", () => {
  assert.equal(isSolanaAddress(encode58(bytes(32))), true);
  assert.equal(isSolanaAddress(encode58(bytes(31))), false);
  assert.equal(isSolanaAddress(encode58(bytes(33))), false);
  assert.equal(isSolanaAddress("1".repeat(32)), true, "the all-zero System Program address: leading ones are zero bytes");
  assert.equal(isSolanaAddress(encode58(Uint8Array.from([0, 0, 0, ...bytes(29)]))), true, "leading zero bytes count");
  assert.equal(isSolanaSignature(encode58(bytes(64))), true);
  assert.equal(isSolanaSignature(encode58(bytes(63))), false);
  assert.equal(isSolanaSignature(encode58(bytes(65))), false);
  assert.equal(isSolanaSignature("1".repeat(87)), false, "87 zero bytes is the wrong size");
  assert.equal(isSolanaAddress(`0${encode58(bytes(32)).slice(1)}`), false, "0, O, I and l are not base58");
  assert.equal(isSolanaAddress(null), false);
  assert.equal(isSolanaSignature(42), false);
  assert.equal(isSolanaSignature(support().tx) && isSolanaAddress(support().to_address), true, "the example's values are well formed");

  rejects(() => normalizeReceipt({ ...support(), tx: encode58(bytes(63)) }, "r"), /r\.tx: must be a base58 Solana transaction signature \(64 bytes\)/);
  rejects(() => normalizeReceipt({ ...support(), to_address: encode58(bytes(33)) }, "r"), /r\.to_address: must be a base58 Solana address \(32 bytes\)/);
  const doc = example();
  doc.campaign.receive.address = encode58(bytes(31));
  rejects(() => loadLedger(doc), /campaign\.receive\.address: must be a base58 Solana address \(32 bytes\)/);
});

test("a ledger is validated as a whole: funding lands on the fund, spending never does, no duplicates", () => {
  const ledger = loadLedger(example());
  assert.equal(ledger.campaign.title, "EXAMPLE Radio LAN session fund");
  assert.equal(ledger.receipts.length, 3);
  assert.equal(Object.isFrozen(ledger), true);
  assert.equal(Object.isFrozen(ledger.receipts), true);

  const doc = example();
  doc.receipts.reverse();
  assert.deepEqual(loadLedger(doc).receipts.map((receipt) => receipt.occurred_at.slice(0, 10)), ["2026-10-01", "2026-10-02", "2026-10-03"], "sorted by time");

  const misdirected = example();
  misdirected.receipts[0].to_address = support().to_address;
  rejects(() => loadLedger(misdirected), /receipts\[0\]: funding must go to the campaign receive address and custody/);

  const wrongCustody = example();
  wrongCustody.receipts[0].to_custody = "self_custody";
  rejects(() => loadLedger(wrongCustody), /funding must go to the campaign receive address and custody/);

  const toFund = example();
  toFund.receipts[2].to_address = toFund.campaign.receive.address;
  rejects(() => loadLedger(toFund), /receipts\[2\]: spending cannot go to the fund's own address/);

  const twice = example();
  twice.receipts.push(structuredClone(twice.receipts[0]));
  rejects(() => loadLedger(twice), /receipts\[3\]: duplicate of an earlier receipt/);

  const bad = (mutate, pattern) => {
    const value = example();
    mutate(value);
    rejects(() => loadLedger(value), pattern);
  };
  bad((v) => { v.version = 2; }, /ledger\.version: must be 1/);
  bad((v) => { v.owner = "x"; }, /ledger\.owner: unknown field/);
  bad((v) => { v.campaign.wallet_key = "x"; }, /campaign\.wallet_key: unknown field/);
  bad((v) => { v.campaign.receive.seed = "x"; }, /campaign\.receive\.seed: unknown field/);
  bad((v) => { delete v.campaign.receive; }, /campaign\.receive: must be an object/);
  bad((v) => { v.campaign.receive.address = "nope"; }, /campaign\.receive\.address: must be a base58 Solana address/);
  bad((v) => { v.campaign.receive.custody = "vault"; }, /campaign\.receive\.custody: must be one of/);
  bad((v) => { v.campaign.title = "Odds fund"; }, /campaign\.title: uses a word the room never shows/);
  bad((v) => { v.campaign.terms = "read https://example.com"; }, /campaign\.terms: contains a link/);
  bad((v) => { v.receipts = {}; }, /ledger\.receipts: must be a list/);
  bad((v) => { v.receipts[1].viewer_count = 9; }, /receipts\[1\]\.viewer_count: unknown field/);
  rejects(() => loadLedger(null), /ledger: must be an object/);

  const noTerms = example();
  delete noTerms.campaign.terms;
  assert.equal(loadLedger(noTerms).campaign.terms, null);
});

test("totals are exact and overspending is flagged, not hidden", () => {
  const summary = summarize(loadLedger(example()));
  assert.deepEqual(
    [summary.funded.usdc, summary.spent.usdc, summary.remaining.usdc, summary.receipts],
    ["75.00", "40.00", "35.00", 3],
  );
  assert.equal(summary.funded_by.sponsor.usdc, "25.00");
  assert.equal(summary.funded_by.operator_bootstrap.usdc, "50.00");
  assert.equal(summary.funded_by.supporter.usdc, "0.00");
  assert.equal(summary.spent_by.support.usdc, "40.00");
  assert.equal(summary.spent_by.fee.usdc, "0.00");
  assert.deepEqual(summary.warnings, []);

  const overspent = example();
  overspent.receipts[2].amount = "90000000";
  const over = summarize(loadLedger(overspent));
  assert.equal(over.remaining.usdc, "-15.00");
  assert.match(over.warnings[0], /overdrawn/);

  const huge = example();
  huge.receipts[0].amount = "9007199254740993";
  huge.receipts[1].amount = "1";
  huge.receipts[2].amount = "1";
  const exact = summarize(loadLedger(huge));
  assert.equal(exact.funded.amount, "9007199254740994");
  assert.equal(exact.remaining.amount, "9007199254740993");
});

test("the public ledger has an explicit field list and carries each receipt's verification", () => {
  const ledger = loadLedger(example());
  const view = toPublicLedger(ledger);
  assert.deepEqual(Object.keys(view), ["campaign", "summary", "receipts"]);
  assert.deepEqual(Object.keys(view.receipts[0]), ["id", "kind", "funding_source", "amount", "amount_usdc", "from_label", "to_label", "to_address", "to_custody", "purpose", "tx", "occurred_at", "verification"]);
  assert.deepEqual(Object.keys(view.receipts[2]), ["id", "kind", "amount", "amount_usdc", "from_label", "to_label", "to_address", "to_custody", "purpose", "tx", "occurred_at", "verification"]);
  assert.deepEqual(view.receipts[0].verification, { status: "pending", reason: null });
  assert.equal(view.summary.verified, 0);

  const [first, second, third] = ledger.receipts;
  const checked = toPublicLedger(ledger, new Map([
    [first.id, { status: "verified", reason: null, block_time: "2026-10-01T18:00:07.000Z" }],
    [second.id, { status: "mismatch", reason: "amount_differs", block_time: null, chain_amount: "24000000" }],
    [third.id, { status: "unavailable", reason: "rpc_timeout", block_time: null }],
  ]));
  assert.equal(checked.receipts[0].occurred_at, "2026-10-01T18:00:07.000Z", "chain time replaces the declared time");
  assert.equal(checked.receipts[1].occurred_at, "2026-10-02T15:30:00.000Z");
  assert.deepEqual(checked.receipts[1].verification, { status: "mismatch", reason: "amount_differs", chain_amount: "24000000" });
  assert.equal(checked.summary.verified, 1);
  assert.equal(checked.summary.mismatched, 1);
  assert.equal(JSON.stringify(checked).includes("checked_at"), false);
});

test("the recap lists every receipt with its recipient and full signature, and says what was proven", () => {
  const ledger = loadLedger(example());
  const [first, second] = ledger.receipts;
  const recap = formatRecap(toPublicLedger(ledger, new Map([
    [first.id, { status: "verified", reason: null, block_time: null }],
    [second.id, { status: "mismatch", reason: "amount_differs", block_time: null }],
  ])));
  assert.match(recap, /^EXAMPLE Radio LAN session fund — receipts\n/);
  assert.match(recap, /Funded 75\.00 USDC · Spent 40\.00 USDC · Remaining 35\.00 USDC \(books\)/);
  assert.match(recap, /Funding: sponsor 25\.00 · operator bootstrap 50\.00/);
  assert.match(recap, /Checked against Solana: 1 of 3 receipts, 1 do not match/);
  assert.match(recap, /\+50\.00 USDC {2}funding from operator bootstrap · Radio LAN operator -> Radio LAN fund wallet · Bootstrap for session 2 creator work · 2026-10-01 · verified on Solana/);
  assert.match(recap, /\+25\.00 USDC .* DOES NOT MATCH Solana/);
  assert.match(recap, /-40\.00 USDC {2}support · Radio LAN fund wallet -> Example Artist \(self custody\) · Overlay art for session 2 · 2026-10-03 · not checked/);
  for (const receipt of ledger.receipts) {
    assert.ok(recap.includes(`   tx ${receipt.tx}`), "full signature");
    assert.ok(recap.includes(`   to ${receipt.to_address}`), "recipient address");
  }
  assert.match(recap, /Amounts and recipients are checked against finalized Solana data\. Labels and purposes are declared by the operator\./);
  assert.match(recap, /Terms: Contributions are voluntary/);
  assert.doesNotMatch(recap, bannedWords, "the recap never uses the words the room never says");
});

test("the recap warns when the books are overdrawn", () => {
  const overspent = example();
  overspent.receipts[2].amount = "90000000";
  const recap = formatRecap(toPublicLedger(loadLedger(overspent)));
  assert.match(recap, /Warning: overdrawn/);
  assert.match(recap, /Remaining -15\.00 USDC/);
});
