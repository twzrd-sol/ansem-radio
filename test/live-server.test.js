import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BANNED_WORDS } from "../src/agents/brain.js";
import { createLedgerFeed } from "../src/live/ledger-feed.js";
import { createLiveServer, encodeSseEvent } from "../src/live/server.js";

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
  assert.match(page, /Free to watch, no wallet needed\./, "the default copy is unchanged");
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
  assert.match(page, /Watching is free\. Session fund activity is listed under Session fund\./);
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
