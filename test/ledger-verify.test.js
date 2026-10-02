import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadLedger } from "../src/ledger/ledger.js";
import { USDC_MINT } from "../src/ledger/receipt.js";
import { createSolanaVerifier, ownerDelta } from "../src/ledger/verify.js";

const ledger = loadLedger(JSON.parse(readFileSync(new URL("../docs/examples/ledger.example.json", import.meta.url), "utf8")));
const receipt = ledger.receipts.find((item) => item.kind === "support"); // 40.00 USDC to the artist
const ARTIST = receipt.to_address;
const OTHER = ledger.campaign.receive.address;
const OTHER_MINT = "So11111111111111111111111111111111111111112";
const RPC_URL = "https://rpc.example/?api-key=SECRET-KEY";
const BLOCK_TIME = 1790000000;

const balance = (owner, amount, { mint = USDC_MINT, accountIndex = 1 } = {}) => ({
  accountIndex,
  mint,
  owner,
  uiTokenAmount: { amount: String(amount), decimals: 6, uiAmountString: "ignored" },
});
const chain = ({ err = null, pre = [], post = [], blockTime = BLOCK_TIME } = {}) => ({
  slot: 1,
  blockTime,
  meta: { err, fee: 5000, preTokenBalances: pre, postTokenBalances: post },
  transaction: {},
});
const answer = (result, extra = {}) => ({ ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result, ...extra }) });
const verifierFor = (respond) => {
  const calls = [];
  const verifier = createSolanaVerifier({
    rpcUrl: RPC_URL,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return respond(url, options);
    },
  });
  return { verifier, calls };
};

test("verified: the declared recipient's USDC rose by exactly the declared amount in a finalized transaction", async () => {
  const { verifier, calls } = verifierFor(() => answer(chain({
    pre: [balance(ARTIST, 10_000_000), balance(OTHER, 90_000_000, { accountIndex: 2 })],
    post: [balance(ARTIST, 50_000_000), balance(OTHER, 50_000_000, { accountIndex: 2 })],
  })));
  const outcome = await verifier.verify(receipt);
  assert.deepEqual(outcome, { status: "verified", reason: null, block_time: new Date(BLOCK_TIME * 1000).toISOString() });
  assert.equal(Object.isFrozen(outcome), true);
  assert.equal(verifier.enabled, true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, RPC_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["content-type"], "application/json");
  assert.ok(calls[0].options.signal instanceof AbortSignal, "every request has a timeout");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: [receipt.tx, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }],
  });
});

test("a new token account (no pre-balance) and several accounts for one owner are handled by owner, not account", async () => {
  const fresh = verifierFor(() => answer(chain({ pre: [], post: [balance(ARTIST, 40_000_000)] })));
  assert.equal((await fresh.verifier.verify(receipt)).status, "verified");

  const split = verifierFor(() => answer(chain({
    pre: [balance(ARTIST, 5_000_000, { accountIndex: 1 }), balance(ARTIST, 0, { accountIndex: 3 })],
    post: [balance(ARTIST, 25_000_000, { accountIndex: 1 }), balance(ARTIST, 20_000_000, { accountIndex: 3 })],
  })));
  assert.equal((await split.verifier.verify(receipt)).status, "verified", "5 + 0 -> 25 + 20 is a 40 rise");

  const closed = verifierFor(() => answer(chain({ pre: [balance(ARTIST, 0)], post: [balance(ARTIST, 40_000_000)] })));
  assert.equal((await closed.verifier.verify(receipt)).status, "verified");
  assert.equal(ownerDelta({ preTokenBalances: [balance(ARTIST, 7)], postTokenBalances: [] }, ARTIST), -7n, "a drained account is a negative delta");
});

test("mismatch: the chain disagrees, and says by how much", async () => {
  const short = await verifierFor(() => answer(chain({ post: [balance(ARTIST, 30_000_000)] }))).verifier.verify(receipt);
  assert.equal(short.status, "mismatch");
  assert.equal(short.reason, "amount_differs");
  assert.equal(short.chain_amount, "30000000");

  const over = await verifierFor(() => answer(chain({ post: [balance(ARTIST, 40_000_001)] }))).verifier.verify(receipt);
  assert.equal(over.status, "mismatch", "exact equality, not at least");

  const wrongRecipient = await verifierFor(() => answer(chain({ post: [balance(OTHER, 40_000_000)] }))).verifier.verify(receipt);
  assert.equal(wrongRecipient.status, "mismatch");
  assert.equal(wrongRecipient.reason, "recipient_received_no_usdc");
  assert.equal(wrongRecipient.chain_amount, "0");

  const sender = await verifierFor(() => answer(chain({ pre: [balance(ARTIST, 40_000_000)], post: [balance(ARTIST, 0)] }))).verifier.verify(receipt);
  assert.equal(sender.status, "mismatch");
  assert.equal(sender.reason, "recipient_sent_usdc", "the declared recipient is actually the payer");
  assert.equal(sender.chain_amount, "-40000000");

  // Pasting the recipient's USDC token account (common when copying from an explorer) instead of their wallet.
  const TOKEN_ACCOUNT = "TokenAcct11111111111111111111111111111111111";
  const asAccount = { ...receipt, to_address: TOKEN_ACCOUNT };
  const inKeys = { message: { accountKeys: [{ pubkey: OTHER }, { pubkey: TOKEN_ACCOUNT }] } };
  const pasted = await verifierFor(() => answer({ ...chain({ post: [balance(ARTIST, 40_000_000, { accountIndex: 1 })] }), transaction: inKeys })).verifier.verify(asAccount);
  assert.equal(pasted.status, "mismatch");
  assert.equal(pasted.reason, "address_is_token_account", "a precise reason, not a bare mismatch");
  assert.equal(pasted.chain_amount, "0");

  const viaLookupTable = { ...chain({ post: [balance(ARTIST, 40_000_000, { accountIndex: 1 })] }), transaction: { message: { accountKeys: [{ pubkey: OTHER }] } } };
  viaLookupTable.meta.loadedAddresses = { writable: [], readonly: [TOKEN_ACCOUNT] };
  assert.equal((await verifierFor(() => answer(viaLookupTable)).verifier.verify(asAccount)).reason, "address_is_token_account", "loaded addresses count");

  const otherMintAccount = await verifierFor(() => answer({ ...chain({ post: [balance(ARTIST, 40_000_000, { accountIndex: 1, mint: OTHER_MINT })] }), transaction: inKeys })).verifier.verify(asAccount);
  assert.equal(otherMintAccount.reason, "recipient_received_no_usdc", "only a USDC token account earns the hint");

  const wrongMint = await verifierFor(() => answer(chain({ post: [balance(ARTIST, 40_000_000, { mint: OTHER_MINT })] }))).verifier.verify(receipt);
  assert.equal(wrongMint.status, "mismatch", "same amount of a different asset is not USDC");
  assert.equal(wrongMint.reason, "recipient_received_no_usdc");

  const failed = await verifierFor(() => answer(chain({ err: { InstructionError: [0, "Custom"] }, post: [balance(ARTIST, 40_000_000)] }))).verifier.verify(receipt);
  assert.equal(failed.status, "mismatch");
  assert.equal(failed.reason, "transaction_failed");
  assert.equal(failed.block_time, new Date(BLOCK_TIME * 1000).toISOString());
});

test("not_found when the RPC has no finalized transaction for that signature", async () => {
  const outcome = await verifierFor(() => answer(null)).verifier.verify(receipt);
  assert.deepEqual(outcome, { status: "not_found", reason: "unknown_or_not_finalized", block_time: null });
});

test("unavailable, never a false verdict, whenever the RPC misbehaves", async () => {
  const reasons = async (respond) => (await verifierFor(respond).verifier.verify(receipt));
  const cases = [
    [() => { throw new TypeError("fetch failed"); }, "rpc_unreachable"],
    [() => { throw Object.assign(new Error("slow"), { name: "TimeoutError" }); }, "rpc_timeout"],
    [() => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }, "rpc_timeout"],
    [() => ({ ok: false, status: 429, json: async () => ({}) }), "rpc_http_429"],
    [() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } }), "rpc_unreachable"],
    [() => answer(undefined, { error: { code: -32005, message: "rate limited" } }), "rpc_error"],
    [() => answer({ slot: 1 }), "rpc_malformed"],
    [() => answer("nonsense"), "rpc_malformed"],
    [() => ({ ok: true, status: 200, json: async () => ({}) }), "rpc_malformed"],
    [() => answer(chain({ post: [balance(ARTIST, "forty")] })), "rpc_malformed"],
    [() => answer({ slot: 1, meta: { err: null } }), "rpc_malformed"],
  ];
  for (const [respond, reason] of cases) {
    const outcome = await reasons(respond);
    assert.equal(outcome.status, "unavailable", reason);
    assert.equal(outcome.reason, reason);
  }
});

test("unverified, truthfully, when no RPC is configured: nothing is asked and nothing is claimed", async () => {
  let asked = false;
  const noUrl = createSolanaVerifier({ rpcUrl: "", fetchImpl: async () => { asked = true; } });
  assert.equal(noUrl.enabled, false);
  assert.deepEqual(await noUrl.verify(receipt), { status: "unverified", reason: "rpc_not_configured", block_time: null });
  const noFetch = createSolanaVerifier({ rpcUrl: RPC_URL, fetchImpl: null });
  assert.equal(noFetch.enabled, false);
  assert.equal((await noFetch.verify(receipt)).status, "unverified");
  assert.equal(asked, false);
});

test("the RPC URL, which often carries an API key, never appears in a result", async () => {
  const failures = [
    () => { throw new Error(`connect ECONNREFUSED ${RPC_URL}`); },
    () => ({ ok: false, status: 401, json: async () => ({ error: RPC_URL }) }),
    () => answer(undefined, { error: { message: RPC_URL } }),
    () => answer(chain({ post: [balance(ARTIST, 1)] })),
    () => answer(null),
  ];
  for (const respond of failures) {
    const outcome = await verifierFor(respond).verifier.verify(receipt);
    assert.equal(JSON.stringify(outcome).includes("SECRET-KEY"), false);
    assert.equal(JSON.stringify(outcome).includes("rpc.example"), false);
  }
});
