import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const EMPTY = () => ({ version: 1, quotes: {}, orders: {} });
const ID = /^[A-Za-z0-9_-]{20,80}$/;

function validateState(value) {
  if (!value || value.version !== 1 || !value.quotes || typeof value.quotes !== "object" || Array.isArray(value.quotes)
    || !value.orders || typeof value.orders !== "object" || Array.isArray(value.orders)) {
    throw new TypeError("x402 store is invalid");
  }
  for (const [id, quote] of Object.entries(value.quotes)) {
    if (!ID.test(id) || quote?.id !== id || !["pending_review", "approved", "rejected", "settling", "paid"].includes(quote.status)) {
      throw new TypeError("x402 quote store is invalid");
    }
  }
  for (const [id, order] of Object.entries(value.orders)) {
    if (!ID.test(id) || order?.id !== id || !["settling", "paid_pending_fulfillment", "fulfilled", "refund_recorded", "settlement_unknown"].includes(order.status)) {
      throw new TypeError("x402 order store is invalid");
    }
  }
  return value;
}

/** Single-process durable order log. The station owns this file; the API is the only writer. */
export function createSponsorStore({ path } = {}) {
  if (typeof path !== "string" || !path.startsWith("/")) throw new TypeError("RADIOLAN_X402_STORE_PATH must be an absolute path");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let state = EMPTY();
  if (existsSync(path)) state = validateState(JSON.parse(readFileSync(path, "utf8")));

  const flush = () => {
    const temp = `${path}.tmp.${process.pid}`;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, path);
  };
  const insert = (table, row) => {
    if (Object.keys(state[table]).length >= 10_000) throw new Error("x402 store capacity reached");
    if (state[table][row.id]) throw new Error("x402 record already exists");
    state[table][row.id] = structuredClone(row);
    flush();
    return structuredClone(row);
  };
  const replace = (table, id, patch) => {
    const row = state[table][id];
    if (!row) return null;
    state[table][id] = { ...row, ...structuredClone(patch) };
    flush();
    return structuredClone(state[table][id]);
  };

  return Object.freeze({
    quote: (id) => structuredClone(state.quotes[id] ?? null),
    quotes: () => Object.values(state.quotes).map((row) => structuredClone(row)),
    createQuote: (quote) => insert("quotes", quote),
    updateQuote: (id, patch) => replace("quotes", id, patch),
    order: (id) => structuredClone(state.orders[id] ?? null),
    orderByPaymentHash: (hash) => structuredClone(Object.values(state.orders).find((row) => row.payment_hash === hash) ?? null),
    createOrder: (order) => insert("orders", order),
    updateOrder: (id, patch) => replace("orders", id, patch),
  });
}
