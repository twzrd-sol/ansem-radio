/**
 * Read-only check of a receipt against finalized Solana data, over plain JSON-RPC. Nothing is signed
 * and nothing is sent. The claim is narrow: the declared recipient's USDC balance rose by exactly the
 * declared amount in that finalized transaction. Labels, purposes and who paid stay declared, not
 * proven. The RPC provider is a trust point; anyone can re-check the signature in any explorer.
 * The recipient is a WALLET address (a token balance's `owner`), not one of its USDC token accounts;
 * pasting the token account is reported as address_is_token_account instead of a bare mismatch.
 *
 * Statuses: verified, mismatch (the chain disagrees), not_found (unknown or not finalized yet),
 * unavailable (RPC trouble, retry later), unverified (no RPC configured; nothing was asked).
 * The RPC URL often carries an API key, so it is never logged or placed in a result.
 */

import { USDC_MINT } from "./receipt.js";

export const VERIFICATION_STATUSES = Object.freeze(["verified", "mismatch", "not_found", "unavailable", "unverified"]);

function result(status, reason = null, blockTime = null, extra = {}) {
  return Object.freeze({
    status,
    reason,
    block_time: Number.isSafeInteger(blockTime) ? new Date(blockTime * 1000).toISOString() : null,
    ...extra,
  });
}

function balanceOf(balances, owner) {
  if (!Array.isArray(balances)) throw new TypeError("token balances missing");
  return balances
    .filter((entry) => entry?.owner === owner && entry?.mint === USDC_MINT)
    .reduce((total, entry) => total + BigInt(entry.uiTokenAmount.amount), 0n);
}

/** True when `address` is one of the transaction's USDC token accounts rather than a wallet. */
function isUsdcTokenAccount(transaction, address) {
  const staticKeys = transaction.transaction?.message?.accountKeys;
  if (!Array.isArray(staticKeys)) return false;
  const loaded = transaction.meta?.loadedAddresses ?? {};
  const keys = [...staticKeys, ...(loaded.writable ?? []), ...(loaded.readonly ?? [])]
    .map((key) => (typeof key === "string" ? key : key?.pubkey));
  const index = keys.indexOf(address);
  if (index < 0) return false;
  const { preTokenBalances = [], postTokenBalances = [] } = transaction.meta;
  return [...preTokenBalances, ...postTokenBalances].some((entry) => entry?.accountIndex === index && entry?.mint === USDC_MINT);
}

/** Net USDC change for one owner across every token account they hold in the transaction. */
export function ownerDelta(meta, owner) {
  return balanceOf(meta.postTokenBalances, owner) - balanceOf(meta.preTokenBalances, owner);
}

export function createSolanaVerifier({
  rpcUrl = process.env.SOLANA_RPC_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
} = {}) {
  const enabled = Boolean(rpcUrl) && typeof fetchImpl === "function";

  const verify = async (receipt) => {
    if (!enabled) return result("unverified", "rpc_not_configured");
    let payload;
    try {
      const response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [receipt.tx, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return result("unavailable", `rpc_http_${response.status}`);
      payload = await response.json();
    } catch (error) {
      return result("unavailable", ["TimeoutError", "AbortError"].includes(error?.name) ? "rpc_timeout" : "rpc_unreachable");
    }
    if (payload?.error) return result("unavailable", "rpc_error");
    const transaction = payload?.result;
    if (transaction === null) return result("not_found", "unknown_or_not_finalized");
    if (!transaction || typeof transaction !== "object" || !transaction.meta) return result("unavailable", "rpc_malformed");
    if (transaction.meta.err !== null && transaction.meta.err !== undefined) {
      return result("mismatch", "transaction_failed", transaction.blockTime);
    }
    let delta;
    try {
      delta = ownerDelta(transaction.meta, receipt.to_address);
    } catch {
      return result("unavailable", "rpc_malformed");
    }
    if (delta === BigInt(receipt.amount)) return result("verified", null, transaction.blockTime);
    const reason = delta === 0n
      ? (isUsdcTokenAccount(transaction, receipt.to_address) ? "address_is_token_account" : "recipient_received_no_usdc")
      : (delta < 0n ? "recipient_sent_usdc" : "amount_differs");
    return result("mismatch", reason, transaction.blockTime, { chain_amount: delta.toString() });
  };

  return Object.freeze({ verify, enabled });
}
