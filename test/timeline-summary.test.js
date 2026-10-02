import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../src/timeline/cli.js";
import { AFFILIATE_THRESHOLDS, affiliateDistance, formatSummary, summarize } from "../src/timeline/summary.js";

const NOW = Date.parse("2026-10-01T22:00:00Z");
function minute(iso, extra = {}) {
  return { minute: iso, live: null, viewers: null, followers_total: null, tracked_live: null, tracked_viewers: null, chat_messages: 0, distinct_chatters: 0, follows: 0, subscriptions: 0, gift_subs: 0, bits: 0, raids_in: 0, raid_viewers_in: 0, raids_out: 0, raid_viewers_out: 0, redemptions: 0, points_spent: 0, prediction_events: 0, prediction_points: 0, poll_events: 0, hype_train_level: 0, ad_seconds: 0, shoutouts_in: 0, shoutouts_out: 0, coverage: 1, ...extra };
}
function liveRun(startIso, count, viewers, extra = {}) {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) => minute(new Date(start + i * 60_000).toISOString().slice(0, 16) + "Z", { live: true, viewers, ...extra }));
}

test("a window of minutes becomes sessions, chat, community, economy and culture figures", () => {
  const rows = [
    ...liveRun("2026-10-01T20:00:00Z", 30, 4, { chat_messages: 2, distinct_chatters: 1, tracked_live: 3, tracked_viewers: 90_000 }),
    minute("2026-10-01T20:30Z", { live: false, coverage: 0.5 }),
    ...liveRun("2026-10-01T21:00:00Z", 10, 6, { follows: 1, redemptions: 1, points_spent: 500, prediction_events: 2, prediction_points: 9000, distinct_chatters: 3 }),
  ];
  const gaps = [{ start: "2026-10-01T20:30:00Z", end: "2026-10-01T20:30:30Z", reason: "socket_closed" }];
  const s = summarize(rows, gaps, { now: NOW, hours: 24 });
  assert.equal(s.recorded_minutes, 41);
  assert.equal(s.stream.sessions, 2);
  assert.equal(s.stream.live_minutes, 40);
  assert.equal(s.stream.avg_viewers, 4.5);
  assert.equal(s.stream.peak_viewers, 6);
  assert.equal(s.chat.messages, 60);
  assert.equal(s.chat.per_live_minute, 1.5);
  assert.equal(s.chat.peak_distinct_chatters_in_a_minute, 3);
  assert.deepEqual([s.community.follows, s.economy.redemptions, s.economy.points_spent, s.economy.prediction_events, s.economy.peak_prediction_points], [10, 10, 5000, 20, 9000]);
  assert.deepEqual([s.gaps.count, s.gaps.seconds], [1, 30]);
  assert.equal(s.coverage, 0.99);
  assert.equal(s.culture.avg_tracked_viewers, 90_000);
  assert.match(formatSummary(s), /2 sessions, 40 live minutes, average 4.5 viewers, peak 6/);
});

test("distance to Affiliate counts live days, minutes and average viewers over 30 days", () => {
  const rows = [
    ...liveRun("2026-09-20T20:00:00Z", 60, 2),
    ...liveRun("2026-09-25T20:00:00Z", 60, 3),
    ...liveRun("2026-10-01T20:00:00Z", 30, 5, { followers_total: 21 }),
    ...liveRun("2026-08-01T20:00:00Z", 500, 50), // outside the window
  ].sort((a, b) => a.minute.localeCompare(b.minute));
  const d = affiliateDistance(rows, { now: NOW });
  assert.deepEqual(d.have, { followers: 21, broadcast_days: 3, broadcast_minutes: 150, avg_viewers: 3 });
  assert.deepEqual(d.met, { followers: false, broadcast_days: false, broadcast_minutes: false, avg_viewers: true });
  assert.deepEqual(d.remaining, { followers: 4, broadcast_days: 1, broadcast_minutes: 90, avg_viewers: 0 });
  assert.equal(d.all_met, false);
  const unknown = affiliateDistance([], { now: NOW });
  assert.equal(unknown.have.followers, null);
  assert.equal(unknown.met.followers, null); // unknown is never "met"
  assert.equal(unknown.all_met, false);
  assert.equal(AFFILIATE_THRESHOLDS.window_days, 30);
});

test("the CLI prints a summary, JSON on request, and honours threshold overrides", () => {
  const store = { readMinutes: () => liveRun("2026-10-01T21:00:00Z", 10, 2, { followers_total: 30 }), readGaps: () => [] };
  const out = [];
  assert.equal(main(["summary", "--hours", "2"], { clock: () => NOW, print: (l) => out.push(l), store, env: {} }), 0);
  assert.match(out.at(-1), /followers: 30 of 25 ✓/);
  assert.equal(main(["summary", "--days", "1", "--json"], { clock: () => NOW, print: (l) => out.push(l), store, env: { RADIO_LAN_AFFILIATE_THRESHOLDS: '{"followers":50}' } }), 0);
  const parsed = JSON.parse(out.at(-1));
  assert.equal(parsed.window.hours, 24);
  assert.equal(parsed.affiliate.thresholds.followers, 50);
  assert.equal(parsed.affiliate.met.followers, false);
  assert.equal(main(["nope"], { print: (l) => out.push(l), store, env: {} }), 2);
  assert.equal(main(["summary", "--hours", "-1"], { print: (l) => out.push(l), store, env: {} }), 2);
  assert.equal(main(["summary"], { print: (l) => out.push(l), store, env: { RADIO_LAN_AFFILIATE_THRESHOLDS: "{bad" } }), 2);
});

test("the macro view ranks tracked streamers by attention from the hourly rollups in the window", () => {
  const culture = [
    { hour: "2026-10-01T20:00Z", login: "kaicenat", minutes_live: 60, viewer_minutes: 3_000_000, peak_viewers: 60000, sessions: 1, top_category: "Just Chatting" },
    { hour: "2026-10-01T20:00Z", login: "xqc", minutes_live: 60, viewer_minutes: 1_000_000, peak_viewers: 20000, sessions: 1, top_category: "GTA V" },
    { hour: "2026-10-01T20:00Z", login: "ninja", minutes_live: 0, viewer_minutes: 0, peak_viewers: null, sessions: 0, top_category: null },
    { hour: "2026-09-29T20:00Z", login: "xqc", minutes_live: 60, viewer_minutes: 9_000_000, peak_viewers: 99999, sessions: 1, top_category: "GTA V" }, // outside 24 h
  ];
  const s = summarize([], [], { now: NOW, hours: 24, culture });
  assert.deepEqual(s.culture.streamers.map((t) => [t.login, t.attention_share]), [["kaicenat", 0.75], ["xqc", 0.25], ["ninja", 0]]);
  const text = formatSummary(s);
  assert.match(text, /kaicenat: 75% of attention, 60 live min, average 50000, peak 60000, 1 sessions, mostly Just Chatting/);
  assert.equal(text.includes("ninja:"), false);
  const out = [];
  main(["summary"], { clock: () => NOW, print: (l) => out.push(l), env: {}, store: { readMinutes: () => [], readGaps: () => [], readCulture: () => culture } });
  assert.match(out[0], /xqc: 25% of attention/);
});
