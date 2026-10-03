/**
 * RPC relay for the hub (docs/HUB_FRONTEND_PLAN.md section 5). The page's chain reads and its signed-transaction
 * sends go through here, so the provider key stays on the server and every client is rate limited. Zero
 * dependencies; mounted at POST /hub/rpc by the station when RADIOLAN_RPC_URL is set.
 *
 * - An explicit method allowlist; anything else is refused before the upstream is called.
 * - Params pass through unchanged, including getSignatureStatuses' searchTransactionHistory.
 * - The upstream response passes through as text. It is never parsed and re-serialized, because RPC values can be
 *   u64 integers beyond JavaScript's safe range.
 * - The station binds loopback behind the edge (Cloudflare -> cloudflared -> Caddy -> station), so a request whose
 *   socket peer is not loopback is refused. Caddy does not trust incoming X-Forwarded-For and sets it to
 *   cloudflared's address, so the client key is CF-Connecting-IP, which Cloudflare overwrites at ingress. Without
 *   it, requests share one bucket. The leftmost X-Forwarded-For is never used.
 * - Transactions (simulate and send) are decoded. Every top-level instruction must call a program the hub uses
 *   (radiolan-arena, ComputeBudget) and at least one must call radiolan-arena, so a ComputeBudget-only transaction
 *   is refused too. The relay is not an open submission endpoint on the provider key.
 * - Limits are per client (IPv4 address, IPv6 /64) and global per window, separately for reads and sends.
 * - Requests are parsed and rebuilt from id, method and params only. None of the allowed methods takes an integer
 *   beyond JavaScript's safe range, so rebuilding cannot change a parameter.
 * - The upstream URL carries the provider key and is never logged or echoed.
 */

import { encodeBase58 } from "../core/base58.js";

/** Allowed methods and their rate-limit class. */
export const RELAY_METHODS = Object.freeze({
  getAccountInfo: "read",
  getBlockHeight: "read",
  getGenesisHash: "read",
  getLatestBlockhash: "read",
  getMinimumBalanceForRentExemption: "read",
  getSignatureStatuses: "read",
  getTokenAccountsByOwner: "read",
  simulateTransaction: "read",
  sendTransaction: "send",
});

/** A v0 transaction is at most 1,232 bytes (about 1.7 KB base64); 64 KB leaves room for any allowed call. */
export const MAX_BODY_BYTES = 64 * 1024;

/** The program every relayed transaction must call at least once. */
export const ARENA_PROGRAM = "5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf";

/** Top-level programs a relayed transaction may call: the hub only builds radiolan-arena instructions. */
export const RELAY_PROGRAMS = Object.freeze([
  ARENA_PROGRAM, // radiolan-arena
  "ComputeBudget111111111111111111111111111111",
]);

/** Read a compact-u16 (shortvec) at `at`; returns [value, next offset]. */
function shortvec(bytes, at) {
  let value = 0;
  for (let i = 0; i < 3; i += 1) {
    const b = bytes[at + i];
    if (b === undefined) throw new Error("truncated");
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return [value, at + i + 1];
  }
  throw new Error("bad length");
}

/**
 * The top-level program ids of a wire transaction (legacy or v0). Program ids must be static account keys; an index
 * into an address lookup table cannot be checked here and is refused.
 */
export function transactionPrograms(wire) {
  let [sigs, at] = shortvec(wire, 0);
  at += sigs * 64;
  if (at >= wire.length) throw new Error("truncated");
  const versioned = (wire[at] & 0x80) !== 0;
  if (versioned) {
    if ((wire[at] & 0x7f) !== 0) throw new Error("unsupported transaction version");
    at += 1;
  }
  at += 3; // header
  let keyCount;
  [keyCount, at] = shortvec(wire, at);
  const keys = [];
  for (let i = 0; i < keyCount; i += 1, at += 32) {
    if (at + 32 > wire.length) throw new Error("truncated");
    keys.push(encodeBase58(wire.subarray(at, at + 32)));
  }
  at += 32; // recent blockhash
  let ixCount;
  [ixCount, at] = shortvec(wire, at);
  const programs = [];
  for (let i = 0; i < ixCount; i += 1) {
    const index = wire[at];
    if (index === undefined) throw new Error("truncated");
    if (index >= keys.length) throw new Error("program id outside the static keys");
    programs.push(keys[index]);
    let n;
    [n, at] = shortvec(wire, at + 1);
    at += n; // account indexes
    [n, at] = shortvec(wire, at);
    at += n; // data
    if (at > wire.length) throw new Error("truncated");
  }
  return programs;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const IP_LIKE = /^[0-9A-Fa-f:.]{2,45}$/;

/** An IPv6 client can rotate freely within its /64, so IPv6 is keyed by its first four groups. */
function ipv6Prefix64(text) {
  const [head, tail = ""] = text.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = text.includes("::") ? (tail ? tail.split(":") : []) : [];
  if (right.at(-1)?.includes(".")) right.splice(-1, 1, "0", "0"); // an embedded IPv4 tail only fills the low groups
  if (left.at(-1)?.includes(".")) left.splice(-1, 1, "0", "0");
  const groups = text.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Reads at most `limit` bytes. Past it, the rest is discarded so the 413 can still be sent before closing. */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    request.on("data", (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new Error("too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!over) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

/** The client key for rate limiting, or null when the request did not come through the local edge. */
export function clientKey(request) {
  const peer = request.socket?.remoteAddress ?? "";
  if (!LOOPBACK.has(peer)) return null;
  const edge = request.headers["cf-connecting-ip"];
  if (typeof edge !== "string" || !IP_LIKE.test(edge.trim())) return "shared";
  const ip = edge.trim();
  if (!ip.includes(":")) return `ip:${ip}`;
  const prefix = ipv6Prefix64(ip);
  return prefix ? `ip6:${prefix}::/64` : "shared";
}

export function createRpcRelay({
  upstream,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  limits = { read: 120, send: 10 },
  // Across all clients per window, so many addresses together cannot drain the provider's credits.
  globalLimits = { read: 6_000, send: 300 },
  programs = RELAY_PROGRAMS,
  requiredProgram = ARENA_PROGRAM,
  windowMs = 60_000,
  timeoutMs = 10_000,
  log = console,
} = {}) {
  if (typeof upstream !== "string" || !/^https?:\/\/[^\s]+$/.test(upstream)) throw new Error("the RPC relay needs an http(s) upstream URL (RADIOLAN_RPC_URL)");
  const buckets = new Map();
  const allowedPrograms = new Set(programs);
  let globalWindow = { start: -Infinity, read: 0, send: 0, warned: false };
  let warnedShared = 0;

  function takeGlobal(kind) {
    const t = now();
    if (t - globalWindow.start >= windowMs) globalWindow = { start: t, read: 0, send: 0, warned: false };
    if (globalWindow[kind] >= globalLimits[kind]) {
      if (!globalWindow.warned) {
        globalWindow.warned = true;
        log.warn?.(`hub rpc relay: global ${kind} budget used up for this window`);
      }
      return false;
    }
    globalWindow[kind] += 1;
    return true;
  }

  /** A relayed transaction must be base64, call only the hub's programs, and call the arena at least once; returns an error message or null. */
  function checkTransaction(params) {
    const [encoded, config] = params ?? [];
    if (typeof encoded !== "string" || config?.encoding !== "base64") return "transactions must be base64-encoded";
    let wire;
    try {
      wire = Uint8Array.from(Buffer.from(encoded, "base64"));
      const called = transactionPrograms(wire);
      if (called.some((p) => !allowedPrograms.has(p))) return "the transaction calls a program the hub does not use";
      if (!called.includes(requiredProgram)) return "the transaction does not call the arena program";
      return null;
    } catch {
      return "the transaction could not be read";
    }
  }

  function take(key, kind) {
    const t = now();
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (t - b.start >= windowMs) buckets.delete(k);
    let bucket = buckets.get(key);
    if (!bucket || t - bucket.start >= windowMs) {
      bucket = { start: t, read: 0, send: 0 };
      buckets.set(key, bucket);
    }
    if (bucket[kind] >= limits[kind]) return false;
    bucket[kind] += 1;
    return true;
  }

  return async function handle(request, response) {
    const reply = (status, body, extra = {}) =>
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }).end(JSON.stringify(body));
    const key = clientKey(request);
    if (key === null) return reply(403, rpcError(null, -32600, "not through the edge"));
    if (request.method !== "POST") return reply(405, rpcError(null, -32600, "POST only"), { Allow: "POST" });
    if (!/^application\/json\b/i.test(request.headers["content-type"] ?? "")) return reply(415, rpcError(null, -32700, "JSON only"));
    let raw;
    try {
      raw = await readBody(request, MAX_BODY_BYTES);
    } catch {
      response.on("finish", () => request.destroy());
      return reply(413, rpcError(null, -32600, "request too large"), { Connection: "close" });
    }
    let call;
    try {
      call = JSON.parse(raw);
    } catch {
      return reply(400, rpcError(null, -32700, "parse error"));
    }
    if (Array.isArray(call)) return reply(400, rpcError(null, -32600, "batch requests are not relayed"));
    if (!call || typeof call !== "object" || call.jsonrpc !== "2.0" || typeof call.method !== "string") return reply(400, rpcError(call?.id, -32600, "invalid request"));
    const id = call.id ?? null;
    const kind = Object.hasOwn(RELAY_METHODS, call.method) ? RELAY_METHODS[call.method] : null;
    if (!kind) return reply(403, rpcError(id, -32601, "method not relayed"));
    if (call.params !== undefined && !Array.isArray(call.params)) return reply(400, rpcError(id, -32602, "params must be an array"));
    if (call.method === "sendTransaction" || call.method === "simulateTransaction") {
      const problem = checkTransaction(call.params);
      if (problem) return reply(403, rpcError(id, -32602, problem));
    }
    if (key === "shared" && now() - warnedShared >= windowMs) {
      warnedShared = now();
      log.warn?.("hub rpc relay: no CF-Connecting-IP on a loopback request; using one shared rate-limit bucket");
    }
    if (!take(key, kind)) return reply(429, rpcError(id, -32005, "rate limited"), { "Retry-After": String(Math.ceil(windowMs / 1000)) });
    if (!takeGlobal(kind)) return reply(503, rpcError(id, -32005, "busy, try again shortly"), { "Retry-After": String(Math.ceil(windowMs / 1000)) });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: call.method, params: call.params ?? [] }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok || !/^application\/json\b/i.test(res.headers.get("content-type") ?? "")) {
        log.warn?.(`hub rpc relay: upstream answered ${res.status} for ${call.method}`);
        return reply(502, rpcError(id, -32000, "upstream error"));
      }
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(text);
    } catch {
      log.warn?.(`hub rpc relay: upstream unreachable for ${call.method}`);
      reply(502, rpcError(id, -32000, "upstream unavailable"));
    } finally {
      clearTimeout(timer);
    }
  };
}
