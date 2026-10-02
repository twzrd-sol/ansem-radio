/**
 * A receipt is one settled USDC transfer, described for the public; the ledger is a list of them.
 * Amounts are integer base units in a string so a float never touches money. Every field is on a
 * whitelist, so a receipt cannot carry chat text, a login, a participant id or a Twitch row by
 * accident. Free text is shown on stream, so it obeys the same vocabulary rules as the agents.
 * `to_address` (and the campaign's receive address) is a wallet address, what an explorer calls the
 * owner, not a USDC token account.
 */

import { createHash } from "node:crypto";

import { BANNED_WORDS } from "../agents/brain.js";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;
export const KINDS = Object.freeze(["funding", "support", "fee", "refund"]);
export const FUNDING_SOURCES = Object.freeze(["sponsor", "supporter", "operator_bootstrap"]);
export const CUSTODY = Object.freeze(["self_custody", "operator_wallet", "custodial_service"]);
export const RECEIPT_FIELDS = Object.freeze([
  "id", "kind", "funding_source", "amount", "from_label", "to_label", "to_address", "to_custody", "purpose", "tx", "occurred_at",
]);

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE_UNITS = /^[1-9][0-9]{0,17}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
// Control, invisible (zero-width, bidi override) and line-separator characters can spoof a label.
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const LINKISH = /(?:https?:\/\/|www\.)|\b[a-z0-9-]+\.(?:com|xyz|io|tv|sh|fun|market|markets|app)\b/i;
const BANNED = new RegExp(`\\b(${BANNED_WORDS.join("|")})\\b`, "i");

/** `detail` names a field and a rule. It never carries a value from the file. */
export class LedgerError extends Error {
  constructor(code, detail = null) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "LedgerError";
    this.code = code;
    this.detail = detail;
  }
}

/** Decoded size of a base58 string in bytes, or -1 if it is not base58. */
function base58ByteLength(text) {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return -1;
    value = value * 58n + BigInt(digit);
  }
  const zeros = text.length - text.replace(/^1+/, "").length;
  return zeros + (value === 0n ? 0 : Math.ceil(value.toString(16).length / 2));
}

/** A Solana public key is 32 bytes and a transaction signature is 64: a typo or truncation fails here, not at the RPC. */
export const isSolanaAddress = (value) => typeof value === "string" && base58ByteLength(value) === 32;
export const isSolanaSignature = (value) => typeof value === "string" && base58ByteLength(value) === 64;

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function rejectUnknownFields(value, allowed, path, code = "receipt_invalid") {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new LedgerError(code, `${path}.${key}: unknown field`);
  }
}

/** Text shown on stream: no control characters, no links, none of the words the room never says. */
export function publicText(value, path, max, code = "receipt_invalid") {
  if (typeof value !== "string") throw new LedgerError(code, `${path}: must be text`);
  const text = value.normalize("NFC").trim().replace(/ {2,}/g, " ");
  if (!text || text.length > max) throw new LedgerError(code, `${path}: must be 1 to ${max} characters`);
  if (UNSAFE_CHARS.test(text)) throw new LedgerError(code, `${path}: contains control or invisible characters`);
  if (LINKISH.test(text)) throw new LedgerError(code, `${path}: contains a link`);
  const banned = text.match(BANNED);
  if (banned) throw new LedgerError(code, `${path}: uses a word the room never shows ("${banned[1].toLowerCase()}")`);
  return text;
}

export function parseBaseUnits(value, path = "amount") {
  if (typeof value !== "string" || !BASE_UNITS.test(value)) {
    throw new LedgerError("receipt_invalid", `${path}: must be a positive integer string of USDC base units (6 decimals)`);
  }
  return BigInt(value);
}

/** Exact display of base units: 25000000 -> "25.00", 1 -> "0.000001". No float involved. */
export function formatUsdc(units) {
  const value = BigInt(units);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(USDC_DECIMALS);
  let fraction = String(abs % scale).padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `${negative ? "-" : ""}${(abs / scale).toLocaleString("en-US")}.${fraction}`;
}

export function receiptId({ kind, tx, to_address: toAddress, amount }) {
  const digest = createHash("sha256")
    .update(`radiolan-receipt|v1|${kind}|${tx}|${toAddress}|${amount}`)
    .digest("hex");
  return `r_${digest.slice(0, 16)}`;
}

function oneOf(value, allowed, path) {
  if (!allowed.includes(value)) throw new LedgerError("receipt_invalid", `${path}: must be one of ${allowed.join(", ")}`);
  return value;
}

function checked(value, valid, path, what) {
  if (!valid(value)) throw new LedgerError("receipt_invalid", `${path}: must be ${what}`);
  return value;
}

/** Validate one receipt and return it frozen, in a fixed field order, with its derived id. */
export function normalizeReceipt(raw, path = "receipt") {
  if (!isPlainObject(raw)) throw new LedgerError("receipt_invalid", `${path}: must be an object`);
  rejectUnknownFields(raw, RECEIPT_FIELDS, path);

  const kind = oneOf(raw.kind, KINDS, `${path}.kind`);
  if (kind === "funding") {
    oneOf(raw.funding_source, FUNDING_SOURCES, `${path}.funding_source`);
  } else if (raw.funding_source !== undefined) {
    throw new LedgerError("receipt_invalid", `${path}.funding_source: only funding receipts have a source`);
  }
  const amount = parseBaseUnits(raw.amount, `${path}.amount`).toString();
  const occurredAt = typeof raw.occurred_at === "string" && ISO_TIMESTAMP.test(raw.occurred_at)
    ? new Date(raw.occurred_at)
    : null;
  if (!occurredAt || Number.isNaN(occurredAt.valueOf())) {
    throw new LedgerError("receipt_invalid", `${path}.occurred_at: must be an ISO timestamp`);
  }

  const fields = {
    kind,
    ...(kind === "funding" ? { funding_source: raw.funding_source } : {}),
    amount,
    from_label: publicText(raw.from_label, `${path}.from_label`, 60),
    to_label: publicText(raw.to_label, `${path}.to_label`, 60),
    to_address: checked(raw.to_address, isSolanaAddress, `${path}.to_address`, "a base58 Solana address (32 bytes)"),
    to_custody: oneOf(raw.to_custody, CUSTODY, `${path}.to_custody`),
    purpose: publicText(raw.purpose, `${path}.purpose`, 140),
    tx: checked(raw.tx, isSolanaSignature, `${path}.tx`, "a base58 Solana transaction signature (64 bytes)"),
    occurred_at: occurredAt.toISOString(),
  };
  const id = receiptId(fields);
  if (raw.id !== undefined && raw.id !== id) {
    throw new LedgerError("receipt_invalid", `${path}.id: does not match the receipt (ids are derived, omit it)`);
  }
  return Object.freeze({ id, ...fields });
}
