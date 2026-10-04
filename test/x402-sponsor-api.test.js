import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSponsorApi, loadSponsorConfig, X402_NETWORK, X402_USDC_MINT } from "../src/x402/sponsor-api.js";
import { createSponsorStore } from "../src/x402/sponsor-store.js";

const PAY_TO = "11111111111111111111111111111111";
const REVIEW_TOKEN = "review-token-for-tests-that-is-longer-than-32-chars";
const config = (statePath) => ({
  payTo: PAY_TO,
  priceUsdc: "0.001",
  statePath,
  solanaRpcUrl: "https://mainnet.example-rpc.test",
  amountAtomic: "1000",
  reviewToken: REVIEW_TOKEN,
  allowedCategories: ["software"],
  fulfillmentWindow: "Within seven days of settlement.",
  cancellationPolicy: "Refunds if Radio LAN cancels before the read.",
  origin: "https://radiolan.live",
  facilitatorUrl: "https://facilitator.example",
});

function request(method, url, { body, headers = {} } = {}) {
  const source = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const stream = Readable.from(source);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  return stream;
}

function response() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body = body; },
    json() { return JSON.parse(this.body); },
  };
}

test("x402 stays off by default and enabled configuration fails closed", () => {
  assert.equal(loadSponsorConfig({}), null);
  assert.throws(() => loadSponsorConfig({ RADIOLAN_X402_ENABLED: "1" }), /CDP_API_KEY_ID and CDP_API_KEY_SECRET/);
  assert.throws(() => loadSponsorConfig({
    RADIOLAN_X402_ENABLED: "1",
    CDP_API_KEY_ID: "id",
    CDP_API_KEY_SECRET: "secret",
    RADIOLAN_X402_RECEIVE_ADDRESS: "not-an-address",
  }), /RADIOLAN_X402_RECEIVE_ADDRESS/);

  const env = {
    RADIOLAN_X402_ENABLED: "1",
    CDP_API_KEY_ID: "id",
    CDP_API_KEY_SECRET: "secret",
    RADIOLAN_X402_RECEIVE_ADDRESS: PAY_TO,
    RADIOLAN_X402_PRICE_USDC: "0.001",
    RADIOLAN_X402_STORE_PATH: "/tmp/radiolan-x402-store.json",
    RADIOLAN_X402_SOLANA_RPC_URL: "https://mainnet.example-rpc.test",
    RADIOLAN_X402_REVIEW_TOKEN: REVIEW_TOKEN,
    RADIOLAN_X402_ALLOWED_CATEGORIES: "software, creator-tools",
    RADIOLAN_X402_FULFILLMENT_WINDOW: "Within seven days of settlement.",
    RADIOLAN_X402_CANCELLATION_POLICY: "Refunds if Radio LAN cancels before the read.",
  };
  const settings = loadSponsorConfig(env);
  assert.equal(settings.priceUsdc, "0.001");
  assert.equal(settings.amountAtomic, "1000");
  for (const [price, atomic] of [["0.000001", "1"], ["0.009999", "9999"]]) {
    assert.equal(loadSponsorConfig({ ...env, RADIOLAN_X402_PRICE_USDC: price }).amountAtomic, atomic);
  }
  for (const price of ["0", "0.000000", "-0.001", "0.0000001", "0.01", "0.010000", "0.010001", "5.00", "1e-3", "NaN"]) {
    assert.throws(() => loadSponsorConfig({ ...env, RADIOLAN_X402_PRICE_USDC: price }), /less than 0\.01 USDC/, price);
  }
  assert.deepEqual(settings.allowedCategories, ["software", "creator-tools"]);
  assert.equal(settings.origin, "https://radiolan.live");
});

test("quote review precedes x402, settlement is durable and retries do not charge twice", async () => {
  const directory = mkdtempSync(join(tmpdir(), "radiolan-x402-"));
  try {
    const statePath = join(directory, "sponsor-state.json");
    const store = createSponsorStore({ path: statePath });
    let verified = 0;
    let settled = 0;
    const paymentServer = {
      async initialize() {},
      async processHTTPRequest(context) {
        if (!context.adapter.getHeader("payment-signature")) {
          return { type: "payment-error", response: { status: 402, headers: { "PAYMENT-REQUIRED": "challenge" }, body: { error: "Payment required" } } };
        }
        verified += 1;
        return {
          type: "payment-verified",
          paymentPayload: { x402Version: 2 },
          paymentRequirements: { network: X402_NETWORK, amount: "1000" },
          declaredExtensions: undefined,
          beforeHandlerSettlement: undefined,
        };
      },
      async processSettlement() {
        settled += 1;
        return { success: true, transaction: "test-transaction", payer: "buyer", headers: { "PAYMENT-RESPONSE": "settled-receipt" } };
      },
    };
    const api = createSponsorApi({ config: config(statePath), store, paymentServer, settlementVerifier: async () => true, now: () => 1_800_000_000_000 });
    const prefix = "/hub/api/x402";
    const body = { sponsor_name: "Orbit Labs", category: "software", copy: "Orbit Labs supports independent creator tools." };

    let res = response();
    await api(request("GET", `${prefix}/offer`), res);
    assert.equal(res.status, 200);
    assert.equal(res.json().protocol.network, X402_NETWORK);
    assert.equal(res.json().protocol.asset, X402_USDC_MINT);

    res = response();
    await api(request("POST", `${prefix}/quotes`, { body, headers: { "content-type": "application/json" } }), res);
    assert.equal(res.status, 201);
    const quoteId = res.json().quote.quote_id;

    res = response();
    await api(request("GET", `${prefix}/quotes/${quoteId}/purchase`), res);
    assert.equal(res.status, 409);
    assert.equal(verified, 0, "pending copy is never sent to x402 verification");

    res = response();
    await api(request("GET", `${prefix}/review-queue`), res);
    assert.equal(res.status, 401);
    res = response();
    await api(request("GET", `${prefix}/review-queue`, { headers: { authorization: `Bearer ${REVIEW_TOKEN}` } }), res);
    assert.equal(res.status, 200);
    assert.equal(res.json().quotes[0].copy, body.copy);

    res = response();
    await api(request("POST", `${prefix}/quotes/${quoteId}/review`, {
      body: { decision: "approve" },
      headers: { "content-type": "application/json", authorization: `Bearer ${REVIEW_TOKEN}` },
    }), res);
    assert.equal(res.status, 200);
    assert.equal(res.json().payment_url, `https://radiolan.live${prefix}/quotes/${quoteId}/purchase`);

    res = response();
    await api(request("GET", `${prefix}/quotes/${quoteId}/purchase`), res);
    assert.equal(res.status, 402);
    assert.equal(res.headers["PAYMENT-REQUIRED"], "challenge");

    res = response();
    await api(request("GET", `${prefix}/quotes/${quoteId}/purchase`, { headers: { "payment-signature": "same-signed-payment" } }), res);
    assert.equal(res.status, 201);
    assert.equal(res.headers["PAYMENT-RESPONSE"], "settled-receipt");
    const orderId = res.json().order.order_id;
    assert.equal(res.json().order.status, "paid_pending_fulfillment");
    assert.equal(res.json().sponsorship_copy, body.copy);

    res = response();
    await api(request("GET", `${prefix}/quotes/${quoteId}/purchase`, { headers: { "payment-signature": "same-signed-payment" } }), res);
    assert.equal(res.status, 200);
    assert.equal(res.json().replayed, true);
    assert.equal(verified, 1);
    assert.equal(settled, 1);

    res = response();
    await api(request("POST", `${prefix}/quotes/${quoteId}/review`, {
      body: { decision: "mark_fulfilled" },
      headers: { "content-type": "application/json", authorization: `Bearer ${REVIEW_TOKEN}` },
    }), res);
    assert.equal(res.status, 200);
    assert.equal(res.json().order.status, "fulfilled");
    assert.equal(createSponsorStore({ path: statePath }).order(orderId).status, "fulfilled");

    const recoveredApi = createSponsorApi({ config: config(statePath), store: createSponsorStore({ path: statePath }), paymentServer, settlementVerifier: async () => true, now: () => 1_800_000_000_000 });
    res = response();
    await recoveredApi(request("GET", `${prefix}/quotes/${quoteId}/purchase`, { headers: { "payment-signature": "same-signed-payment" } }), res);
    assert.equal(res.status, 200, "restart keeps the settled order replayable");
    assert.equal(res.headers["PAYMENT-RESPONSE"], "settled-receipt");
    assert.equal(settled, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unknown settlement stays locked until an operator records the verified outcome", async () => {
  const directory = mkdtempSync(join(tmpdir(), "radiolan-x402-unknown-"));
  try {
    const statePath = join(directory, "sponsor-state.json");
    const store = createSponsorStore({ path: statePath });
    const paymentServer = {
      async initialize() {},
      async processHTTPRequest() { return { type: "payment-verified", paymentPayload: {}, paymentRequirements: {}, declaredExtensions: undefined }; },
      async processSettlement() { throw new Error("facilitator timed out after submission"); },
    };
    const api = createSponsorApi({ config: config(statePath), store, paymentServer, now: () => 1_800_000_000_000 });
    let res = response();
    await api(request("POST", "/hub/api/x402/quotes", {
      body: { sponsor_name: "Orbit Labs", category: "software", copy: "Orbit Labs supports independent creator tools." },
      headers: { "content-type": "application/json" },
    }), res);
    const quoteId = res.json().quote.quote_id;
    res = response();
    await api(request("POST", `/hub/api/x402/quotes/${quoteId}/review`, {
      body: { decision: "approve" },
      headers: { "content-type": "application/json", authorization: `Bearer ${REVIEW_TOKEN}` },
    }), res);
    res = response();
    await api(request("GET", `/hub/api/x402/quotes/${quoteId}/purchase`, { headers: { "payment-signature": "uncertain-payment" } }), res);
    assert.equal(res.status, 503);
    const orderId = res.json().order_id;
    res = response();
    await api(request("GET", `/hub/api/x402/quotes/${quoteId}/purchase`, { headers: { "payment-signature": "uncertain-payment" } }), res);
    assert.equal(res.status, 503);
    res = response();
    await api(request("POST", `/hub/api/x402/quotes/${quoteId}/review`, {
      body: { decision: "resolve_settlement", order_id: orderId, outcome: "paid", transaction: "verified-chain-signature" },
      headers: { "content-type": "application/json", authorization: `Bearer ${REVIEW_TOKEN}` },
    }), res);
    assert.equal(res.status, 200);
    assert.equal(res.json().order.status, "paid_pending_fulfillment");
    assert.equal(res.json().order.transaction, "verified-chain-signature");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("facilitator success without finalized chain proof remains locked and cannot be paid twice", async () => {
  const directory = mkdtempSync(join(tmpdir(), "radiolan-x402-unverified-"));
  try {
    const statePath = join(directory, "sponsor-state.json");
    const store = createSponsorStore({ path: statePath });
    let settled = 0;
    const paymentServer = {
      async initialize() {},
      async processHTTPRequest() { return { type: "payment-verified", paymentPayload: {}, paymentRequirements: {}, declaredExtensions: undefined }; },
      async processSettlement() {
        settled += 1;
        return { success: true, transaction: "pending-finality", headers: { "PAYMENT-RESPONSE": "settled" } };
      },
    };
    const api = createSponsorApi({ config: config(statePath), store, paymentServer, settlementVerifier: async () => false, now: () => 1_800_000_000_000 });
    let res = response();
    await api(request("POST", "/hub/api/x402/quotes", {
      body: { sponsor_name: "Orbit Labs", category: "software", copy: "Orbit Labs supports independent creator tools." },
      headers: { "content-type": "application/json" },
    }), res);
    const quoteId = res.json().quote.quote_id;
    res = response();
    await api(request("POST", `/hub/api/x402/quotes/${quoteId}/review`, {
      body: { decision: "approve" },
      headers: { "content-type": "application/json", authorization: `Bearer ${REVIEW_TOKEN}` },
    }), res);
    res = response();
    await api(request("GET", `/hub/api/x402/quotes/${quoteId}/purchase`, { headers: { "payment-signature": "not-final-yet" } }), res);
    assert.equal(res.status, 503);
    assert.equal(res.json().error, "settlement_not_finally_verified");
    assert.equal(store.order(res.json().order_id).status, "settlement_unknown");
    res = response();
    await api(request("GET", `/hub/api/x402/quotes/${quoteId}/purchase`, { headers: { "payment-signature": "not-final-yet" } }), res);
    assert.equal(res.status, 503);
    assert.equal(res.headers["PAYMENT-RESPONSE"], "settled");
    assert.equal(settled, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Solana settlement verifier requires finalized transaction with exact recipient, mint, and atomic amount", async () => {
  const { verifySolanaSettlement } = await import("../src/x402/sponsor-api.js");
  const signature = "verified-signature";
  const transaction = {
    meta: {
      err: null,
      preTokenBalances: [{ accountIndex: 1, mint: X402_USDC_MINT, owner: PAY_TO, uiTokenAmount: { amount: "1000000" } }],
      postTokenBalances: [{ accountIndex: 1, mint: X402_USDC_MINT, owner: PAY_TO, uiTokenAmount: { amount: "1001000" } }],
    },
    transaction: { signatures: [signature] },
  };
  let rpcRequest;
  const fetchImpl = async (_url, init) => {
    rpcRequest = JSON.parse(init.body);
    return { ok: true, json: async () => ({ result: transaction }) };
  };
  const args = { rpcUrl: "https://rpc.example", signature, payTo: PAY_TO, amountAtomic: "1000", fetchImpl };
  assert.equal(await verifySolanaSettlement(args), true);
  assert.equal(rpcRequest.method, "getTransaction");
  assert.equal(rpcRequest.params[1].commitment, "finalized");
  transaction.meta.postTokenBalances[0].uiTokenAmount.amount = "1000999";
  assert.equal(await verifySolanaSettlement(args), false);
  transaction.meta.postTokenBalances[0].uiTokenAmount.amount = "1001000";
  transaction.meta.err = { InstructionError: [0, "Custom"] };
  assert.equal(await verifySolanaSettlement(args), false);
});

test("the official x402 server advertises the exact mainnet USDC requirement for an approved quote", async () => {
  const directory = mkdtempSync(join(tmpdir(), "radiolan-x402-wire-"));
  try {
    const statePath = join(directory, "sponsor-state.json");
    const store = createSponsorStore({ path: statePath });
    const facilitatorClient = {
      async getSupported() {
        return {
          kinds: [{ x402Version: 2, scheme: "exact", network: X402_NETWORK, extra: { feePayer: PAY_TO } }],
          extensions: [],
          signers: { "solana:*": [PAY_TO] },
        };
      },
      async verify() { throw new Error("unpaid request must not verify"); },
      async settle() { throw new Error("unpaid request must not settle"); },
    };
    const api = createSponsorApi({ config: config(statePath), store, facilitatorClient });
    await api.initialize();
    let res = response();
    await api(request("POST", "/hub/api/x402/quotes", {
      body: { sponsor_name: "Orbit Labs", category: "software", copy: "Orbit Labs supports independent creator tools." },
      headers: { "content-type": "application/json" },
    }), res);
    const quoteId = res.json().quote.quote_id;
    res = response();
    await api(request("POST", `/hub/api/x402/quotes/${quoteId}/review`, {
      body: { decision: "approve" },
      headers: { "content-type": "application/json", authorization: `Bearer ${REVIEW_TOKEN}` },
    }), res);
    res = response();
    await api(request("GET", `/hub/api/x402/quotes/${quoteId}/purchase`), res);
    assert.equal(res.status, 402);
    const challenge = JSON.parse(Buffer.from(res.headers["PAYMENT-REQUIRED"], "base64").toString("utf8"));
    assert.equal(challenge.x402Version, 2);
    assert.equal(challenge.accepts.length, 1);
    assert.equal(challenge.accepts[0].scheme, "exact");
    assert.equal(challenge.accepts[0].network, X402_NETWORK);
    assert.equal(challenge.accepts[0].amount, "1000");
    assert.equal(challenge.accepts[0].asset, X402_USDC_MINT);
    assert.equal(challenge.accepts[0].payTo, PAY_TO);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
