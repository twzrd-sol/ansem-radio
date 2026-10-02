/**
 * The session fund's books: one campaign header and a list of receipts. Pure functions only.
 * Totals are BigInt so they stay exact; the public view is a whitelist, like the board's.
 */

import {
  CUSTODY,
  FUNDING_SOURCES,
  LedgerError,
  formatUsdc,
  isPlainObject,
  isSolanaAddress,
  normalizeReceipt,
  publicText,
  rejectUnknownFields,
} from "./receipt.js";

const LEDGER_FIELDS = Object.freeze(["version", "campaign", "receipts"]);
const CAMPAIGN_FIELDS = Object.freeze(["title", "purpose", "terms", "receive"]);
const RECEIVE_FIELDS = Object.freeze(["label", "address", "custody"]);
const SPENDING_KINDS = Object.freeze(["support", "fee", "refund"]);

function normalizeCampaign(raw) {
  if (!isPlainObject(raw)) throw new LedgerError("ledger_invalid", "campaign: must be an object");
  rejectUnknownFields(raw, CAMPAIGN_FIELDS, "campaign", "ledger_invalid");
  if (!isPlainObject(raw.receive)) throw new LedgerError("ledger_invalid", "campaign.receive: must be an object");
  rejectUnknownFields(raw.receive, RECEIVE_FIELDS, "campaign.receive", "ledger_invalid");
  if (!isSolanaAddress(raw.receive.address)) {
    throw new LedgerError("ledger_invalid", "campaign.receive.address: must be a base58 Solana address (32 bytes)");
  }
  if (!CUSTODY.includes(raw.receive.custody)) {
    throw new LedgerError("ledger_invalid", `campaign.receive.custody: must be one of ${CUSTODY.join(", ")}`);
  }
  return Object.freeze({
    title: publicText(raw.title, "campaign.title", 80, "ledger_invalid"),
    purpose: publicText(raw.purpose, "campaign.purpose", 240, "ledger_invalid"),
    terms: raw.terms === undefined ? null : publicText(raw.terms, "campaign.terms", 400, "ledger_invalid"),
    receive: Object.freeze({
      label: publicText(raw.receive.label, "campaign.receive.label", 60, "ledger_invalid"),
      address: raw.receive.address,
      custody: raw.receive.custody,
    }),
  });
}

/** Validate a parsed ledger file. Throws LedgerError naming the field, never a value. */
export function loadLedger(raw) {
  if (!isPlainObject(raw)) throw new LedgerError("ledger_invalid", "ledger: must be an object");
  rejectUnknownFields(raw, LEDGER_FIELDS, "ledger", "ledger_invalid");
  if (raw.version !== 1) throw new LedgerError("ledger_invalid", "ledger.version: must be 1");
  const campaign = normalizeCampaign(raw.campaign);
  if (!Array.isArray(raw.receipts)) throw new LedgerError("ledger_invalid", "ledger.receipts: must be a list");

  const seen = new Set();
  const receipts = raw.receipts.map((item, index) => {
    const path = `receipts[${index}]`;
    const receipt = normalizeReceipt(item, path);
    if (seen.has(receipt.id)) throw new LedgerError("ledger_invalid", `${path}: duplicate of an earlier receipt`);
    seen.add(receipt.id);
    const toFund = receipt.to_address === campaign.receive.address;
    if (receipt.kind === "funding" && (!toFund || receipt.to_custody !== campaign.receive.custody)) {
      throw new LedgerError("ledger_invalid", `${path}: funding must go to the campaign receive address and custody`);
    }
    if (receipt.kind !== "funding" && toFund) {
      throw new LedgerError("ledger_invalid", `${path}: spending cannot go to the fund's own address`);
    }
    return receipt;
  });
  receipts.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
  return Object.freeze({ version: 1, campaign, receipts: Object.freeze(receipts) });
}

const usdc = (units) => Object.freeze({ amount: units.toString(), usdc: formatUsdc(units) });

/** Exact totals from recorded receipts. `remaining` is the books' balance, not the wallet's. */
export function summarize(ledger) {
  const fundedBy = Object.fromEntries(FUNDING_SOURCES.map((source) => [source, 0n]));
  const spentBy = Object.fromEntries(SPENDING_KINDS.map((kind) => [kind, 0n]));
  let funded = 0n;
  let spent = 0n;
  for (const receipt of ledger.receipts) {
    const units = BigInt(receipt.amount);
    if (receipt.kind === "funding") {
      funded += units;
      fundedBy[receipt.funding_source] += units;
    } else {
      spent += units;
      spentBy[receipt.kind] += units;
    }
  }
  const remaining = funded - spent;
  return Object.freeze({
    funded: usdc(funded),
    spent: usdc(spent),
    remaining: usdc(remaining),
    funded_by: Object.freeze(Object.fromEntries(Object.entries(fundedBy).map(([key, units]) => [key, usdc(units)]))),
    spent_by: Object.freeze(Object.fromEntries(Object.entries(spentBy).map(([key, units]) => [key, usdc(units)]))),
    receipts: ledger.receipts.length,
    warnings: Object.freeze(remaining < 0n ? ["overdrawn: recorded spending exceeds recorded funding"] : []),
  });
}

const PENDING = Object.freeze({ status: "pending", reason: null, block_time: null });

/**
 * What the room and the recap show. `verifications` maps receipt id -> verifier result.
 * The public receipt drops nothing private because nothing private can enter one; the whitelist
 * is still explicit so a future field must be added here on purpose.
 */
export function toPublicLedger(ledger, verifications = new Map()) {
  const receipts = ledger.receipts.map((receipt) => {
    const checked = verifications.get(receipt.id) ?? PENDING;
    return Object.freeze({
      id: receipt.id,
      kind: receipt.kind,
      ...(receipt.kind === "funding" ? { funding_source: receipt.funding_source } : {}),
      amount: receipt.amount,
      amount_usdc: formatUsdc(receipt.amount),
      from_label: receipt.from_label,
      to_label: receipt.to_label,
      to_address: receipt.to_address,
      to_custody: receipt.to_custody,
      purpose: receipt.purpose,
      tx: receipt.tx,
      occurred_at: checked.block_time ?? receipt.occurred_at,
      verification: Object.freeze({
        status: checked.status,
        reason: checked.reason ?? null,
        ...(checked.chain_amount === undefined ? {} : { chain_amount: checked.chain_amount }),
      }),
    });
  });
  const count = (status) => receipts.filter((receipt) => receipt.verification.status === status).length;
  return Object.freeze({
    campaign: ledger.campaign,
    summary: Object.freeze({
      ...summarize(ledger),
      verified: count("verified"),
      mismatched: count("mismatch"),
    }),
    receipts: Object.freeze(receipts),
  });
}
