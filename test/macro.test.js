import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { request } from "node:http";

import { createMarketFeed } from "../src/live/market-feed.js";
import { createLiveServer } from "../src/live/server.js";
import { TRACKED_STREAMERS } from "../src/markets/twitch-metrics.js";
import { MACRO_NOTICE, MAX_SERIES_POINTS, downsample, isLoopbackHost, macroSnapshot, parseHours } from "../src/timeline/macro.js";
import { twitchBoard } from "./twitch-fixtures.js";

const NOW = Date.parse("2026-10-02T02:00:00Z");
const minuteIso = (ms) => new Date(ms).toISOString().slice(0, 16) + "Z";
const hourIso = (ms) => new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString().slice(0, 16) + "Z";

function minutes(count, { endAgo = 1, extra = {} } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const k = count - i + endAgo - 1;
    return { minute: minuteIso(NOW - k * 60_000), live: false, tracked_viewers: 1000 + i, tracked_live: 2, coverage: 1, followers_total: i % 5 === 0 ? 3 : null, ...extra };
  });
}

function fakeStore({ mins = [], culture = [], gaps = [] } = {}) {
  return {
    readMinutes: ({ since = 0 } = {}) => mins.filter((m) => Date.parse(m.minute) >= since),
    readCulture: ({ since = 0 } = {}) => culture.filter((r) => Date.parse(r.hour) >= since),
    readGaps: ({ since = 0 } = {}) => gaps.filter((g) => Date.parse(g.end) >= since),
  };
}

const rollup = (login, hoursAgo, extra = {}) => ({ hour: hourIso(NOW - hoursAgo * 3_600_000), login, sampled_minutes: 60, minutes_live: 60, avg_viewers: 100, peak_viewers: 150, viewer_minutes: 6000, sessions: 1, top_category: "Just Chatting", ...extra });

function get(port, path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("only the three preset windows are accepted, anything else falls back", () => {
  assert.deepEqual([6, 24, 168].map((h) => parseHours(String(h))), [6, 24, 168]);
  for (const bad of ["5", "abc", "-1", "10000", "", null, undefined, "6.5"]) assert.equal(parseHours(bad), 24, String(bad));
  assert.equal(parseHours("nope", 6), 6);
});

test("only a Host header naming this machine counts as loopback", () => {
  for (const ok of ["127.0.0.1:8787", "127.0.0.1", "localhost", "LOCALHOST:3000", "[::1]:8787"]) assert.equal(isLoopbackHost(ok), true, ok);
  for (const bad of [undefined, null, "", "evil.example", "127.0.0.1.evil.example", "localhost.evil.example:8787", "10.0.0.5:8787", "0.0.0.0:8787", "127.0.0.1@evil.example", "[::ffff:127.0.0.1]:8787", "studio-host:8787"]) {
    assert.equal(isLoopbackHost(bad), false, String(bad));
  }
});

test("downsampling caps the point count, keeps the peak and the worst coverage, and never invents points", () => {
  const rows = minutes(600).map((m, i) => ({ ...m, tracked_viewers: i === 301 ? 9999 : 100, coverage: i === 450 ? 0.4 : 1 }));
  const points = downsample(rows);
  assert.ok(points.length <= MAX_SERIES_POINTS && points.length > 100, `${points.length} points`);
  assert.equal(Math.max(...points.map((p) => p.tracked_viewers_peak)), 9999);
  assert.equal(Math.min(...points.map((p) => p.coverage)), 0.4);
  assert.equal(points[0].t, rows[0].minute);
  assert.equal(points.reduce((sum, p) => sum + p.minutes, 0), 600);
  assert.equal(downsample(minutes(10)).length, 10);
  assert.deepEqual(downsample([]), []);
});

test("the snapshot windows the data, ranks every tracked streamer and reads the board", () => {
  const mins = minutes(48 * 60);
  mins.push({ ...mins.at(-1), minute: minuteIso(NOW + 5 * 60_000) }); // a clock-skewed future row must not be charted
  const culture = [rollup("xqc", 2), rollup("xqc", 3), rollup("jynxzi", 2, { viewer_minutes: 3000 }), rollup("xqc", 40)];
  const board = { board: twitchBoard(), updated_at: "2026-10-02T01:59:30.000Z" };
  const six = macroSnapshot({ store: fakeStore({ mins, culture }), board: { board: board.board, updated_at: board.updated_at }, now: NOW, hours: 6 });
  assert.equal(six.enabled, true);
  assert.equal(six.hours, 6);
  assert.equal(six.recorded_minutes, 360);
  assert.ok(six.series.length <= MAX_SERIES_POINTS);
  assert.equal(six.series.reduce((n, p) => n + p.minutes, 0), 360, "the chart covers exactly the window");
  assert.equal(six.streamers.length, TRACKED_STREAMERS.length);
  assert.deepEqual(six.streamers.slice(0, 2).map((s) => [s.login, s.attention_share]), [["xqc", 0.8], ["jynxzi", 0.2]]);
  assert.equal(six.streamers.find((s) => s.login === "ninja").minutes_live, 0);
  assert.equal(six.hourly.length, 3, "the rollup from 40 hours ago is outside a 6 hour window");
  assert.deepEqual(six.live_now.map((r) => [r.login, r.viewer_count]), [["kaicenat", 41250], ["xqc", 30000]]);
  assert.equal(six.totals.tracked_viewers_now, 71250);
  assert.equal(six.board_updated_at, "2026-10-02T01:59:30.000Z");
  assert.equal(six.station.stale, false);
  assert.equal(six.station.followers_total, 3);
  const week = macroSnapshot({ store: fakeStore({ mins, culture }), now: NOW, hours: 168 });
  assert.equal(week.recorded_minutes, 48 * 60);
  assert.equal(week.series.reduce((n, p) => n + p.minutes, 0), 48 * 60);
  assert.equal(week.hourly.length, 4);
  assert.deepEqual(week.live_now, []);
  assert.equal(week.totals.tracked_viewers_now, null, "history must not stand in for current viewers");
});

test("a stale record is flagged and an empty store does not throw", () => {
  const old = macroSnapshot({ store: fakeStore({ mins: minutes(30, { endAgo: 20 }) }), now: NOW, hours: 24 });
  assert.equal(old.station.stale, true);
  const none = macroSnapshot({ store: fakeStore(), now: NOW, hours: 24 });
  assert.equal(none.recorded_minutes, 0);
  assert.equal(none.coverage, null);
  assert.deepEqual(none.series, []);
  assert.equal(none.station.stale, true);
  assert.equal(none.streamers.length, TRACKED_STREAMERS.length);
  assert.throws(() => macroSnapshot({}), TypeError);
});

test("the snapshot carries only named fields: no participant ids, no chat, nothing the store adds later", () => {
  const leak = { participant_id: "user-hmac:deadbeef", chatters: ["someone"], secret_extra: "nope", login: "someone" };
  const mins = minutes(120, { extra: leak });
  const culture = [rollup("xqc", 1, { participant_id: "user-hmac:cafe", secret_extra: "nope" })];
  const gaps = [{ start: minuteIso(NOW - 90 * 60_000), end: minuteIso(NOW - 89 * 60_000), reason: "socket_closed", secret_extra: "nope", token: "t0ken" }];
  const fixture = twitchBoard();
  const board = { board: { ...fixture, rows: fixture.rows.map((row) => ({ ...row, secret_extra: "nope" })) }, updated_at: null };
  const snapshot = macroSnapshot({ store: fakeStore({ mins, culture, gaps }), board, now: NOW, hours: 24 });
  const json = JSON.stringify(snapshot);
  for (const forbidden of ["user-hmac", "participant", "chatters", "secret_extra", "t0ken", "someone"]) assert.equal(json.includes(forbidden), false, forbidden);
  assert.deepEqual(Object.keys(snapshot).sort(), ["alerts", "anchors", "board_status", "board_updated_at", "coverage", "enabled", "gap_alert_min_seconds", "gaps", "generated_at", "hourly", "hours", "live_now", "notice", "readiness", "recorded_minutes", "series", "station", "streamers", "totals", "tracked_total", "window"]);
  assert.equal(snapshot.notice, MACRO_NOTICE);
  assert.ok(/Fan engagement/.test(MACRO_NOTICE) && /Data: Twitch/.test(MACRO_NOTICE), "the notice names what it is and its source");
  assert.equal(/internal|this machine only|do not publish/i.test(MACRO_NOTICE), false, "the served notice must not claim machine-only status");
  assert.deepEqual(snapshot.gaps.list, [{ start: gaps[0].start, end: gaps[0].end, reason: "socket_closed" }]);
});

test("board rows with a bad login are dropped and free text is trimmed", () => {
  const fixture = twitchBoard();
  const board = { ...fixture, rows: [{ ...fixture.rows[0], login: "Bad Login!" }, { ...fixture.rows[1], display_name: `  ${"x".repeat(200)}  `, game_name: "y".repeat(300) }] };
  const snapshot = macroSnapshot({ store: fakeStore({ mins: minutes(5) }), board: { board, updated_at: new Date(NOW).toISOString() }, now: NOW });
  assert.equal(snapshot.live_now.length, 1);
  assert.equal(snapshot.live_now[0].display_name.length, 60);
  assert.equal(snapshot.live_now[0].game_name.length, 80);
});

test("the room serves the macro page, state and export to this machine only, read only", async (t) => {
  const live = createLiveServer({
    oauthToken: "",
    enableBoard: true,
    createBoardFeed: (options) => createMarketFeed({ ...options, now: () => NOW }),
    boardFetch: async () => twitchBoard(),
    boardIntervalMs: 3_600_000,
    enableTimeline: true,
    createTimelineImpl: () => ({ setToken: async () => {}, observeIrc() {}, stop() {} }),
    createTimelineStoreImpl: () => fakeStore({ mins: minutes(200), culture: [rollup("xqc", 1)] }),
    macroClock: () => NOW,
    log: { warn() {}, info() {} },
  });
  t.after(() => live.close());
  const { port } = await live.listen({ port: 0 });

  const state = await get(port, "/macro/state?hours=6");
  assert.equal(state.status, 200);
  assert.match(state.headers["content-type"], /^application\/json/);
  assert.equal(state.headers["cache-control"], "no-store");
  const body = JSON.parse(state.body);
  assert.equal(body.enabled, true);
  assert.equal(body.hours, 6);
  assert.deepEqual(body.live_now.map((r) => r.login), ["kaicenat", "xqc"]);
  assert.equal(JSON.parse((await get(port, "/macro/state?hours=999")).body).hours, 24);

  const root = await get(port, "/");
  assert.deepEqual([root.status, root.headers.location], [302, "/public/live.html"]);
  const redirect = await get(port, "/macro");
  assert.deepEqual([redirect.status, redirect.headers.location], [302, "/public/macro.html"]);
  const page = await get(port, "/public/macro.html");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /^text\/html/);
  assert.equal(page.headers["cache-control"], "no-store");
  const stream = await get(port, "/stream?hours=6");
  assert.equal(stream.status, 200);
  assert.equal(stream.body, page.body, "the LAN link opens the same macro page");

  assert.equal((await get(port, "/macro/state", { headers: { Host: `localhost:${port}` } })).status, 200);
  for (const path of ["/stream", "/macro", "/macro/state", "/macro/export", "/public/macro.html", "/live/events"]) {
    for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1.evil.example", "0.0.0.0", "radio.example"]) {
      const res = await get(port, path, { headers: { Host: host } });
      assert.equal(res.status, 403, `${path} with Host ${host}`);
      assert.equal(res.body.includes("kaicenat"), false);
    }
  }
  const csv = await get(port, "/macro/export?hours=6");
  assert.equal(csv.status, 200);
  assert.match(csv.headers["content-type"], /^text\/csv/);
  assert.equal(csv.headers["cache-control"], "no-store");
  assert.equal(csv.headers["content-disposition"], 'attachment; filename="macro-6h.csv"');
  assert.match(csv.body, /percent_of_window_tracked_viewer_minutes/);
  assert.doesNotMatch(csv.body, /user-hmac|participant_id/);
  assert.equal((await get(port, "/macro/state", { method: "POST" })).status, 405);
  assert.equal((await get(port, "/macro/state", { method: "DELETE" })).status, 405);
});

test("with the timeline off the page is told so and nothing is read", async (t) => {
  const live = createLiveServer({ oauthToken: "", enableTimeline: false, createTimelineStoreImpl: () => { throw new Error("must not be created"); }, macroClock: () => NOW, log: { warn() {}, info() {} } });
  t.after(() => live.close());
  const { port } = await live.listen({ port: 0 });
  const res = await get(port, "/macro/state");
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(res.body)).sort(), ["enabled", "generated_at", "notice"]);
  assert.equal(JSON.parse(res.body).enabled, false);
  assert.equal((await get(port, "/macro/export")).status, 409);
});

test("a failing store answers with a generic error and no detail", async (t) => {
  const broken = { readMinutes() { throw new Error("/srv/someone/secret/path exploded"); }, readCulture: () => [], readGaps: () => [] };
  const live = createLiveServer({ oauthToken: "", enableTimeline: true, createTimelineImpl: () => ({ setToken: async () => {}, observeIrc() {}, stop() {} }), createTimelineStoreImpl: () => broken, macroClock: () => NOW, log: { warn() {}, info() {} } });
  t.after(() => live.close());
  const { port } = await live.listen({ port: 0 });
  const res = await get(port, "/macro/state");
  assert.equal(res.status, 500);
  assert.deepEqual(JSON.parse(res.body), { error: "macro_unavailable" });
  assert.equal(res.body.includes("secret"), false);
});

test("the page makes no outside requests, builds the DOM with text only, and has a table twin for every chart", () => {
  const html = readFileSync(new URL("../public/macro.html", import.meta.url), "utf8");
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
  assert.deepEqual(urls, ["http://www.w3.org/2000/svg"], "only the SVG namespace may appear");
  assert.match(html, /http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"/);
  assert.doesNotMatch(html, /<script[^>]*\ssrc=|<link[^>]*\shref=|<img|@import|url\(/);
  for (const banned of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"]) assert.equal(html.includes(banned), false, banned);
  for (const id of ["c-view", "t-view", "c-live", "t-live", "c-cov", "t-cov", "c-share", "t-share", "c-heat", "t-heat", "table-toggle"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.match(html, /Fan engagement\. Data: Twitch/);
  assert.match(html, /Streamer performance/);
  assert.doesNotMatch(html, /id="h-station"|id="meters"|renderStation/);
});
