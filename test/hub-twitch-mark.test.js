import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeConfig } from "../src/arena/season.js";
import { createHubApi } from "../src/hub/api.js";
import { actionId } from "../src/hub/points.js";
import { createHubStore } from "../src/hub/store.js";
import { resolveTwitchStreamEvent, twitchStreamEventId } from "../src/hub/twitch-mark.js";
import { createLiveServer } from "../src/live/server.js";
import { createTimelineStore } from "../src/timeline/store.js";

const START = Date.parse("2026-10-05T00:00:00Z") / 1000;
const NOW = START + 86400 + 3600;
const season = { network: "devnet", arena: "GwYjjFYcc4DV8hLE6bCAQiM3rjstGWNZ6p3icjR7ZnxU",
  creator: "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb", season: "1",
  arenaSeasonStart: START, arenaSeasonSeconds: 604800, startsAt: START, endsAt: START + 604800,
  claimDeadline: START + 1209600, asset: "SOL", budgetBaseUnits: "0",
  policy: { dailyCap: 20, weeklyCap: 200, weights: { question: 10, poll_response: 5, accepted_work: 20, twitch_mark: 10 } } };
const sample = (start = NOW - 300, patch = {}) => ({ login: "radiolanlive", is_live: true,
  started_at: new Date(start * 1000).toISOString(), at: new Date(NOW * 1000).toISOString(), viewer_count: 999, ...patch });
const bodyFor = (row = sample()) => ({ creator: row.login, eventId: twitchStreamEventId(row.login, row.started_at) });

function enable(t, value = "1") {
  const prior = process.env.RADIOLAN_POINTS_TWITCH;
  process.env.RADIOLAN_POINTS_TWITCH = value;
  t.after(() => { if (prior === undefined) delete process.env.RADIOLAN_POINTS_TWITCH; else process.env.RADIOLAN_POINTS_TWITCH = prior; });
}

async function setup(t, { config = season, write = 30, samples = [sample()], resolve, station = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hub-twitch-mark-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const timeline = createTimelineStore({ dir: join(dir, "timeline"), clock: () => NOW * 1000 });
  samples.forEach((s) => timeline.appendSample(s));
  let store = createHubStore({ dir });
  const registry = [{ slug: "radiolanlive", twitch: "radiolanlive", name: "Radio LAN", kind: "tracked", streamer: null, mint: null }];
  const api = () => createHubApi({ origins: "https://hub.example", store, season: config,
    registry, now: () => clock, log: { warn() {} }, limits: { read: 120, write, auth: 10 },
    resolveTwitchMarkEvent: resolve ?? ((query) => resolveTwitchStreamEvent(timeline, query)) });
  let clock = NOW;
  let handler = api();
  let port;
  if (station) {
    const live = createLiveServer({ oauthToken: "", hubOrigins: "https://hub.example", hubStore: store,
      hubSeason: config, hubRegistry: registry, hubMarket: { registry }, hubClock: () => NOW,
      enableBoard: false, enableChorus: false, enableRecord: false, enableTimeline: true,
      createTimelineStoreImpl: () => timeline,
      createTimelineImpl: () => ({ stop() {}, setToken: async () => {}, observeIrc() {} }), log: { info() {}, warn() {} } });
    ({ port } = await live.listen({ port: 0 }));
    t.after(() => live.close());
  } else {
    const server = createServer((req, res) => handler(req, res));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
    t.after(() => new Promise((r) => server.close(r)));
  }
  const call = (body = bodyFor(), headers = {}, path = "/hub/api/twitch-mark", method = "POST") => new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: { "content-type": "application/json", ...headers } }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
    });
    req.on("error", reject);
    req.end(method === "GET" ? undefined : JSON.stringify(body));
  });
  return { call, rows: () => store.submissions(), store: () => store, freeze: () => handler.finalizer.freeze(),
    timeline, advance: (seconds) => { clock += seconds; },
    restart: () => { store = createHubStore({ dir }); handler = api(); } };
}

test("only recorded stream events credit once, including concurrent retries and restart", async (t) => {
  enable(t);
  const s = await setup(t);
  const responses = await Promise.all(Array.from({ length: 8 }, () => s.call()));
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(responses.filter((r) => r.json.awarded === "10").length, 1);
  assert.equal(s.rows().length, 1);
  const row = s.rows()[0];
  assert.equal(row.occurredAt, NOW - 300);
  assert.deepEqual(row.detail, { eventId: bodyFor().eventId, observedAt: NOW, evidenceStrength: "provider_reported" });
  assert.equal(JSON.stringify(row).includes("999"), false, "no viewer count copied");
  s.restart();
  assert.deepEqual((await s.call()).json, { awarded: "0", points: "10", duplicate: true });
  assert.equal(s.rows().length, 1);
  assert.equal((await s.call(null, {}, "/hub/api/twitch-mark?creator=radiolanlive", "GET")).json.points, "10");
});

test("the station resolves marks from its own timeline rather than the request", async (t) => {
  enable(t);
  const s = await setup(t, { station: true });
  const result = await s.call();
  assert.equal(result.json.awarded, "10", JSON.stringify(result));
  assert.equal(s.rows().length, 1);
});

test("joined fans share one standing population; Twitch marks stay separate through close and restart", async (t) => {
  enable(t);
  const s = await setup(t);
  const fan = "a".repeat(64), idle = "b".repeat(64), unjoined = "c".repeat(64), orphan = "d".repeat(64);
  for (const id of [fan, idle, unjoined]) {
    s.store().createAccount({ id, credentials: [], joined: id === unjoined ? {} : { "1": START } });
  }
  const session = "s".repeat(43);
  s.store().createSession({ id: session, accountId: fan, csrf: "test", expiresAt: season.endsAt + 100 });
  for (const [id, accountId, source] of [["native", fan], ["unjoined", unjoined], ["orphan", orphan],
    ["provider", fan, "twitch"], ["other-provider", fan, "spotify"]]) {
    s.store().addSubmission({ id, accountId, season: "1", action: "question", source, occurredAt: NOW, status: "credited" });
  }
  assert.equal((await s.call()).json.points, "10", "a real stream event still gets its social score");
  const state = async () => (await s.call(null, { cookie: `hub_session=${session}` }, "/hub/api/state", "GET")).json;
  const open = await state();
  assert.equal(open.season.players, 2, "joined zero-point fans count as players");
  assert.deepEqual(open.season.board, [["fan-aaaaaaaa", "10"]]);
  assert.deepEqual(open.season.boardDetails.map((r) => r.handle), ["fan-aaaaaaaa"]);
  assert.equal(open.season.credited, 1);
  assert.equal(open.me.rank, 1);
  assert.equal(open.me.points, "10", "provider rows never inflate a fan's standing");
  s.restart();
  assert.deepEqual((await state()).season.board, open.season.board);
  assert.deepEqual((await s.call()).json, { awarded: "0", points: "10", duplicate: true });
  s.advance(season.endsAt - NOW);
  const closed = s.freeze();
  assert.equal(closed.players, open.season.players);
  assert.equal(closed.credited, 1);
  assert.equal(closed.totalPoints, "10");
  assert.deepEqual(closed.scores, [{ rank: 1, handle: "fan-aaaaaaaa", points: "10" }]);
  assert.equal(closed.signed, false);
  const recap = (await state()).lastSeason;
  assert.equal(recap.players, 2);
  assert.equal(recap.eligiblePoints, 10);
  assert.deepEqual(recap.top, [["fan-aaaaaaaa", 10]]);
  assert.deepEqual(recap.reward, { kind: "provisional" });
});

test("legacy timestamp-only marks stay in storage but cannot inflate the event-backed social score", async (t) => {
  enable(t);
  const s = await setup(t);
  const accountId = actionId(["radiolan-twitch-mark", "1", "radiolanlive"]);
  for (let i = 0; i < 3; i++) {
    s.store().addSubmission({ id: `legacy-${i}`, accountId, season: "1", action: "twitch_mark", source: "twitch",
      occurredAt: NOW - 600 + i, status: "credited", detail: {} });
  }
  const read = () => s.call(null, {}, "/hub/api/twitch-mark?creator=radiolanlive", "GET");
  assert.equal((await read()).json.points, "0");
  assert.deepEqual((await s.call()).json, { awarded: "10", points: "10", duplicate: false });
  s.restart();
  assert.equal((await read()).json.points, "10");
  assert.deepEqual((await s.call()).json, { awarded: "0", points: "10", duplicate: true });
  assert.equal(s.rows().length, 4, "history is preserved without manufacturing evidence for old rows");
});

test("flag off blocks both reads and writes without rows", async (t) => {
  enable(t, "0");
  const s = await setup(t);
  assert.equal((await s.call()).json.error, "twitch_points_off");
  assert.equal((await s.call(null, {}, "/hub/api/twitch-mark?creator=radiolanlive", "GET")).status, 409);
  assert.equal(s.rows().length, 0);
});

test("a bare name, fabricated event, untracked creator and extra inputs cannot credit", async (t) => {
  enable(t);
  const s = await setup(t);
  for (const body of [{ creator: "radiolanlive" }, { ...bodyFor(), eventId: "f".repeat(64) },
    { ...bodyFor(), creator: "unknown" }, ...["viewers", "minutes", "occurredAt", "event"].map((key) => ({ ...bodyFor(), [key]: 1 }))]) {
    assert.ok((await s.call(body)).status >= 400);
  }
  assert.equal(s.rows().length, 0);
});

test("missing timeline and offline, invalid, old or future observations fail closed", async (t) => {
  enable(t);
  for (const row of [sample(NOW - 300, { is_live: false }), sample(NOW - 300, { started_at: "invalid" }),
    sample(START - 1), sample(NOW + 1), sample(NOW - 300, { at: new Date((NOW + 1) * 1000).toISOString() }),
    sample(NOW - 300, { at: new Date((NOW - 301) * 1000).toISOString() })]) {
    const s = await setup(t, { samples: [row] });
    const body = Number.isFinite(Date.parse(row.started_at)) ? bodyFor(row) : bodyFor();
    assert.equal((await s.call(body)).json.error, "twitch_event_required");
    assert.equal(s.rows().length, 0);
  }
  const s = await setup(t, { resolve: () => resolveTwitchStreamEvent(null, {}) });
  assert.equal((await s.call()).status, 409);
});

test("proxies, foreign browser origins and non-loopback Hosts cannot write", async (t) => {
  enable(t);
  const s = await setup(t);
  for (const headers of [{ "cf-connecting-ip": "203.0.113.1" }, { "x-forwarded-for": "127.0.0.1" },
    { forwarded: "for=127.0.0.1" }, { origin: "https://hub.example" }, { host: "hub.example" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await s.call(bodyFor(), headers)).status, 403, JSON.stringify(headers));
  }
  assert.equal(s.rows().length, 0);
});

test("the write budget limits local intake and resets each minute", async (t) => {
  enable(t);
  const s = await setup(t, { write: 1 });
  assert.equal((await s.call()).status, 200);
  assert.equal((await s.call()).status, 429);
  assert.equal(s.rows().length, 1);
  s.advance(60);
  assert.equal((await s.call()).status, 200);
  assert.equal(s.rows().length, 1);
});

test("repeat samples are one occurrence and awards report the daily cap delta", async (t) => {
  enable(t);
  const rows = [sample(), sample(NOW - 300, { at: new Date((NOW - 1) * 1000).toISOString() }), sample(NOW - 200), sample(NOW - 100)];
  const s = await setup(t, { samples: rows });
  assert.equal((await s.call(bodyFor(rows[0]))).json.awarded, "10");
  assert.equal((await s.call(bodyFor(rows[1]))).json.awarded, "0");
  assert.equal((await s.call(bodyFor(rows[2]))).json.awarded, "10");
  assert.equal((await s.call(bodyFor(rows[3]))).json.awarded, "0");
  assert.equal(s.rows().length, 3);
});

test("weights must be explicit, closed seasons reject writes, and mainnet plans normalize", async (t) => {
  enable(t);
  const config = structuredClone(season);
  delete config.policy.weights.twitch_mark;
  const missing = await setup(t, { config });
  assert.equal((await missing.call()).json.error, "twitch_weight_required");
  const closed = await setup(t, { config: { ...season, arenaSeasonStart: START - 604800, startsAt: START - 604800, endsAt: START, claimDeadline: START + 604800 } });
  assert.equal((await closed.call()).json.error, "season_not_open");
  assert.equal(normalizeConfig({ ...season, network: "mainnet" }).network, "mainnet");
  assert.throws(() => normalizeConfig({ ...season, network: "testnet" }), /devnet or mainnet/);
  assert.equal(missing.rows().length + closed.rows().length, 0);
});
