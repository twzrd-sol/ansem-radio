import assert from "node:assert/strict";
import test from "node:test";

import { createLiveServer } from "../src/live/server.js";
import { twitchBoard } from "./twitch-fixtures.js";

const board = () => twitchBoard();

test("board and dry-run chorus reach the room snapshot and SSE without sending or leaking", async (t) => {
  let fetches = 0;
  const live = createLiveServer({
    oauthToken: "",
    enableBoard: true,
    boardFetch: async () => { fetches += 1; return board(); },
    boardIntervalMs: 3_600_000,
    enableChorus: true,
    chorusSend: false,
    chorusRows: 1,
    chorusGapMs: 1,
  });
  t.after(() => live.close());
  const address = await live.listen({ port: 0 });
  // Chorus runs off the board event; wait for its four lines.
  for (let i = 0; i < 50 && live.snapshot().takes.length < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const snapshot = live.snapshot();
  assert.equal(fetches, 1);
  assert.equal(snapshot.board.board.rows.length, 2);
  assert.equal(snapshot.board.board.rows[0].viewer_count, 41250);
  assert.equal(snapshot.takes.length, 4);
  assert.ok(snapshot.takes.every((take) => take.sent === false && take.reason === "send_disabled"));
  assert.ok(snapshot.takes.every((take) => take.text.includes("(AI agent)")));
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes("http"), false);
  assert.equal(/kalshi|polymarket|price/i.test(json), false);

  const response = await fetch(`http://${address.host}:${address.port}/live/events`);
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: snapshot/);
  assert.match(first, /"takes":\[/);
  assert.match(first, /watching/);
  await reader.cancel();
});

test("board disabled leaves the room exactly as before", async (t) => {
  const live = createLiveServer({ oauthToken: "", enableBoard: false, enableChorus: true });
  t.after(() => live.close());
  await live.listen({ port: 0 });
  assert.equal(live.snapshot().board, null);
  assert.deepEqual(live.snapshot().takes, []);
});

test("chorus send requires both the flag and an IRC session that allows sending", async (t) => {
  let sessionOptions;
  const live = createLiveServer({
    oauthToken: "runtime-secret",
    refreshToken: "",
    clientId: "",
    createIrcSession: (options) => {
      sessionOptions = options;
      return { start() {}, stop() {}, allowSend: false, say: () => ({ sent: false, reason: "send_disabled" }) };
    },
    enableBoard: true,
    boardFetch: async () => board(),
    boardIntervalMs: 3_600_000,
    enableChorus: true,
    chorusSend: true,
    chorusRows: 1,
    chorusGapMs: 1,
  });
  t.after(() => live.close());
  await live.listen({ port: 0 });
  for (let i = 0; i < 50 && live.snapshot().takes.length < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(sessionOptions.allowSend, true, "the flag asks the session to allow sending");
  assert.ok(live.snapshot().takes.every((take) => take.sent === false), "but a session that refuses sending wins");
});

test("the board source is always the Twitch fetch", async (t) => {
  const seen = [];
  const live = createLiveServer({
    oauthToken: "",
    enableBoard: true,
    createBoardFeed: ({ fetchBoard }) => {
      seen.push(fetchBoard.name);
      return { start: async () => {}, stop() {}, snapshot: () => ({ board: null, updated_at: null, last_error: null, enabled: true }), subscribe: () => () => {} };
    },
  });
  t.after(() => live.close());
  await live.listen({ port: 0 });
  assert.deepEqual(seen, ["fetchTwitchBoard"]);
});

test("the twitch board reads with the most recently refreshed access token", async (t) => {
  let captured;
  const live = createLiveServer({
    oauthToken: "stale-token",
    refreshToken: "r",
    clientId: "cid",
    login: "radiolanlive",
    createIrcSession: () => ({ start() {}, stop() {} }),
    createTokenManager: ({ onToken }) => ({ start: async () => { await onToken("fresh-token"); }, stop() {} }),
    enableBoard: true,
    createBoardFeed: ({ fetchBoard }) => {
      captured = fetchBoard;
      return { start: async () => {}, stop() {}, snapshot: () => ({ board: null, updated_at: null, last_error: null, enabled: true }), subscribe: () => () => {} };
    },
  });
  t.after(() => live.close());
  await live.listen({ port: 0 });
  const headers = [];
  await captured({ fetchImpl: async (url, init) => { headers.push(init.headers); return { ok: true, status: 200, json: async () => ({ data: [] }) }; } });
  assert.equal(headers.length, 1);
  assert.equal(headers[0].Authorization, "Bearer fresh-token");
  assert.equal(headers[0]["Client-Id"], "cid");
});

test("the room page has an overlay mode that never loads the player embed, and attributes Twitch", async (t) => {
  const live = createLiveServer({ oauthToken: "", enableBoard: false });
  t.after(() => live.close());
  const address = await live.listen({ port: 0 });
  const html = await (await fetch(`http://${address.host}:${address.port}/public/live.html`)).text();
  assert.match(html, /has\("overlay"\)/);
  assert.match(html, /player\.remove\(\)/);
  assert.match(html, /Data: Twitch/);
});

async function chorusWithLive(stationLiveCheck) {
  const said = [];
  const live = createLiveServer({
    oauthToken: "runtime-secret",
    refreshToken: "",
    clientId: "",
    createIrcSession: () => ({ start() {}, stop() {}, allowSend: true, say: (text) => { said.push(text); return { sent: true }; } }),
    enableBoard: true,
    boardFetch: async () => board(),
    boardIntervalMs: 3_600_000,
    enableChorus: true,
    chorusSend: true,
    chorusRows: 1,
    chorusGapMs: 1,
    stationLiveCheck,
    liveCheckIntervalMs: 3_600_000,
  });
  await live.listen({ port: 0 });
  for (let i = 0; i < 50 && live.snapshot().takes.length < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const takes = live.snapshot().takes;
  await live.close();
  return { said, takes };
}

test("agents post only while the station is live; offline takes are kept and labelled", async () => {
  const offline = await chorusWithLive(async () => false);
  assert.equal(offline.said.length, 0);
  assert.equal(offline.takes.length, 4);
  assert.ok(offline.takes.every((take) => take.sent === false && take.reason === "station_offline"));

  const unknown = await chorusWithLive(async () => null);
  assert.equal(unknown.said.length, 0, "unknown live state never sends");

  const online = await chorusWithLive(async () => true);
  assert.equal(online.said.length, 4);
  assert.ok(online.takes.every((take) => take.sent === true));
});
