import assert from "node:assert/strict";
import test from "node:test";

import { createTimelineIngest } from "../src/timeline/ingest.js";
import { createLiveServer } from "../src/live/server.js";

function fakeStore() {
  const s = { raw: [], minutes: [], gaps: [], culture: [], purges: 0 };
  return Object.assign(s, {
    appendRaw: (item) => s.raw.push(item),
    appendCulture: (r) => s.culture.push(r),
    appendMinute: (b) => s.minutes.push(b),
    appendGap: (g) => s.gaps.push(g),
    purgeRaw: () => {
      s.purges += 1;
      return [];
    },
  });
}

function harness({ login = "radiolanlive", stationLive = true } = {}) {
  let now = Date.parse("2026-10-01T20:00:05Z");
  const intervals = [];
  const sessions = [];
  const streamCalls = [];
  const live = [];
  const store = fakeStore();
  const fetchImpl = async (url) => {
    if (url.includes("/oauth2/validate")) return { ok: true, json: async () => ({ login, user_id: "1001" }) };
    if (url.includes("/helix/streams")) {
      const data = [{ user_login: "kaicenat", viewer_count: 1000, game_name: "Just Chatting", started_at: "2026-10-01T18:00:00Z" }, { user_login: "xqc", viewer_count: 500, game_name: "GTA V", started_at: "2026-10-01T17:00:00Z" }];
      if (stationLive) data.push({ user_login: "radiolanlive", viewer_count: 7, game_name: "Music", started_at: "2026-10-01T19:55:00Z" });
      streamCalls.push(url);
      return { ok: true, json: async () => ({ data }) };
    }
    if (url.includes("/helix/channels/followers")) return { ok: true, json: async () => ({ total: 21, data: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const ingest = createTimelineIngest({
    clientId: "cid",
    login: "radiolanlive",
    participantKey: "k".repeat(32),
    store,
    tracked: ["kaicenat", "xqc", "ninja"],
    onLive: (value) => live.push(value),
    fetchImpl,
    createEventSub: (options) => {
      const s = { options, started: false, stopped: false, token: options.accessToken, start() { s.started = true; }, stop() { s.stopped = true; }, setToken(t) { s.token = t; } };
      sessions.push(s);
      return s;
    },
    clock: () => now,
    every: (fn, ms) => {
      const t = { fn, ms };
      intervals.push(t);
      return t;
    },
    stopEvery: (t) => {
      t.stopped = true;
    },
    log: { warn() {} },
  });
  return { ingest, store, sessions, intervals, streamCalls, live, advance: (ms) => (now += ms), now: () => now };
}
const flush = () => new Promise((r) => setImmediate(r));

test("the first token resolves the broadcaster, starts EventSub, and later tokens only rotate it", async () => {
  const h = harness();
  await h.ingest.setToken("oauth:tok1");
  assert.equal(h.sessions.length, 1);
  assert.equal(h.sessions[0].options.broadcasterId, "1001");
  assert.equal(h.sessions[0].options.accessToken, "tok1");
  assert.equal(h.sessions[0].started, true);
  assert.deepEqual(h.intervals.map((t) => t.ms).sort((a, b) => a - b), [10_000, 60_000, 300_000, 3_600_000]);
  await h.ingest.setToken("tok2");
  assert.equal(h.sessions.length, 1);
  assert.equal(h.sessions[0].token, "tok2");
});

test("a token for another account does not start the ingest", async () => {
  const h = harness({ login: "someoneelse" });
  await assert.rejects(h.ingest.setToken("tok"), /not the station's/);
  assert.equal(h.sessions.length, 0);
});

test("EventSub events, IRC chat, Helix samples and gaps all land in the store as minutes", async () => {
  const h = harness();
  await h.ingest.setToken("tok");
  await flush();
  const { onEvent, onGap, onState } = h.sessions[0].options;
  onState({ connected: true });
  onEvent({ kind: "attention", event: { signal: "follow", observed_at: "2026-10-01T20:00:20Z", participant_id: "user-hmac:a", metadata: {} } });
  h.ingest.observeIrc({ signal: "chat", observed_at: "2026-10-01T20:00:30Z", participant_id: "user-hmac:b", metadata: {} });
  h.ingest.observeIrc({ signal: "presence", observed_at: "2026-10-01T20:00:31Z" }); // only chat is taken from IRC
  onGap({ start: "2026-10-01T20:00:40Z", end: "2026-10-01T20:00:45Z", reason: "socket_closed" });
  const tick = h.intervals.find((t) => t.ms === 10_000);
  for (let i = 0; i < 6; i += 1) {
    tick.fn();
    h.advance(10_000);
  }
  tick.fn();
  assert.equal(h.store.raw.filter((r) => r.kind !== "culture_sample").length, 2);
  assert.equal(h.store.raw.filter((r) => r.kind === "culture_sample").length, 1);
  assert.equal(h.store.gaps.length, 1);
  const [m] = h.store.minutes;
  assert.equal(m.minute, "2026-10-01T20:00Z");
  assert.deepEqual([m.follows, m.chat_messages, m.distinct_chatters, m.viewers, m.live, m.followers_total, m.tracked_live, m.tracked_viewers], [1, 1, 1, 7, true, 21, 2, 1500]);
  h.ingest.stop();
  assert.equal(h.sessions[0].stopped, true);
  assert.ok(h.intervals.every((t) => t.stopped));
});

test("the room creates the timeline only with RADIO_LAN_TIMELINE, feeds it chat, and stops it", async () => {
  const calls = [];
  const fakeTimeline = () => ({ setToken: async (t) => calls.push(["token", t]), observeIrc: (e) => calls.push(["irc", e.signal]), stop: () => calls.push(["stop"]) });
  const off = createLiveServer({ oauthToken: null, enableTimeline: false, createTimelineImpl: () => { throw new Error("should not be created"); }, log: { warn() {}, info() {} } });
  await off.close();
  const on = createLiveServer({ oauthToken: null, enableTimeline: true, createTimelineImpl: fakeTimeline, createTimelineStoreImpl: () => ({}), log: { warn() {}, info() {} } });
  await on.close();
  assert.deepEqual(calls, [["stop"]]);
});

test("one Helix call a minute covers the station and every tracked streamer; live state reaches the room", async () => {
  const h = harness();
  await h.ingest.setToken("tok");
  await flush();
  assert.equal(h.streamCalls.length, 1);
  const query = new URL(h.streamCalls[0]).searchParams.getAll("user_login");
  assert.deepEqual(query, ["radiolanlive", "kaicenat", "xqc", "ninja"]);
  assert.deepEqual(h.live, [true]);
  const sample = h.store.raw.find((r) => r.kind === "culture_sample");
  assert.deepEqual(sample.rows.map((r) => [r.login, r.is_live, r.viewer_count]), [["kaicenat", true, 1000], ["xqc", true, 500], ["ninja", false, null]]);
  // stream.online / stream.offline from EventSub update the room immediately.
  const { onEvent } = h.sessions[0].options;
  onEvent({ kind: "channel", event: { kind: "stream_offline", observed_at: "2026-10-01T20:00:30Z", totals: {} } });
  onEvent({ kind: "channel", event: { kind: "stream_online", observed_at: "2026-10-01T20:00:40Z", totals: {} } });
  assert.deepEqual(h.live, [true, false, true]);
});

test("an offline station is reported offline, and culture rolls up per streamer per hour", async () => {
  const h = harness({ stationLive: false });
  await h.ingest.setToken("tok");
  await flush();
  assert.deepEqual(h.live, [false]);
  const sample = h.intervals.find((t) => t.ms === 60_000);
  for (let i = 0; i < 3; i += 1) {
    h.advance(60_000);
    sample.fn();
    await flush();
  }
  h.advance(3_600_000);
  h.intervals.find((t) => t.ms === 10_000).fn();
  const k = h.store.culture.find((r) => r.login === "kaicenat");
  assert.deepEqual([k.hour, k.minutes_live, k.avg_viewers, k.peak_viewers, k.sessions, k.top_category], ["2026-10-01T20:00Z", 4, 1000, 1000, 1, "Just Chatting"]);
  const n = h.store.culture.find((r) => r.login === "ninja");
  assert.deepEqual([n.minutes_live, n.avg_viewers, n.sampled_minutes], [0, null, 4]);
});

test("a failing raw purge or gap write is logged and does not throw out of the timer", async () => {
  const h = harness();
  h.store.purgeRaw = () => { throw Object.assign(new Error("disk"), { code: "EIO" }); };
  h.store.appendGap = () => { throw Object.assign(new Error("disk"), { code: "EIO" }); };
  await assert.doesNotReject(h.ingest.setToken("oauth:tok1"), "the start-up purge does not throw");
  for (const t of h.intervals) assert.doesNotThrow(() => t.fn(), `interval ${t.ms}`);
  assert.doesNotThrow(() => h.sessions[0].options.onGap({ from: "a", to: "b", reason: "x" }));
});
