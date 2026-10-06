import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BANNED_WORDS } from "../src/agents/brain.js";
import { createLedgerFeed } from "../src/live/ledger-feed.js";
import { createLiveServer, encodeSseEvent } from "../src/live/server.js";

// A hub started here without its own store would otherwise read and write the machine's real hub data directory
// (the live station's accounts, submissions and frozen seasons). Point it at a throwaway one for this whole file.
process.env.RADIOLAN_HUB_DIR = mkdtempSync(join(tmpdir(), "live-server-hub-"));

const ledgerText = readFileSync(new URL("../docs/examples/ledger.example.json", import.meta.url), "utf8");

/** One read, or a failure after `ms`: a broken stream must fail the test, not hang it. */
function readWithin(reader, ms, pattern) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern}`)), ms);
    reader.read().then((chunk) => { clearTimeout(timer); resolve(chunk); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/** Keep reading an SSE stream until `pattern` appears, so a chunk boundary cannot fail a test. */
async function readUntil(reader, decoder, pattern, seen = "") {
  let text = seen;
  for (let reads = 0; reads < 10 && !pattern.test(text); reads += 1) {
    text += decoder.decode((await readWithin(reader, 2000, pattern)).value);
  }
  return text;
}

function twitchObservation(id = "one") {
  return {
    id: `twitch:${id}`,
    provider: "twitch",
    signal: "chat",
    observed_at: "2026-08-25T18:00:00Z",
    participant_id: "user-hash:private",
    metadata: { raw_text: "do not publish" },
  };
}

test("SSE encoding keeps one deterministic JSON payload", () => {
  assert.equal(
    encodeSseEvent("health", { connected: true }),
    "event: health\ndata: {\"connected\":true}\n\n",
  );
});

test("live room runs without OAuth and reports an honest offline state", async (t) => {
  let sessionCreated = false;
  const live = createLiveServer({
    oauthToken: "",
    createIrcSession: () => {
      sessionCreated = true;
      throw new Error("must not start");
    },
  });
  t.after(() => live.close());
  const address = await live.listen({ port: 0 });
  const origin = `http://${address.host}:${address.port}`;

  const page = await fetch(`${origin}/public/live.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /new EventSource\("\/live\/events"\)/);
  assert.equal(sessionCreated, false);
  assert.equal(live.snapshot().health.last_error, "oauth_not_configured");
});

test("x402 public routes are host-gated before loopback-only hub APIs", async (t) => {
  const seen = [];
  const live = createLiveServer({
    oauthToken: "",
    sponsorApi: async (request, response) => {
      seen.push(request.url);
      response.writeHead(200, { "Content-Type": "application/json" }).end('{"enabled":true}');
    },
  });
  t.after(() => live.close());
  const address = await live.listen({ port: 0 });
  const getWithHost = (path, host, method = "GET") => new Promise((resolve, reject) => {
    const request = http.request({ host: address.host, port: address.port, path, method, headers: { host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, json: () => JSON.parse(body) }));
    });
    request.on("error", reject);
    request.end();
  });

  let response = await getWithHost("/hub/api/x402/offer", "radiolan.live");
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), { enabled: true });
  response = await getWithHost("/hub/api/x402/offer", "twzrd.xyz");
  assert.equal(response.status, 403);
  assert.deepEqual(response.json(), { error: "host_not_allowed" });
  response = await getWithHost("/hub/rpc", "radiolan.live", "POST");
  assert.equal(response.status, 405);
  assert.deepEqual(seen, ["/hub/api/x402/offer"]);
});

test("unconfigured x402 route advertises disabled state and never issues a payment challenge", async (t) => {
  const live = createLiveServer({ oauthToken: "" });
  t.after(() => live.close());
  const address = await live.listen({ port: 0 });
  const call = (path, method = "GET", host = "radiolan.live") => new Promise((resolve, reject) => {
    const request = http.request({ host: address.host, port: address.port, path, method, headers: { host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) }));
    });
    request.on("error", reject);
    request.end();
  });
  const offer = await call("/hub/api/x402/offer");
  assert.equal(offer.status, 200);
  assert.equal(offer.body.status, "disabled");
  assert.equal(offer.body.payment_enabled, false);
  const quote = await call("/hub/api/x402/quotes", "POST");
  assert.equal(quote.status, 503);
  assert.equal(quote.body.error, "x402_disabled");
  assert.equal(quote.headers["payment-required"], undefined);
  assert.equal((await call("/hub/api/x402/offer", "GET", "twzrd.xyz")).status, 403);
});

test("authenticated IRC observations reach SSE without private fields", async (t) => {
  let options;
  let starts = 0;
  let stops = 0;
  const live = createLiveServer({
    oauthToken: "runtime-secret",
    refreshToken: "",
    clientId: "",
    login: "radiolanlive",
    createIrcSession: (value) => {
      options = value;
      return {
        start: () => { starts += 1; },
        stop: () => { stops += 1; },
      };
    },
  });
  t.after(() => live.close());
  const address = await live.listen({ port: 0 });
  const response = await fetch(`http://${address.host}:${address.port}/live/events`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value);
  assert.match(first, /event: snapshot/);
  assert.equal(starts, 1);
  assert.equal(live.snapshot().health.last_error, "twitch_refresh_not_configured");

  options.onEvent(twitchObservation());
  // observation + lan may arrive in one or two TCP chunks
  let body = decoder.decode((await reader.read()).value);
  if (!body.includes("event: lan")) {
    body += decoder.decode((await reader.read()).value);
  }
  assert.match(body, /event: observation/);
  assert.match(body, /Chat activity observed/);
  assert.match(body, /event: lan/);
  assert.match(body, /Observed 1 chat/);
  assert.equal(body.includes("private"), false);
  assert.equal(body.includes("do not publish"), false);
  assert.equal(body.includes("runtime-secret"), false);
  assert.equal(live.snapshot().lan.counts.chat, 1);

  await reader.cancel();
  await live.close();
  assert.equal(stops, 1);
});

test("managed auth rotates the receive-only IRC session onto refreshed credentials", async (t) => {
  let managerOptions;
  let managerStops = 0;
  const sessions = [];
  const persistTokens = async () => {};
  const live = createLiveServer({
    oauthToken: "old-secret",
    refreshToken: "refresh-secret",
    clientId: "client123",
    login: "radiolanlive",
    persistTokens,
    createTokenManager: (options) => {
      managerOptions = options;
      return {
        start: async () => options.onToken("validated-secret"),
        stop: () => { managerStops += 1; },
      };
    },
    createIrcSession: (options) => {
      const session = { token: options.oauthToken, options, starts: 0, stops: 0 };
      sessions.push(session);
      return {
        start: () => { session.starts += 1; },
        stop: () => { session.stops += 1; },
      };
    },
  });
  t.after(() => live.close());

  await live.listen({ port: 0 });
  assert.equal(managerOptions.onTokens, persistTokens);
  assert.deepEqual(sessions.map(({ token }) => token), ["validated-secret"]);
  sessions[0].options.onEvent(twitchObservation("before-refresh"));
  sessions[0].options.onState({ enabled: true, irc_connected: true, total_events: 1 });
  assert.equal(live.snapshot().health.total_events, 1);
  await managerOptions.onToken("rotated-secret");
  assert.deepEqual(sessions.map(({ token }) => token), ["validated-secret", "rotated-secret"]);
  assert.equal(sessions[0].stops, 1);
  assert.equal(sessions[1].starts, 1);
  sessions[1].options.onState({ enabled: true, irc_connected: true, total_events: 0 });
  assert.equal(live.snapshot().health.total_events, 1);

  await live.close();
  assert.equal(managerStops, 1);
});

test("without a ledger file the room shows no money surface", async (t) => {
  const live = createLiveServer({ oauthToken: "", ledgerPath: "" });
  t.after(() => live.close());
  const address = await live.listen({ port: 0 });
  const origin = `http://${address.host}:${address.port}`;
  assert.equal(live.snapshot().ledger, null);

  const response = await fetch(`${origin}/live/events`);
  const reader = response.body.getReader();
  const first = await readUntil(reader, new TextDecoder(), /"ledger":/);
  assert.match(first, /"ledger":null/);
  await reader.cancel();

  const page = await (await fetch(`${origin}/public/live.html`)).text();
  assert.match(page, /<section class="fund" id="fund" hidden>/, "the panel starts hidden");
  assert.match(page, /Nothing here pays anyone or takes anyone's money\./, "the default copy is unchanged");
});

test("a ledger file puts receipts in the snapshot and streams changes as receipt events", async (t) => {
  let text = ledgerText;
  let feed;
  const verifier = { verify: async () => ({ status: "verified", reason: null, block_time: null }) };
  const live = createLiveServer({
    oauthToken: "",
    ledgerPath: "/never/read/directly.json",
    createLedgerFeedImpl: (options) => {
      feed = createLedgerFeed({ ...options, readText: async () => text, verifier, schedule: () => 1, cancel: () => {} });
      return feed;
    },
  });
  t.after(() => live.close());
  const address = await live.listen({ port: 0 });
  assert.equal(live.snapshot().ledger.ledger.summary.remaining.usdc, "35.00", "receipts are up as soon as the room is");
  assert.equal(live.snapshot().ledger.ledger.receipts[0].verification.status, "pending", "checks land later, in the background");
  await feed.refresh();

  const response = await fetch(`http://${address.host}:${address.port}/live/events`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const first = await readUntil(reader, decoder, /"receipts":\[.*\]\}.*\n\n/s);
  assert.match(first, /event: snapshot/);
  assert.match(first, /Example Artist/);
  assert.match(first, /"status":"verified"/);

  const doc = JSON.parse(ledgerText);
  doc.receipts.push({ ...doc.receipts[2], amount: "5000000", to_label: "Second Artist", purpose: "Sticker pack" });
  text = JSON.stringify(doc);
  await feed.refresh();
  const body = await readUntil(reader, decoder, /Second Artist/);
  assert.match(body, /event: receipt/);
  assert.match(body, /"remaining":\{"amount":"30000000","usdc":"30\.00"\}/);
  for (const wire of [first, body]) {
    assert.equal(wire.includes("/never/read"), false, "the ledger path is never published");
    assert.equal(wire.includes("checked_at"), false);
    assert.equal(wire.includes("runtime-secret"), false);
  }
  await reader.cancel();
});

test("an unreadable ledger file leaves the room up and tells the operator", async (t) => {
  const logs = [];
  const live = createLiveServer({ oauthToken: "", ledgerPath: "/definitely/not/here.json", log: { warn: (line) => logs.push(line), info: () => {} } });
  t.after(() => live.close());
  const address = await live.listen({ port: 0 });
  const feed = live.snapshot().ledger;
  assert.equal(feed.ledger, null);
  assert.equal(feed.last_error, "ledger_unreadable");
  assert.deepEqual(logs, ["ledger: ledger_unreadable; no receipts are shown"]);
  const page = await fetch(`http://${address.host}:${address.port}/public/live.html`);
  assert.equal(page.status, 200);
});

test("a refused ledger save is reported once, by field, never by value or path, and recovery is announced", async (t) => {
  let text = ledgerText;
  let feed;
  const logs = [];
  const verifier = { verify: async () => ({ status: "verified", reason: null, block_time: null }) };
  const live = createLiveServer({
    oauthToken: "",
    ledgerPath: "/never/read/directly.json",
    log: { warn: (line) => logs.push(["warn", line]), info: (line) => logs.push(["info", line]) },
    createLedgerFeedImpl: (options) => {
      feed = createLedgerFeed({ ...options, readText: async () => text, verifier, schedule: () => 1, cancel: () => {} });
      return feed;
    },
  });
  t.after(() => live.close());
  await live.listen({ port: 0 });
  assert.deepEqual(logs, [], "a healthy ledger is silent");

  const doc = JSON.parse(ledgerText);
  doc.receipts[1].viewer_count = "SECRET-VALUE";
  text = JSON.stringify(doc);
  await feed.refresh();
  await feed.refresh();
  assert.deepEqual(logs, [["warn", "ledger: ledger_invalid (receipts[1].viewer_count: unknown field); still showing the last good ledger"]], "reported once, not every tick");

  text = ledgerText;
  await feed.refresh();
  assert.deepEqual(logs[1], ["info", "ledger: readable again"]);
  assert.equal(logs.length, 2);
  assert.equal(JSON.stringify(logs).includes("SECRET-VALUE"), false);
  assert.equal(JSON.stringify(logs).includes("/never/read"), false);
});

test("the session fund panel corrects the header and never uses the words the room never says", () => {
  const page = readFileSync(new URL("../public/live.html", import.meta.url), "utf8");
  assert.match(page, /Watching is free\. Money this room receives or spends is listed under Session fund\./);
  const markup = page.slice(page.indexOf('<section class="fund"'), page.indexOf('<section class="lan">'));
  const script = page.slice(page.indexOf("// Session fund:"), page.indexOf("const events = new EventSource"));
  assert.ok(markup.length > 100 && script.length > 100, "found the panel's markup and script");
  const banned = new RegExp(`\\b(${BANNED_WORDS.join("|")})\\b`, "i");
  assert.doesNotMatch(markup, banned);
  assert.doesNotMatch(script, banned);
});

test("a set but too-short participant key refuses to start; unset starts", () => {
  assert.throws(() => createLiveServer({ oauthToken: "", participantKey: "short" }), /at least 32/);
  const ok = createLiveServer({ oauthToken: "", participantKey: undefined });
  ok.close();
  const keyed = createLiveServer({ oauthToken: "", participantKey: "k".repeat(32) });
  keyed.close();
});

test("a malformed request target is a 400, not a crashed process", async (t) => {
  const live = createLiveServer({ oauthToken: "", createIrcSession: () => ({ start() {}, stop() {} }) });
  t.after(() => live.close());
  const { port } = await live.listen({ port: 0 });
  for (const target of ["http://[", "//%%"]) {
    const first = await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\n\r\n`));
      let out = ""; s.on("data", (d) => (out += d)); s.setTimeout(1500, () => s.destroy());
      s.on("close", () => resolve(out.split("\r\n")[0] || "(no response)"));
    });
    assert.equal(first, "HTTP/1.1 400 Bad Request", `target ${JSON.stringify(target)}`);
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/public/live.html`)).status, 200);
});

test("an unexpected handler error answers a generic 500 and the room keeps serving", async (t) => {
  const logs = [];
  const live = createLiveServer({
    oauthToken: "",
    createIrcSession: () => ({ start() {}, stop() {} }),
    sponsorApi: async () => {
      throw new Error("x402 internals: SECRET-DETAIL");
    },
    log: { debug: (line) => logs.push(line), info: () => {}, warn: () => {}, error: () => {} },
  });
  t.after(() => live.close());
  const { port } = await live.listen({ port: 0 });
  const raw = await new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => s.write("GET /hub/api/x402/offer HTTP/1.1\r\nHost: radiolan.live\r\nConnection: close\r\n\r\n"));
    let out = ""; s.on("data", (d) => (out += d)); s.setTimeout(1500, () => s.destroy());
    s.on("close", () => resolve(out));
  });
  assert.equal(raw.split("\r\n")[0], "HTTP/1.1 500 Internal Server Error");
  assert.ok(raw.includes('{"error":"request_failed"}'), "a generic error body, not handler internals");
  assert.equal(raw.includes("SECRET-DETAIL"), false, "no internals in the response");
  assert.equal(logs.some((line) => line.includes("SECRET-DETAIL")), false, "the log carries no detail either");
  const after = await fetch(`http://127.0.0.1:${port}/public/live.html`);
  assert.equal(after.status, 200, "one thrown handler must not take the room down");
});

test("every page module script static import resolves to a served route", async (t) => {
  const live = createLiveServer({ oauthToken: "", participantKey: "k".repeat(32), createIrcSession: () => ({ start() {}, stop() {} }) });
  t.after(() => live.close());
  const { port } = await live.listen({ port: 0 });
  const origin = `http://127.0.0.1:${port}`;
  const page = await (await fetch(`${origin}/public/live.html`)).text();
  const script = page.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(script, "live.html has a module script");
  // Only static module imports can break the page at load: one 404 and nothing on the page runs.
  const imports = [...script[1].matchAll(/import\s+{[^}]*}\s+from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const specifier of imports) {
    const url = new URL(specifier, `${origin}/public/`);
    const response = await fetch(url);
    assert.equal(response.status, 200, `static import ${specifier} must be served at ${url}`);
  }
});

test("RADIO_LAN_BACKING=off turns the market routes off while the rest of the hub answers", async (t) => {
  process.env.RADIO_LAN_BACKING = "off";
  try {
    const live = createLiveServer({
      oauthToken: "",
      participantKey: "k".repeat(32),
      createIrcSession: () => ({ start() {}, stop() {} }),
      hubOrigins: "https://radiolan.live",
      hubClock: () => Date.now(),
      hubMarket: {
        registry: [{ slug: "x", name: "X", kind: "featured", blurb: "", twitch: "x", streamer: null, mint: "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy" }],
        index: { listingArena: () => null, status: () => ({ network: "devnet", observedAt: 0, slot: 0, stale: false }), positionsOf: () => [], history: () => [] },
        board: () => null,
      },
    });
    t.after(() => live.close());
    const { port } = await live.listen({ port: 0 });
    const get = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).status;
    assert.equal(await get("/hub/api/market"), 404, "market routes are off");
    assert.equal(await get("/hub/api/season/1"), 404, "market-dependent history is off");
    const state = await (await fetch(`http://127.0.0.1:${port}/hub/api/state`)).json();
    assert.ok(state, "the rest of the hub still answers");
  } finally {
    delete process.env.RADIO_LAN_BACKING;
  }
});

test("the snapshot carries public tape events: whitelisted, deduplicated, identity-stripped", async (t) => {
  const raidRecord = {
    event: {
      id: "raid-1",
      observed_at: "2026-10-03T21:00:00Z",
      signal: "raid",
      kind: "raid_in",
      metadata: { viewers: 42 },
      // Not copied: participant identity and point totals.
      participants: [{ user_id: "42", user_login: "someone" }],
      source_broadcaster_id: "999",
      totals: { channel_points: 5_000 },
    },
  };
  const duplicateId = { event: { id: "raid-1", observed_at: "2026-10-03T21:00:01Z", signal: "raid" } };
  const predictionRecord = {
    event: {
      id: "pred-1",
      observed_at: "2026-10-03T21:05:00Z",
      kind: "prediction_lock",
      labels: { title: "Will LAN drop the beat?" },
      outcomes: [
        { label: "Yes", totals: { users: 3, channel_points: 900 } },
        { label: "No", totals: { users: 1, channel_points: 100 } },
      ],
    },
  };
  const unnamed = { event: { id: "chat-1", observed_at: "2026-10-03T21:06:00Z", kind: "channel_message" } };
  const live = createLiveServer({
    oauthToken: "",
    participantKey: "k".repeat(32),
    createIrcSession: () => ({ start() {}, stop() {} }),
    tapeRecords: [raidRecord, duplicateId, predictionRecord, unnamed],
  });
  t.after(() => live.close());
  const { port } = await live.listen({ port: 0 });
  const page = await (await fetch(`http://127.0.0.1:${port}/public/live.html`)).text();
  assert.equal((await fetch(`http://127.0.0.1:${port}/src/markets/tape.js`)).status, 200);
  const response = await fetch(`http://127.0.0.1:${port}/live/events`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const raw = await readUntil(reader, decoder, /"tape_events":\[.*\}\n\n/s);
  reader.cancel().catch(() => {});
  const frame = raw.match(/event: snapshot\ndata: (.+)\n\n/);
  assert.ok(frame);
  const snapshot = JSON.parse(frame[1]);
  const events = snapshot.tape_events ?? [];
  assert.deepEqual(events.map((e) => e.id), ["raid-1", "pred-1"], "first notice per id wins; unnamed kinds are dropped");
  const payload = JSON.stringify(events);
  for (const secret of ["someone", "user_id", "source_broadcaster_id", "channel_points"]) {
    assert.equal(payload.includes(secret), false, `tape never carries ${JSON.stringify(secret)}`);
  }
  const raid = events.find((e) => e.id === "raid-1");
  assert.deepEqual(raid, { id: "raid-1", observed_at: "2026-10-03T21:00:00Z", signal: "raid", kind: "raid_in", metadata: { viewers: 42 } });
  const prediction = events.find((e) => e.id === "pred-1");
  assert.deepEqual(prediction.labels, { title: "Will LAN drop the beat?" });
  assert.deepEqual(prediction.outcomes.map((o) => ({ label: o.label, users: o.totals.users })), [{ label: "Yes", users: 3 }, { label: "No", users: 1 }]);
  // A missing source (no timeline, nothing injected) reads as "not connected", never as an empty period.
  const quiet = createLiveServer({ oauthToken: "", participantKey: "k".repeat(32), createIrcSession: () => ({ start() {}, stop() {} }) });
  t.after(() => quiet.close());
  const { port: quietPort } = await quiet.listen({ port: 0 });
  const quietResponse = await fetch(`http://127.0.0.1:${quietPort}/live/events`);
  const quietReader = quietResponse.body.getReader();
  const quietRaw = await readUntil(quietReader, new TextDecoder(), /event: snapshot\ndata: .*\n\n/);
  quietReader.cancel().catch(() => {});
  const quietFrame = quietRaw.match(/event: snapshot\ndata: (.+)\n\n/);
  assert.deepEqual(JSON.parse(quietFrame[1]).tape_events ?? [], []);
});
