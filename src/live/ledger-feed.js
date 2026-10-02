/**
 * Holds the current public ledger for the live room. Re-reads the operator's ledger file on a timer,
 * checks each new receipt against Solana, and emits ("receipt", snapshot) when the public view changes.
 * Receipts go out at once as "not checked" and flip as each check lands, so a slow or dead RPC never
 * delays the room. A broken save keeps the last good ledger on air and is reported to the operator,
 * the same way the board keeps its last good rows.
 */

import { readFile } from "node:fs/promises";

import { loadLedger, toPublicLedger } from "../ledger/ledger.js";
import { LedgerError } from "../ledger/receipt.js";
import { createSolanaVerifier } from "../ledger/verify.js";

// A finalized transaction never changes, so verified and mismatch are final for a receipt id (editing a
// receipt changes its id). Unverified means no RPC is configured and nothing was asked. The rest retry.
const FINAL = new Set(["verified", "mismatch", "unverified"]);

export function createLedgerFeed({
  path,
  readText = (file) => readFile(file, "utf8"),
  verifier = createSolanaVerifier(),
  intervalMs = 15_000,
  retryAfterMs = 60_000,
  concurrency = 2,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => clearTimeout(timer),
  now = () => Date.now(),
} = {}) {
  if (typeof path !== "string" || !path) throw new TypeError("path is required");
  if (typeof verifier?.verify !== "function") throw new TypeError("verifier.verify must be a function");
  const listeners = new Set();
  const checked = new Map();
  let ledger = null;
  let publicLedger = null;
  let lastError = null;
  let lastDetail = null;
  let updatedAt = null;
  let lastPayload = null;
  let verifying = null;
  let timer = null;
  let active = false;

  const emit = (type, data) => {
    for (const listener of listeners) {
      try {
        listener(type, data);
      } catch {
        // A consumer must never break the feed, least of all from the background check pass.
      }
    }
  };
  const snapshot = () => Object.freeze({
    ledger: publicLedger,
    updated_at: updatedAt,
    last_error: lastError,
    last_detail: lastDetail,
    enabled: active,
  });

  const needsCheck = (receipt) => {
    const previous = checked.get(receipt.id);
    if (!previous) return true;
    return !FINAL.has(previous.status) && now() - previous.checked_at >= retryAfterMs;
  };

  const verifyPending = async (receipts) => {
    const queue = receipts.filter(needsCheck);
    const worker = async () => {
      while (queue.length) {
        const receipt = queue.shift();
        let outcome;
        try {
          outcome = await verifier.verify(receipt);
        } catch {
          outcome = { status: "unavailable", reason: "verifier_failed", block_time: null };
        }
        checked.set(receipt.id, { ...outcome, checked_at: now() });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  };

  /** Rebuild the public view from what is known now, and announce it only if it changed. */
  const publish = () => {
    if (ledger) publicLedger = toPublicLedger(ledger, checked);
    updatedAt = new Date(now()).toISOString();
    const payload = JSON.stringify([publicLedger, lastError, lastDetail]);
    if (payload !== lastPayload) {
      lastPayload = payload;
      emit("receipt", snapshot());
    }
  };

  const load = async () => {
    try {
      const text = await readText(path);
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new LedgerError("ledger_invalid", "ledger: not valid JSON");
      }
      ledger = loadLedger(parsed);
      lastError = null;
      lastDetail = null;
    } catch (error) {
      const invalid = error instanceof LedgerError;
      lastError = invalid ? "ledger_invalid" : "ledger_unreadable";
      lastDetail = invalid ? error.detail : null;
    }
  };

  // One check pass at a time; a tick that lands mid-pass shares it and the next tick picks up the rest.
  const verifyAll = () => {
    if (!ledger) return Promise.resolve();
    verifying ??= verifyPending(ledger.receipts).then(publish).catch(() => {}).finally(() => { verifying = null; });
    return verifying;
  };

  /** Read the file and publish at once; wait for the Solana checks only when asked. */
  const refresh = async ({ wait = true } = {}) => {
    await load();
    publish();
    const checks = verifyAll();
    if (wait) await checks;
    return snapshot();
  };

  const loop = async () => {
    if (!active) return;
    await refresh();
    if (!active) return;
    timer = schedule(loop, intervalMs);
  };

  const start = async () => {
    if (active) return snapshot();
    active = true;
    await refresh({ wait: false });
    if (active) timer = schedule(loop, intervalMs);
    return snapshot();
  };
  const stop = () => {
    active = false;
    if (timer) cancel(timer);
    timer = null;
    return snapshot();
  };
  const subscribe = (listener) => {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return Object.freeze({ start, stop, refresh, snapshot, subscribe });
}
