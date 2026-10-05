import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMinuteAggregator, minuteOf } from "../src/timeline/aggregate.js";
import { createTimelineStore } from "../src/timeline/store.js";

const att = (signal, at, participant_id = null, metadata = {}) => ({ kind: "attention", event: { signal, observed_at: at, participant_id, metadata } });
const ch = (kind, at, totals = {}) => ({ kind: "channel", event: { kind, observed_at: at, totals } });

test("minutes are UTC and floor to the minute", () => {
  assert.equal(minuteOf("2026-10-01T20:00:59.999Z"), "2026-10-01T20:00Z");
  assert.equal(minuteOf(Date.parse("2026-10-01T20:01:00Z")), "2026-10-01T20:01Z");
  assert.throws(() => minuteOf("nope"), TypeError);
});

test("a minute counts chat, distinct keyed chatters and the economy, then forgets the ids", () => {
  const agg = createMinuteAggregator();
  const m = "2026-10-01T20:00";
  agg.sample(`${m}:01Z`, { liveNow: true, viewers: 7, followersTotal: 21, trackedLive: 3, trackedViewers: 90000 });
  agg.observe(att("chat", `${m}:05Z`, "user-hmac:a"));
  agg.observe(att("chat", `${m}:06Z`, "user-hmac:a"));
  agg.observe(att("chat", `${m}:07Z`, "user-hmac:b"));
  agg.observe(att("chat", `${m}:08Z`, null));
  agg.observe(att("follow", `${m}:10Z`, "user-hmac:c"));
  agg.observe(att("subscription", `${m}:11Z`, "user-hmac:c", { twitch_kind: "sub" }));
  agg.observe(att("subscription", `${m}:12Z`, null, { twitch_kind: "subgift", gifts: 5 }));
  agg.observe(att("cheer", `${m}:13Z`, "user-hmac:d", { bits: 250 }));
  agg.observe(att("raid", `${m}:14Z`, "user-hmac:e", { viewers: 42 }));
  agg.observe(att("redemption", `${m}:15Z`, "user-hmac:a", { cost: 500 }));
  agg.observe(ch("prediction_progress", `${m}:20Z`, { points_total: 9000 }));
  agg.observe(ch("prediction_lock", `${m}:30Z`, { points_total: 12000 }));
  agg.observe(ch("hype_train_progress", `${m}:31Z`, { level: 2 }));
  agg.observe(ch("ad_break", `${m}:40Z`, { duration_seconds: 90 }));
  agg.observe(ch("raid_out", `${m}:50Z`, { viewers: 9 }));
  for (let s = 0; s < 6; s += 1) agg.tick(`${m}:${String(s * 10).padStart(2, "0")}Z`, { connected: s !== 3, seconds: 10 });
  assert.deepEqual(agg.flush(`${m}:59Z`), []); // the minute is not finished yet
  const [bucket] = agg.flush("2026-10-01T20:01:00Z");
  assert.equal(bucket.minute, "2026-10-01T20:00Z");
  assert.deepEqual(
    [bucket.live, bucket.viewers, bucket.followers_total, bucket.tracked_live, bucket.chat_messages, bucket.distinct_chatters, bucket.follows, bucket.subscriptions, bucket.gift_subs, bucket.bits, bucket.raids_in, bucket.raid_viewers_in, bucket.redemptions, bucket.points_spent, bucket.prediction_events, bucket.prediction_points, bucket.hype_train_level, bucket.ad_seconds, bucket.raids_out, bucket.raid_viewers_out, bucket.coverage],
    [true, 7, 21, 3, 4, 2, 1, 1, 5, 250, 1, 42, 1, 500, 2, 12000, 2, 90, 1, 9, 0.83],
  );
  assert.equal(JSON.stringify(bucket).includes("user-hmac"), false);
  assert.equal(agg.pending(), 0);
});

test("stream state carries into later minutes through ticks", () => {
  const agg = createMinuteAggregator();
  agg.observe(ch("stream_online", "2026-10-01T20:00:10Z"));
  agg.tick("2026-10-01T20:01:10Z", { connected: true, seconds: 10 });
  agg.observe(ch("stream_offline", "2026-10-01T20:02:10Z"));
  agg.tick("2026-10-01T20:03:10Z", { connected: false, seconds: 10 });
  const out = agg.flush("2026-10-01T20:04:00Z");
  assert.deepEqual(out.map((b) => [b.minute.slice(11), b.live, b.coverage]), [["20:00Z", true, 0], ["20:01Z", true, 0.17], ["20:02Z", false, 0], ["20:03Z", false, 0]]);
});

test("the store keeps raw events 24 hours, minutes and gaps indefinitely, private files", () => {
  const dir = mkdtempSync(join(tmpdir(), "radiolan-timeline-"));
  try {
    let now = Date.parse("2026-10-01T20:30:00Z");
    const store = createTimelineStore({ dir, clock: () => now });
    store.appendRaw({ kind: "attention", event: { id: "x" } });
    store.appendMinute({ minute: "2026-10-01T20:29Z", chat_messages: 3 });
    store.appendGap({ start: "2026-10-01T20:00:00Z", end: "2026-10-01T20:05:00Z", reason: "socket_closed" });
    assert.deepEqual(readdirSync(join(dir, "raw")), ["2026-10-01T20.jsonl"]);
    assert.equal(statSync(join(dir, "raw", "2026-10-01T20.jsonl")).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(JSON.parse(readFileSync(join(dir, "raw", "2026-10-01T20.jsonl"), "utf8")).received_at, "2026-10-01T20:30:00.000Z");
    assert.equal(store.readRaw({ since: Date.parse("2026-10-01T20:00:00Z") })[0].event.id, "x");
    // 24h after the hour ended, the raw file goes; 1 minute before that, it stays.
    now = Date.parse("2026-10-02T20:59:00Z");
    assert.deepEqual(store.purgeRaw(), []);
    now = Date.parse("2026-10-02T21:00:00Z");
    assert.deepEqual(store.purgeRaw(), ["2026-10-01T20.jsonl"]);
    writeFileSync(join(dir, "raw", "notes.txt"), "kept");
    assert.deepEqual(store.purgeRaw(), []);
    assert.deepEqual(store.readMinutes({ since: Date.parse("2026-10-01T00:00:00Z") }).map((b) => b.chat_messages), [3]);
    assert.deepEqual(store.readMinutes({ since: Date.parse("2026-10-01T20:30:00Z") }), []);
    assert.equal(store.readGaps().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("culture rollups round-trip through the store and filter by hour", () => {
  const dir = mkdtempSync(join(tmpdir(), "radiolan-culture-"));
  try {
    const store = createTimelineStore({ dir, clock: () => Date.parse("2026-10-01T22:00:00Z") });
    store.appendCulture({ hour: "2026-10-01T20:00Z", login: "kaicenat", minutes_live: 60 });
    store.appendCulture({ hour: "2026-10-01T21:00Z", login: "kaicenat", minutes_live: 30 });
    assert.deepEqual(store.readCulture({ since: Date.parse("2026-10-01T21:00:00Z") }).map((r) => r.minutes_live), [30]);
    assert.equal(store.readCulture().length, 2);
    assert.equal(statSync(join(dir, "culture")).mode & 0o777, 0o700);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("raw reads enforce 24 hours even when the purge has not run", () => {
  const dir = mkdtempSync(join(tmpdir(), "radiolan-raw-read-"));
  try {
    let now = Date.parse("2026-10-01T20:29:59Z");
    const store = createTimelineStore({ dir, clock: () => now });
    store.appendRaw({ event: { id: "expired" } });
    now += 1000;
    store.appendRaw({ event: { id: "boundary" } });
    now += 1000;
    store.appendRaw({ event: { id: "recent" } });
    now = Date.parse("2026-10-02T20:30:00Z");
    assert.deepEqual(store.readRaw().map((r) => r.event.id), ["boundary", "recent"]);
    assert.deepEqual(store.readRaw({ since: 0 }).map((r) => r.event.id), ["boundary", "recent"]);
    assert.deepEqual(store.readRaw({ since: Date.parse("2026-10-01T20:30:01Z") }).map((r) => r.event.id), ["recent"]);
    assert.equal(readdirSync(join(dir, "raw")).length, 1, "reading does not delete retained files");
    rmSync(join(dir, "raw"), { recursive: true });
    assert.deepEqual(store.readRaw(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
