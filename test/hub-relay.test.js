import assert from "node:assert/strict";
import test from "node:test";

import { createServer, request as httpRequest } from "node:http";

import { decodeBase58 } from "../src/core/base58.js";
import { clientKey, createRpcRelay, MAX_BODY_BYTES, MAX_UPSTREAM_BYTES, RELAY_METHODS, RELAY_PROGRAMS, transactionPrograms } from "../src/hub/relay.js";
import { REWARDS_PROGRAM_ID as SHIPPED_REWARDS_PROGRAM_ID } from "../src/sinks/rewards.js";
import { createLiveServer } from "../src/live/server.js";

// The upstream URL carries a provider key: it must never appear in a response or a log line.
const UPSTREAM = "https://rpc.example.test/?api-key=SECRET-PROVIDER-KEY";

function fakeUpstream({ body = '{"jsonrpc":"2.0","id":1,"result":{"value":18446744073709551615}}', status = 200, type = "application/json", fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (fail) throw new Error(`connect ECONNREFUSED ${url}`);
    return new Response(body, { status, headers: { "content-type": type } });
  };
  return { calls, fetchImpl };
}

async function serve(relay, t) {
  const server = createServer((req, res) => relay(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  return server.address().port;
}

function post(port, payload, { headers = {}, method = "POST", raw } = {}) {
  return new Promise((resolve, reject) => {
    const body = raw ?? JSON.stringify(payload);
    const req = httpRequest({ host: "127.0.0.1", port, path: "/hub/rpc", method, headers: { "content-type": "application/json", ...headers } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(method === "GET" ? undefined : body);
  });
}

const call = (method, params = []) => ({ jsonrpc: "2.0", id: 1, method, params });

const ARENA = "5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** The rewards program belongs to a different sink; the hub relay must never carry it. */
const REWARDS = "5wAVbHfZCBrYPymk1FNeV4D69iZioUmZaiE4ki4qrqWD";
const concat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
/** A wire transaction calling `programs` in order (one empty signature slot), legacy or v0. */
function wireTx(programs, { v0 = false, programFromLookup = false } = {}) {
  const keys = [new Uint8Array(32).fill(7), ...programs.map((p) => decodeBase58(p))];
  const ixs = programs.map((_, i) => concat([programFromLookup ? keys.length : i + 1], [1, 0], [1, 2]));
  const message = concat(v0 ? [0x80] : [], [1, 0, programs.length], [keys.length], ...keys, new Uint8Array(32), [ixs.length], ...ixs, v0 ? [programFromLookup ? 1 : 0] : [], v0 && programFromLookup ? concat(new Uint8Array(32).fill(5), [0], [1, 0]) : []);
  return Buffer.from(concat([1], new Uint8Array(64), message)).toString("base64");
}
const send = (programs, opts) => call("sendTransaction", [wireTx(programs, opts), { encoding: "base64" }]);
const logs = () => {
  const lines = [];
  return { lines, warn: (m) => lines.push(m) };
};

test("relays an allowed read and returns the upstream body byte for byte (u64 values intact)", async (t) => {
  const up = fakeUpstream();
  const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl: up.fetchImpl }), t);
  const sliced = call("getAccountInfo", ["11111111111111111111111111111111", { encoding: "base64", dataSlice: { offset: 0, length: 165 } }]);
  const res = await post(port, sliced, { headers: { "cf-connecting-ip": "203.0.113.7" } });
  assert.equal(res.status, 200);
  assert.equal(res.text, '{"jsonrpc":"2.0","id":1,"result":{"value":18446744073709551615}}');
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(up.calls[0].body, sliced);
  assert.equal(up.calls[0].url, UPSTREAM);
});

test("passes searchTransactionHistory through unchanged", async (t) => {
  const up = fakeUpstream();
  const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl: up.fetchImpl }), t);
  await post(port, call("getSignatureStatuses", [["sig"], { searchTransactionHistory: true }]));
  assert.deepEqual(up.calls[0].body.params, [["sig"], { searchTransactionHistory: true }]);
});

test("refuses methods outside the allowlist, batches and malformed calls without calling upstream", async (t) => {
  const up = fakeUpstream();
  const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl: up.fetchImpl }), t);
  for (const method of ["getProgramAccounts", "requestAirdrop", "getBalance", "__proto__", "constructor"]) {
    const res = await post(port, call(method));
    assert.equal(res.status, 403, method);
    assert.equal(JSON.parse(res.text).error.code, -32601);
  }
  assert.equal((await post(port, [call("getGenesisHash")])).status, 400, "batch");
  assert.equal((await post(port, null, { raw: "{not json" })).status, 400, "parse error");
  assert.equal((await post(port, { method: "getGenesisHash" })).status, 400, "not JSON-RPC 2.0");
  assert.equal((await post(port, { jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: { a: 1 } })).status, 400, "params object");
  assert.equal((await post(port, call("getGenesisHash"), { headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await post(port, null, { method: "GET" })).status, 405);
  assert.equal((await post(port, null, { raw: JSON.stringify(call("sendTransaction", ["A".repeat(MAX_BODY_BYTES)])) })).status, 413);
  assert.equal(up.calls.length, 0);
});

test("rate-limits per CF-Connecting-IP, sends harder than reads, and never keys on X-Forwarded-For", async (t) => {
  let clock = 0;
  const up = fakeUpstream();
  const log = logs();
  const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl: up.fetchImpl, now: () => clock, limits: { read: 5, send: 2 }, log }), t);
  const as = (ip, extra = {}) => ({ headers: { "cf-connecting-ip": ip, ...extra } });
  assert.equal((await post(port, send([ARENA]), as("203.0.113.1"))).status, 200);
  assert.equal((await post(port, send([ARENA]), as("203.0.113.1"))).status, 200);
  const limited = await post(port, send([ARENA]), as("203.0.113.1"));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "60");
  assert.equal((await post(port, call("getGenesisHash"), as("203.0.113.1"))).status, 200, "reads have their own budget");
  assert.equal((await post(port, send([ARENA]), as("203.0.113.2"))).status, 200, "another client has its own bucket");
  // Spoofed X-Forwarded-For does not create a fresh bucket.
  assert.equal((await post(port, send([ARENA]), as("203.0.113.1", { "x-forwarded-for": "198.51.100.9" }))).status, 429);
  clock = 60_000;
  assert.equal((await post(port, send([ARENA]), as("203.0.113.1"))).status, 200, "the window resets");
  assert.equal(log.lines.length, 0);
});

test("without CF-Connecting-IP all requests share one bucket, and that is logged once per window", async (t) => {
  const up = fakeUpstream();
  const log = logs();
  const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl: up.fetchImpl, limits: { read: 2, send: 1 }, log }), t);
  assert.equal((await post(port, call("getGenesisHash"), { headers: { "x-forwarded-for": "198.51.100.1" } })).status, 200);
  assert.equal((await post(port, call("getGenesisHash"), { headers: { "x-forwarded-for": "198.51.100.2" } })).status, 200);
  assert.equal((await post(port, call("getGenesisHash"), { headers: { "x-forwarded-for": "198.51.100.3" } })).status, 429);
  assert.equal(log.lines.filter((l) => /shared rate-limit bucket/.test(l)).length, 1);
});

test("refuses a request whose socket peer is not loopback", () => {
  assert.equal(clientKey({ socket: { remoteAddress: "10.0.0.5" }, headers: { "cf-connecting-ip": "203.0.113.1" } }), null);
  assert.equal(clientKey({ socket: { remoteAddress: "100.111.36.55" }, headers: {} }), null);
  assert.equal(clientKey({ socket: { remoteAddress: "127.0.0.1" }, headers: { "cf-connecting-ip": "203.0.113.1" } }), "ip:203.0.113.1");
  assert.equal(clientKey({ socket: { remoteAddress: "::1" }, headers: { "cf-connecting-ip": "2001:db8::1" } }), "ip6:2001:db8:0:0::/64");
  assert.equal(clientKey({ socket: { remoteAddress: "127.0.0.1" }, headers: { "cf-connecting-ip": "not an ip; drop table" } }), "shared");
  assert.equal(clientKey({ socket: { remoteAddress: "127.0.0.1" }, headers: {} }), "shared");
});

test("upstream failures answer 502 with no trace of the upstream URL", async (t) => {
  for (const up of [fakeUpstream({ fail: true }), fakeUpstream({ status: 500 }), fakeUpstream({ type: "text/html", body: "<html>oops</html>" })]) {
    const log = logs();
    const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl: up.fetchImpl, log }), t);
    const res = await post(port, call("getLatestBlockhash"), { headers: { "cf-connecting-ip": "203.0.113.5" } });
    assert.equal(res.status, 502);
    assert.equal(JSON.parse(res.text).error.code, -32000);
    for (const text of [res.text, ...log.lines]) assert.equal(/SECRET-PROVIDER-KEY|rpc\.example\.test/.test(text), false, text);
  }
});

test("drops an upstream body past the byte cap and does not return it", async (t) => {
  let read = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (read >= 8_000) { controller.close(); return; }
      const chunk = new Uint8Array(1_000);
      read += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const fetchImpl = async (url, init) => {
    JSON.parse(init.body);
    return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
  };
  const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl, maxUpstreamBytes: 1_500 }), t);
  const res = await post(port, call("getGenesisHash"), { headers: { "cf-connecting-ip": "203.0.113.20" } });
  assert.equal(res.status, 502);
  assert.equal(JSON.parse(res.text).error.message, "upstream response too large");
  assert.equal(read < 8_000, true, `read ${read} bytes of an oversized body`);
  assert.equal(MAX_UPSTREAM_BYTES, 256 * 1024);
});

test("caps in-flight upstream reads per client before the minute window is used up", async (t) => {
  let started = 0;
  const release = [];
  const fetchImpl = async (url, init) => {
    JSON.parse(init.body);
    started += 1;
    await new Promise((resolve) => release.push(resolve));
    return new Response('{"jsonrpc":"2.0","id":1,"result":1}', { status: 200, headers: { "content-type": "application/json" } });
  };
  const port = await serve(createRpcRelay({
    upstream: UPSTREAM,
    fetchImpl,
    inflightLimits: { perKey: 1, global: 4 },
    limits: { read: 100, send: 10 },
  }), t);
  const headers = { "cf-connecting-ip": "203.0.113.21" };
  const first = post(port, call("getGenesisHash"), { headers });
  while (started < 1) await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await post(port, call("getGenesisHash"), { headers });
  assert.equal(second.status, 429);
  assert.equal(started, 1);
  release.forEach((resolve) => resolve());
  assert.equal((await first).status, 200);
});

test("a hung read does not consume the in-flight slot a send needs", async (t) => {
  let reads = 0;
  const release = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method !== "sendTransaction") {
      reads += 1;
      await new Promise((resolve) => release.push(resolve));
    }
    return new Response('{"jsonrpc":"2.0","id":1,"result":1}', { status: 200, headers: { "content-type": "application/json" } });
  };
  const port = await serve(createRpcRelay({
    upstream: UPSTREAM,
    fetchImpl,
    inflightLimits: { perKey: 1, global: 1 },
    limits: { read: 100, send: 10 },
  }), t);
  t.after(() => { release.forEach((resolve) => resolve()); });
  const headers = { "cf-connecting-ip": "203.0.113.24" };
  const hung = post(port, call("getGenesisHash"), { headers });
  const deadline = Date.now() + 2_000;
  while (reads < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(reads, 1, "the hung read reached upstream");
  const sent = await post(port, send([ARENA]), { headers });
  assert.equal(sent.status, 200, "sends keep their own budget while a read is in flight");
  release.forEach((resolve) => resolve());
  assert.equal((await hung).status, 200);
});

test("refuses getAccountInfo without a bounded dataSlice, and a token read that does not name one mint", async (t) => {
  const up = fakeUpstream();
  const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl: up.fetchImpl }), t);
  const at = { headers: { "cf-connecting-ip": "203.0.113.22" } };
  const pubkey = "11111111111111111111111111111111";
  for (const [label, params] of [
    ["no config", [pubkey]],
    ["encoding only", [pubkey, { encoding: "base64" }]],
    ["string encoding", [pubkey, "base64"]],
    ["empty dataSlice", [pubkey, { encoding: "base64", dataSlice: {} }]],
    ["zero length", [pubkey, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]],
    ["negative offset", [pubkey, { encoding: "base64", dataSlice: { offset: -1, length: 165 } }]],
    ["oversized length", [pubkey, { encoding: "base64", dataSlice: { offset: 0, length: 10_000 } }]],
  ]) {
    const res = await post(port, call("getAccountInfo", params), at);
    assert.equal(res.status, 403, label);
    assert.equal(JSON.parse(res.text).error.code, -32602, label);
  }
  const sliced = await post(port, call("getAccountInfo", [pubkey, { encoding: "base64", dataSlice: { offset: 0, length: 165 } }]), at);
  assert.equal(sliced.status, 200);
  const open = await post(port, call("getTokenAccountsByOwner", [pubkey, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "base64" }]), at);
  assert.equal(open.status, 403);
  const mint = "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy";
  const bounded = await post(port, call("getTokenAccountsByOwner", [pubkey, { mint }, { encoding: "base64" }]), at);
  assert.equal(bounded.status, 200);
  assert.equal(up.calls.length, 2, "only the sliced account read and the mint-scoped token read reach upstream");
});

test("needs an http(s) upstream and allows exactly the methods the hub uses", () => {
  for (const bad of [undefined, "", "ftp://x", "not a url"]) assert.throws(() => createRpcRelay({ upstream: bad }), /RADIOLAN_RPC_URL/);
  assert.deepEqual(Object.keys(RELAY_METHODS).sort(), ["getAccountInfo", "getBlockHeight", "getGenesisHash", "getLatestBlockhash", "getMinimumBalanceForRentExemption", "getSignatureStatuses", "getTokenAccountsByOwner", "sendTransaction", "simulateTransaction"]);
  assert.equal(RELAY_METHODS.sendTransaction, "send");
});

test("the station mounts the relay at POST /hub/rpc only when an upstream is set", async (t) => {
  const up = fakeUpstream();
  const live = createLiveServer({ oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, hubRpcUrl: UPSTREAM, hubRpcFetch: up.fetchImpl, log: logs() });
  t.after(() => live.close());
  const { port } = await live.listen({ port: 0 });
  const res = await post(port, call("getGenesisHash"), { headers: { "cf-connecting-ip": "203.0.113.9" } });
  assert.equal(res.status, 200);
  assert.equal(up.calls[0].body.method, "getGenesisHash");
  assert.equal((await post(port, call("getProgramAccounts"))).status, 403);

  const plain = createLiveServer({ oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, hubRpcUrl: "", log: logs() });
  t.after(() => plain.close());
  const other = await plain.listen({ port: 0 });
  assert.equal((await post(other.port, call("getGenesisHash"))).status, 405, "no upstream, no relay: the station stays GET-only");
  assert.throws(() => createLiveServer({ oauthToken: "", hubRpcUrl: "not a url", log: logs() }), /RADIOLAN_RPC_URL/);
});

test("reads the top-level programs of legacy and v0 transactions", () => {
  const programs = (b64) => transactionPrograms(Uint8Array.from(Buffer.from(b64, "base64")));
  assert.deepEqual(programs(wireTx([COMPUTE_BUDGET, ARENA])), [COMPUTE_BUDGET, ARENA]);
  assert.deepEqual(programs(wireTx([ARENA], { v0: true })), [ARENA]);
  assert.deepEqual(programs(wireTx([SYSTEM, TOKEN])), [SYSTEM, TOKEN]);
  assert.throws(() => programs(wireTx([ARENA], { v0: true, programFromLookup: true })), /static keys/);
  assert.throws(() => programs("AQ=="), /truncated/);
  assert.deepEqual(RELAY_PROGRAMS, [ARENA, COMPUTE_BUDGET]);
  assert.equal(RELAY_PROGRAMS.includes(ARENA), true, "the arena program is relayable");
  assert.equal(RELAY_PROGRAMS.includes(REWARDS), false, "the rewards program is not relayable");
  assert.equal(RELAY_PROGRAMS.includes(SHIPPED_REWARDS_PROGRAM_ID), false, "the shipped rewards program is not relayable");
  assert.equal(REWARDS !== ARENA, true);
});

test("relays only transactions that call the hub's programs, for send and simulate", async (t) => {
  const up = fakeUpstream();
  const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl: up.fetchImpl }), t);
  const at = { headers: { "cf-connecting-ip": "203.0.113.20" } };
  assert.equal((await post(port, send([COMPUTE_BUDGET, ARENA]), at)).status, 200);
  assert.equal((await post(port, call("simulateTransaction", [wireTx([ARENA], { v0: true }), { encoding: "base64", sigVerify: false }]), at)).status, 200);
  const relayed = up.calls.length;
  for (const [label, body] of [
    ["a System transfer", send([SYSTEM])],
    ["an arena call followed by a token transfer", send([ARENA, TOKEN])],
    ["a simulated foreign call", call("simulateTransaction", [wireTx([TOKEN]), { encoding: "base64" }])],
    ["a program loaded from a lookup table", send([ARENA], { v0: true, programFromLookup: true })],
    ["a ComputeBudget-only transaction", send([COMPUTE_BUDGET])],
    ["a ComputeBudget-only v0 transaction", call("simulateTransaction", [wireTx([COMPUTE_BUDGET, COMPUTE_BUDGET], { v0: true }), { encoding: "base64" }])],
    ["a transaction with no instructions", send([])],
    ["base58 encoding", call("sendTransaction", [wireTx([ARENA]), { encoding: "base58" }])],
    ["no encoding", call("sendTransaction", [wireTx([ARENA])])],
    ["garbage bytes", call("sendTransaction", ["AAEC", { encoding: "base64" }])],
  ]) {
    const res = await post(port, body, at);
    assert.equal(res.status, 403, label);
    assert.equal(JSON.parse(res.text).error.code, -32602, label);
  }
  assert.equal(up.calls.length, relayed, "refused transactions never reach the upstream");
});

test("the shipped program allowlist refuses a rewards-only transaction through the real relay", async (t) => {
  const up = fakeUpstream();
  // No overrides: the relay defaults to the shipped RELAY_PROGRAMS, not a test copy.
  const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl: up.fetchImpl }), t);
  const at = { headers: { "cf-connecting-ip": "203.0.113.23" } };
  for (const [tag, rewardsId] of [
    ["rewards", REWARDS],
    ["shipped-rewards program", SHIPPED_REWARDS_PROGRAM_ID],
  ]) {
    const cases = [
      [`send a ${tag}-only transaction`, send([rewardsId])],
      [`simulate a ${tag}-only transaction`, call("simulateTransaction", [wireTx([rewardsId]), { encoding: "base64" }])],
      [`a ${tag} call hidden behind the arena call`, send([ARENA, rewardsId])],
    ];
    for (const [label, payload] of cases) {
      const res = await post(port, payload, at);
      assert.equal(res.status, 403, label);
      assert.equal(JSON.parse(res.text).error.code, -32602, label);
      assert.match(JSON.parse(res.text).error.message, /program the hub does not use/, label);
    }
  }
  assert.equal(up.calls.length, 0, "a rewards transaction never reaches the upstream");
});

test("a global budget per window caps all clients together, logged once", async (t) => {
  const up = fakeUpstream();
  const log = logs();
  const port = await serve(createRpcRelay({ upstream: UPSTREAM, fetchImpl: up.fetchImpl, globalLimits: { read: 2, send: 1 }, log }), t);
  const from = (ip) => ({ headers: { "cf-connecting-ip": ip } });
  assert.equal((await post(port, call("getGenesisHash"), from("203.0.113.31"))).status, 200);
  assert.equal((await post(port, call("getGenesisHash"), from("203.0.113.32"))).status, 200);
  const busy = await post(port, call("getGenesisHash"), from("203.0.113.33"));
  assert.equal(busy.status, 503);
  assert.equal(busy.headers["retry-after"], "60");
  assert.equal((await post(port, call("getGenesisHash"), from("203.0.113.34"))).status, 503);
  assert.equal((await post(port, send([ARENA]), from("203.0.113.35"))).status, 200, "sends have their own global budget");
  assert.equal((await post(port, send([ARENA]), from("203.0.113.36"))).status, 503);
  assert.equal(log.lines.filter((l) => /global read budget/.test(l)).length, 1);
});

test("IPv6 clients are keyed by their /64, IPv4 by address", () => {
  const key = (ip) => clientKey({ socket: { remoteAddress: "127.0.0.1" }, headers: { "cf-connecting-ip": ip } });
  assert.equal(key("2001:db8:1:2:aaaa::1"), key("2001:db8:1:2:bbbb:cccc:dddd:9"));
  assert.equal(key("2001:db8:1:2::1"), "ip6:2001:db8:1:2::/64");
  assert.notEqual(key("2001:db8:1:2::1"), key("2001:db8:1:3::1"));
  assert.equal(key("2001:0db8:0001:0002:0:0:0:1"), "ip6:2001:db8:1:2::/64");
  assert.equal(key("::ffff:203.0.113.4"), "ip6:0:0:0:0::/64");
  assert.notEqual(key("203.0.113.4"), key("203.0.113.5"));
  assert.equal(key("2001:db8::zz"), "shared");
});
