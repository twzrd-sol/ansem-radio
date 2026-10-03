import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { x402HTTPResourceServer } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";

import { isSolanaAddress, publicText } from "../ledger/receipt.js";
import { createRateLimiter, HttpError, readJson } from "../platform/guard.js";
import { createSponsorStore } from "./sponsor-store.js";

export const X402_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const X402_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const X402_API_PREFIX = "/hub/api/x402/";
const QUOTE_TTL_SECONDS = 86_400;
const COPY_MAX = 600;
const SPONSOR_MAX = 80;
const STATES = new Set(["pending_review", "approved", "rejected", "settling", "paid"]);
const TOKEN_SCALE = 1_000_000n;

function toAtomicUsdc(value) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * TOKEN_SCALE + BigInt(fraction.padEnd(6, "0"));
}

/** Verify a finalized Solana transaction's signature and exact USDC owner balance delta. */
export async function verifySolanaSettlement({ rpcUrl, signature, payTo, amountAtomic, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "radiolan-x402-settlement",
      method: "getTransaction",
      params: [signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("solana_rpc_unavailable");
  const payload = await response.json();
  if (payload.error) throw new Error("solana_rpc_error");
  const transaction = payload.result;
  if (!transaction || transaction.meta?.err !== null || !transaction.transaction?.signatures?.includes(signature)) return false;
  const pre = new Map((transaction.meta.preTokenBalances ?? []).map((balance) => [`${balance.accountIndex}:${balance.mint}:${balance.owner}`, BigInt(balance.uiTokenAmount.amount)]));
  const post = new Map((transaction.meta.postTokenBalances ?? []).map((balance) => [`${balance.accountIndex}:${balance.mint}:${balance.owner}`, BigInt(balance.uiTokenAmount.amount)]));
  const keys = new Set([...pre.keys(), ...post.keys()]);
  let received = 0n;
  for (const key of keys) {
    const [, mint, owner] = key.split(":");
    if (mint !== X402_USDC_MINT || owner !== payTo) continue;
    received += (post.get(key) ?? 0n) - (pre.get(key) ?? 0n);
  }
  return received === BigInt(amountAtomic);
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required when RADIOLAN_X402_ENABLED=1`);
  return value;
}

function publicTerms(value, name, max) {
  try { return publicText(value, name, max, "x402_config_invalid"); }
  catch { throw new TypeError(`${name} must be 1 to ${max} safe public characters`); }
}

/** Null means deliberately disabled. Enabled with incomplete settings is an operator error. */
export function loadSponsorConfig(env = process.env) {
  if (env.RADIOLAN_X402_ENABLED !== "1") return null;
  if (!env.CDP_API_KEY_ID?.trim() || !env.CDP_API_KEY_SECRET?.trim()) {
    throw new TypeError("CDP_API_KEY_ID and CDP_API_KEY_SECRET are required when x402 is enabled");
  }
  const payTo = required(env, "RADIOLAN_X402_RECEIVE_ADDRESS");
  if (!isSolanaAddress(payTo)) throw new TypeError("RADIOLAN_X402_RECEIVE_ADDRESS must be a Solana wallet address");
  const priceUsdc = required(env, "RADIOLAN_X402_PRICE_USDC");
  if (!/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/.test(priceUsdc) || Number(priceUsdc) <= 0) {
    throw new TypeError("RADIOLAN_X402_PRICE_USDC must be a positive decimal with at most 6 places");
  }
  const statePath = required(env, "RADIOLAN_X402_STORE_PATH");
  if (!statePath.startsWith("/")) throw new TypeError("RADIOLAN_X402_STORE_PATH must be absolute");
  const solanaRpcUrl = required(env, "RADIOLAN_X402_SOLANA_RPC_URL");
  let parsedRpc;
  try { parsedRpc = new URL(solanaRpcUrl); } catch { throw new TypeError("RADIOLAN_X402_SOLANA_RPC_URL must be an HTTPS Solana mainnet RPC URL"); }
  if (parsedRpc.protocol !== "https:" || parsedRpc.hostname.toLowerCase().includes("devnet") || parsedRpc.hostname.toLowerCase().includes("testnet")) {
    throw new TypeError("RADIOLAN_X402_SOLANA_RPC_URL must be an HTTPS Solana mainnet RPC URL");
  }
  const reviewToken = required(env, "RADIOLAN_X402_REVIEW_TOKEN");
  if (reviewToken.length < 32) throw new TypeError("RADIOLAN_X402_REVIEW_TOKEN must be at least 32 characters");
  const categories = required(env, "RADIOLAN_X402_ALLOWED_CATEGORIES").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!categories.length || categories.some((value) => !/^[a-z][a-z0-9_-]{0,31}$/.test(value))) {
    throw new TypeError("RADIOLAN_X402_ALLOWED_CATEGORIES must be a comma-separated list of category slugs");
  }
  const origin = env.RADIOLAN_X402_PUBLIC_ORIGIN?.trim() || "https://radiolan.live";
  if (origin !== "https://radiolan.live") throw new TypeError("RADIOLAN_X402_PUBLIC_ORIGIN must be https://radiolan.live");
  return Object.freeze({
    payTo,
    priceUsdc,
    statePath,
    solanaRpcUrl,
    amountAtomic: toAtomicUsdc(priceUsdc).toString(),
    reviewToken,
    allowedCategories: Object.freeze([...new Set(categories)]),
    fulfillmentWindow: publicTerms(required(env, "RADIOLAN_X402_FULFILLMENT_WINDOW"), "RADIOLAN_X402_FULFILLMENT_WINDOW", 240),
    cancellationPolicy: publicTerms(required(env, "RADIOLAN_X402_CANCELLATION_POLICY"), "RADIOLAN_X402_CANCELLATION_POLICY", 400),
    origin,
    facilitatorUrl: env.RADIOLAN_X402_FACILITATOR_URL?.trim() || "https://api.cdp.coinbase.com/platform/v2/x402",
  });
}

function safeQuote(quote, config) {
  return {
    quote_id: quote.id,
    status: quote.status,
    sponsor_name: quote.sponsor_name,
    category: quote.category,
    copy: quote.copy,
    amount_usdc: config.priceUsdc,
    network: X402_NETWORK,
    asset: X402_USDC_MINT,
    expires_at: quote.expires_at,
    ...(quote.order_id ? { order_id: quote.order_id } : {}),
  };
}

function safeOrder(order) {
  return {
    order_id: order.id,
    quote_id: order.quote_id,
    status: order.status,
    sponsor_name: order.sponsor_name,
    amount_usdc: order.amount_usdc,
    network: X402_NETWORK,
    transaction: order.transaction ?? null,
    created_at: order.created_at,
    ...(order.fulfilled_at ? { fulfilled_at: order.fulfilled_at } : {}),
  };
}

function reply(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(body));
}

function bearerMatches(header, token) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header ?? ""));
  if (!match) return false;
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function paymentAdapter(request, requestUrl, origin) {
  return {
    getHeader: (name) => {
      const value = request.headers[name.toLowerCase()];
      return Array.isArray(value) ? value.join(", ") : value;
    },
    getMethod: () => request.method ?? "GET",
    getPath: () => `${requestUrl.pathname}${requestUrl.search}`,
    getUrl: () => `${origin}${requestUrl.pathname}${requestUrl.search}`,
    getAcceptHeader: () => String(request.headers.accept ?? ""),
    getUserAgent: () => String(request.headers["user-agent"] ?? ""),
  };
}

export function createSponsorApi({
  config,
  store = config ? createSponsorStore({ path: config.statePath }) : null,
  paymentServer = null,
  facilitatorClient = null,
  settlementVerifier = verifySolanaSettlement,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  rateLimit = createRateLimiter({ limit: 20, windowMs: 60_000 }),
  bodyReader = readJson,
  log = console,
} = {}) {
  if (!config) return null;
  if (!paymentServer) {
    const facilitator = facilitatorClient ?? createCdpFacilitatorClient({
      baseUrl: config.facilitatorUrl,
      apiKeyId: process.env.CDP_API_KEY_ID,
      apiKeySecret: process.env.CDP_API_KEY_SECRET,
    });
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactSvmScheme());
    paymentServer = new x402HTTPResourceServer(resourceServer, {
      "GET /hub/api/x402/quotes/:id/purchase": {
        accepts: { scheme: "exact", price: `$${config.priceUsdc}`, network: X402_NETWORK, payTo: config.payTo },
        description: "Book one operator-reviewed, disclosed 60-second Radio LAN sponsor read",
        mimeType: "application/json",
        serviceName: "Radio LAN sponsor reads",
        tags: ["media", "sponsorship", "solana"],
      },
    });
  }
  if (!store) throw new TypeError("x402 sponsor state store is required");
  const busyQuotes = new Set();

  const publicQuote = (id) => {
    const quote = store.quote(id);
    if (!quote) throw new HttpError(404, "quote_not_found");
    return quote;
  };
  const isExpired = (quote) => Date.parse(quote.expires_at) <= now();

  const handlePurchase = async (request, response, requestUrl, quote) => {
    if (isExpired(quote)) return reply(response, 410, { error: "quote_expired" });
    if (!STATES.has(quote.status)) return reply(response, 409, { error: "quote_not_payable" });
    if (quote.status === "paid" && quote.order_id) {
      const existing = store.order(quote.order_id);
      return existing
        ? reply(response, 200, { order: safeOrder(existing), replayed: true }, existing.payment_response ? { "PAYMENT-RESPONSE": existing.payment_response } : {})
        : reply(response, 503, { error: "settled_order_needs_reconciliation", order_id: quote.order_id });
    }
    const signature = String(request.headers["payment-signature"] ?? "");
    if (signature) {
      const paymentHash = createHash("sha256").update(signature).digest("hex");
      const prior = store.orderByPaymentHash(paymentHash);
      if (prior) {
        if (prior.status === "paid_pending_fulfillment" || prior.status === "fulfilled") {
          return reply(response, 200, { order: safeOrder(prior), replayed: true }, prior.payment_response ? { "PAYMENT-RESPONSE": prior.payment_response } : {});
        }
        return reply(response, 503, { error: "settlement_outcome_unknown", order_id: prior.id }, prior.payment_response ? { "PAYMENT-RESPONSE": prior.payment_response } : {});
      }
    }
    if (quote.status !== "approved") return reply(response, quote.status === "settling" ? 503 : 409, { error: quote.status === "settling" ? "settlement_outcome_unknown" : "quote_not_approved", ...(quote.order_id ? { order_id: quote.order_id } : {}) });
    if (busyQuotes.has(quote.id)) return reply(response, 409, { error: "quote_payment_in_progress" });

    const adapter = paymentAdapter(request, requestUrl, config.origin);
    const context = { adapter, path: `${requestUrl.pathname}${requestUrl.search}`, method: request.method ?? "GET" };
    let processed;
    try {
      processed = await paymentServer.processHTTPRequest(context);
    } catch {
      return reply(response, 503, { error: "payment_verification_unavailable" });
    }
    if (processed.type === "payment-error") {
      const instruction = processed.response;
      return reply(response, instruction.status, instruction.body ?? {}, instruction.headers);
    }
    if (processed.type !== "payment-verified") return reply(response, 404, { error: "payment_route_unavailable" });

    busyQuotes.add(quote.id);
    const paymentHash = createHash("sha256").update(signature).digest("hex");
    const orderId = randomUUID().replaceAll("-", "");
    const createdAt = new Date(now()).toISOString();
    const order = {
      id: orderId,
      quote_id: quote.id,
      payment_hash: paymentHash,
      sponsor_name: quote.sponsor_name,
      copy: quote.copy,
      category: quote.category,
      amount_usdc: config.priceUsdc,
      network: X402_NETWORK,
      status: "settling",
      transaction: null,
      created_at: createdAt,
      payment_response: null,
    };
    try {
      store.createOrder(order);
      store.updateQuote(quote.id, { status: "settling", order_id: orderId });
    } catch {
      busyQuotes.delete(quote.id);
      return reply(response, 503, { error: "order_store_unavailable" });
    }

    const resultBody = {
      order_id: orderId,
      quote_id: quote.id,
      status: "paid_pending_fulfillment",
      sponsor_name: quote.sponsor_name,
      copy: quote.copy,
      amount_usdc: config.priceUsdc,
      fulfillment_window: config.fulfillmentWindow,
    };
    let settled;
    try {
      settled = await paymentServer.processSettlement(
        processed.paymentPayload,
        processed.paymentRequirements,
        processed.declaredExtensions,
        {
          request: context,
          responseBody: Buffer.from(JSON.stringify(resultBody)),
          responseHeaders: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        },
        undefined,
        processed.beforeHandlerSettlement,
      );
    } catch {
      store.updateOrder(orderId, { status: "settlement_unknown" });
      busyQuotes.delete(quote.id);
      return reply(response, 503, { error: "settlement_outcome_unknown", order_id: orderId });
    }
    if (!settled.success) {
      store.updateOrder(orderId, { status: "settlement_unknown" });
      busyQuotes.delete(quote.id);
      return reply(response, settled.response.status, settled.response.body ?? { error: "settlement_failed" }, settled.response.headers);
    }
    let verified = false;
    try {
      verified = await settlementVerifier({
        rpcUrl: config.solanaRpcUrl,
        signature: settled.transaction,
        payTo: config.payTo,
        amountAtomic: config.amountAtomic ?? toAtomicUsdc(config.priceUsdc).toString(),
        fetchImpl,
      });
    } catch {
      // A facilitator success is not proof of finalized receipt. Keep the write-ahead order locked.
    }
    if (!verified) {
      store.updateOrder(orderId, {
        status: "settlement_unknown",
        transaction: settled.transaction ?? null,
        payer: settled.payer ?? null,
        payment_response: settled.headers?.["PAYMENT-RESPONSE"] ?? null,
      });
      busyQuotes.delete(quote.id);
      return reply(response, 503, { error: "settlement_not_finally_verified", order_id: orderId }, settled.headers);
    }
    try {
      const stored = store.updateOrder(orderId, {
        status: "paid_pending_fulfillment",
        transaction: settled.transaction,
        payer: settled.payer ?? null,
        payment_response: settled.headers?.["PAYMENT-RESPONSE"] ?? null,
      });
      store.updateQuote(quote.id, { status: "paid" });
      busyQuotes.delete(quote.id);
      return reply(response, 201, { order: safeOrder(stored), sponsorship_copy: quote.copy }, settled.headers);
    } catch {
      // The write-ahead order remains locked for operator reconciliation; retrying must not charge again.
      busyQuotes.delete(quote.id);
      log.error?.("x402 sponsor order: settlement succeeded but durable record update failed");
      return reply(response, 503, { error: "settled_order_needs_reconciliation", order_id: orderId }, settled.headers);
    }
  };

  const handle = async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", config.origin); }
    catch { return reply(response, 400, { error: "bad_request_url" }); }
    const { pathname } = url;
    try {
      if (request.method === "GET" && pathname === "/hub/api/x402/offer") {
        return reply(response, 200, {
          service: "Radio LAN sponsor reads",
          description: "One operator-reviewed, disclosed 60-second read of a sponsor's public material. No Twitch metrics are sold.",
          protocol: { version: 2, scheme: "exact", network: X402_NETWORK, asset: X402_USDC_MINT },
          amount_usdc: config.priceUsdc,
          fulfillment_window: config.fulfillmentWindow,
          cancellation_policy: config.cancellationPolicy,
          accepted_categories: config.allowedCategories,
          routes: { submit_quote: "POST /hub/api/x402/quotes", purchase: "GET /hub/api/x402/quotes/{quote_id}/purchase" },
        });
      }
      if (request.method === "POST" && pathname === "/hub/api/x402/quotes") {
        if (!rateLimit("quote-submissions")) return reply(response, 429, { error: "slow_down" }, { "Retry-After": "60" });
        const body = await bodyReader(request, 16_384);
        if (Object.keys(body).some((key) => !["sponsor_name", "category", "copy"].includes(key))) throw new HttpError(400, "unknown_field");
        if (typeof body.category !== "string" || !config.allowedCategories.includes(body.category.toLowerCase())) throw new HttpError(400, "category_not_accepted");
        const sponsorName = publicText(body.sponsor_name, "sponsor_name", SPONSOR_MAX, "quote_invalid");
        const copy = publicText(body.copy, "copy", COPY_MAX, "quote_invalid");
        const nowMs = now();
        const id = randomUUID().replaceAll("-", "");
        const quote = store.createQuote({
          id,
          sponsor_name: sponsorName,
          category: body.category.toLowerCase(),
          copy,
          status: "pending_review",
          amount_usdc: config.priceUsdc,
          created_at: new Date(nowMs).toISOString(),
          expires_at: new Date(nowMs + QUOTE_TTL_SECONDS * 1000).toISOString(),
          order_id: null,
        });
        return reply(response, 201, { quote: safeQuote(quote, config), review_required: true });
      }
      if (request.method === "GET" && pathname === "/hub/api/x402/review-queue") {
        if (!bearerMatches(request.headers.authorization, config.reviewToken)) return reply(response, 401, { error: "operator_auth_required" }, { "WWW-Authenticate": "Bearer" });
        return reply(response, 200, { quotes: store.quotes().filter((quote) => quote.status === "pending_review" && !isExpired(quote)).map((quote) => safeQuote(quote, config)) });
      }
      const quoteMatch = /^\/hub\/api\/x402\/quotes\/([A-Za-z0-9_-]{20,80})$/.exec(pathname);
      if (request.method === "GET" && quoteMatch) return reply(response, 200, { quote: safeQuote(publicQuote(quoteMatch[1]), config) });
      const reviewMatch = /^\/hub\/api\/x402\/quotes\/([A-Za-z0-9_-]{20,80})\/review$/.exec(pathname);
      if (request.method === "POST" && reviewMatch) {
        if (!bearerMatches(request.headers.authorization, config.reviewToken)) return reply(response, 401, { error: "operator_auth_required" }, { "WWW-Authenticate": "Bearer" });
        const body = await bodyReader(request, 4096);
        if (!Object.hasOwn(body, "decision") || !["approve", "reject", "mark_fulfilled", "resolve_settlement"].includes(body.decision)) throw new HttpError(400, "review_decision_invalid");
        const allowedBodyKeys = body.decision === "resolve_settlement"
          ? ["decision", "order_id", "outcome", "transaction"]
          : ["decision"];
        if (Object.keys(body).some((key) => !allowedBodyKeys.includes(key))) throw new HttpError(400, "review_decision_invalid");
        const quote = publicQuote(reviewMatch[1]);
        if (body.decision === "resolve_settlement") {
          if (Object.keys(body).some((key) => !["decision", "order_id", "outcome", "transaction"].includes(key))) throw new HttpError(400, "settlement_resolution_invalid");
          if (typeof body.order_id !== "string" || !/^[A-Za-z0-9_-]{20,80}$/.test(body.order_id)
            || !["paid", "failed"].includes(body.outcome)) throw new HttpError(400, "settlement_resolution_invalid");
          const order = store.order(body.order_id);
          if (!order || order.quote_id !== quote.id || !["settling", "settlement_unknown"].includes(order.status)) return reply(response, 409, { error: "order_not_reconcilable" });
          if (body.outcome === "paid") {
            const transaction = publicText(body.transaction, "transaction", 160, "settlement_resolution_invalid");
            const updated = store.updateOrder(order.id, { status: "paid_pending_fulfillment", transaction, reconciled_at: new Date(now()).toISOString() });
            store.updateQuote(quote.id, { status: "paid" });
            return reply(response, 200, { order: safeOrder(updated), reconciliation: "paid" });
          }
          if (typeof body.transaction !== "string" || body.transaction.trim() !== "") throw new HttpError(400, "settlement_resolution_invalid");
          store.updateOrder(order.id, { status: "settlement_failed", reconciled_at: new Date(now()).toISOString() });
          store.updateQuote(quote.id, { status: "rejected", order_id: null, reconciled_at: new Date(now()).toISOString() });
          return reply(response, 200, { order_id: order.id, reconciliation: "failed", quote_status: "rejected" });
        }
        if (body.decision === "mark_fulfilled") {
          if (quote.status !== "paid" || !quote.order_id) return reply(response, 409, { error: "quote_not_fulfilled" });
          const order = store.order(quote.order_id);
          if (!order || order.status !== "paid_pending_fulfillment") return reply(response, 409, { error: "order_not_fulfillable" });
          const updated = store.updateOrder(order.id, { status: "fulfilled", fulfilled_at: new Date(now()).toISOString() });
          return reply(response, 200, { order: safeOrder(updated) });
        }
        if (quote.status !== "pending_review" || isExpired(quote)) return reply(response, 409, { error: "quote_not_reviewable" });
        if (busyQuotes.has(quote.id)) return reply(response, 409, { error: "quote_payment_in_progress" });
        const updated = store.updateQuote(quote.id, { status: body.decision === "approve" ? "approved" : "rejected", reviewed_at: new Date(now()).toISOString() });
        return reply(response, 200, { quote: safeQuote(updated, config), ...(updated.status === "approved" ? { payment_url: `${config.origin}/hub/api/x402/quotes/${updated.id}/purchase` } : {}) });
      }
      const purchaseMatch = /^\/hub\/api\/x402\/quotes\/([A-Za-z0-9_-]{20,80})\/purchase$/.exec(pathname);
      if (request.method === "GET" && purchaseMatch) return await handlePurchase(request, response, url, publicQuote(purchaseMatch[1]));
      const orderMatch = /^\/hub\/api\/x402\/orders\/([A-Za-z0-9_-]{20,80})$/.exec(pathname);
      if (request.method === "GET" && orderMatch) {
        const order = store.order(orderMatch[1]);
        if (!order) return reply(response, 404, { error: "order_not_found" });
        return reply(response, 200, { order: safeOrder(order) });
      }
      return reply(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof HttpError) return reply(response, error.status, { error: error.code });
      if (error?.code === "quote_invalid") return reply(response, 400, { error: "quote_invalid", field: error.detail?.split(":")[0] ?? null });
      log.warn?.(`x402 sponsor API: ${error?.code ?? "request_failed"}`);
      return reply(response, 503, { error: "sponsor_api_unavailable" });
    }
  };

  return Object.assign(handle, { initialize: () => paymentServer.initialize(), store });
}
