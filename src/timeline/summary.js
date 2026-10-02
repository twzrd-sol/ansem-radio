import { cultureTable } from "./culture.js";

/**
 * The macro view: a window of minute aggregates and gaps reduced to one summary,
 * plus distance to Twitch Affiliate over the rolling 30 days. Pure.
 */

/**
 * [VERIFY] Third-party sources report these as the May 2026 thresholds; Twitch's own FAQ
 * renders client-side and was not read. Check the creator dashboard's "Path to Affiliate".
 * Overridable with RADIO_LAN_AFFILIATE_THRESHOLDS (JSON).
 */
export const AFFILIATE_THRESHOLDS = Object.freeze({ followers: 25, broadcast_days: 4, broadcast_minutes: 240, avg_viewers: 3, window_days: 30 });

const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
const round = (value, places = 1) => (value === null ? null : Math.round(value * 10 ** places) / 10 ** places);

function liveStats(minutes) {
  const live = minutes.filter((m) => m.live === true);
  const withViewers = live.filter((m) => Number.isFinite(m.viewers));
  let sessions = 0;
  let previous = null;
  for (const m of minutes) {
    const t = Date.parse(m.minute);
    if (m.live === true && (previous === null || t - previous > 5 * 60_000)) sessions += 1;
    if (m.live === true) previous = t;
  }
  return {
    live_minutes: live.length,
    sessions,
    broadcast_days: new Set(live.map((m) => m.minute.slice(0, 10))).size,
    avg_viewers: withViewers.length ? round(sum(withViewers, "viewers") / withViewers.length) : null,
    peak_viewers: withViewers.length ? Math.max(...withViewers.map((m) => m.viewers)) : null,
  };
}

export function affiliateDistance(minutes, { now, thresholds = AFFILIATE_THRESHOLDS }) {
  const since = now - thresholds.window_days * 86_400_000;
  const window = minutes.filter((m) => Date.parse(m.minute) >= since);
  const stats = liveStats(window);
  const followerSamples = minutes.filter((m) => Number.isFinite(m.followers_total));
  const followers = followerSamples.length ? followerSamples.at(-1).followers_total : null;
  const have = { followers, broadcast_days: stats.broadcast_days, broadcast_minutes: stats.live_minutes, avg_viewers: stats.avg_viewers };
  const met = {};
  const remaining = {};
  for (const key of ["followers", "broadcast_days", "broadcast_minutes", "avg_viewers"]) {
    if (have[key] === null) {
      met[key] = null;
      remaining[key] = null;
    } else {
      met[key] = have[key] >= thresholds[key];
      remaining[key] = round(Math.max(0, thresholds[key] - have[key]));
    }
  }
  return { thresholds, have, met, remaining, all_met: Object.values(met).every((value) => value === true) };
}

export function summarize(minutes, gaps, { now, hours = 24, thresholds = AFFILIATE_THRESHOLDS, culture = [] } = {}) {
  const from = now - hours * 3_600_000;
  const rows = minutes.filter((m) => Date.parse(m.minute) >= from && Date.parse(m.minute) < now).sort((a, b) => a.minute.localeCompare(b.minute));
  const windowGaps = gaps.filter((g) => Date.parse(g.end) >= from && Date.parse(g.start) < now);
  const live = liveStats(rows);
  const liveRows = rows.filter((m) => m.live === true);
  const tracked = rows.filter((m) => Number.isFinite(m.tracked_viewers));
  return {
    window: { from: new Date(from).toISOString(), to: new Date(now).toISOString(), hours },
    recorded_minutes: rows.length,
    coverage: rows.length ? round(sum(rows, "coverage") / rows.length, 2) : null,
    gaps: { count: windowGaps.length, seconds: Math.round(windowGaps.reduce((t, g) => t + (Date.parse(g.end) - Date.parse(g.start)) / 1000, 0)) },
    stream: live,
    chat: {
      messages: sum(rows, "chat_messages"),
      per_live_minute: liveRows.length ? round(sum(liveRows, "chat_messages") / liveRows.length) : null,
      // Ids are discarded per minute, so a window total of distinct chatters cannot be computed.
      peak_distinct_chatters_in_a_minute: rows.length ? Math.max(0, ...rows.map((m) => m.distinct_chatters ?? 0)) : 0,
    },
    community: {
      follows: sum(rows, "follows"),
      subscriptions: sum(rows, "subscriptions"),
      gift_subs: sum(rows, "gift_subs"),
      bits: sum(rows, "bits"),
      raids_in: sum(rows, "raids_in"),
      raid_viewers_in: sum(rows, "raid_viewers_in"),
      raids_out: sum(rows, "raids_out"),
    },
    economy: {
      redemptions: sum(rows, "redemptions"),
      points_spent: sum(rows, "points_spent"),
      prediction_events: sum(rows, "prediction_events"),
      peak_prediction_points: rows.length ? Math.max(0, ...rows.map((m) => m.prediction_points ?? 0)) : 0,
      poll_events: sum(rows, "poll_events"),
      hype_train_max_level: rows.length ? Math.max(0, ...rows.map((m) => m.hype_train_level ?? 0)) : 0,
      ad_seconds: sum(rows, "ad_seconds"),
    },
    culture: {
      streamers: cultureTable(culture.filter((r) => Date.parse(r.hour) >= from && Date.parse(r.hour) < now)),
      avg_tracked_live: tracked.length ? round(sum(tracked, "tracked_live") / tracked.length) : null,
      avg_tracked_viewers: tracked.length ? Math.round(sum(tracked, "tracked_viewers") / tracked.length) : null,
      peak_tracked_viewers: tracked.length ? Math.max(...tracked.map((m) => m.tracked_viewers)) : null,
    },
    affiliate: affiliateDistance(minutes, { now, thresholds }),
  };
}

export function formatSummary(s) {
  const a = s.affiliate;
  const fmt = (v) => (v === null ? "unknown" : String(v));
  const line = (key, label) => `  ${label}: ${fmt(a.have[key])} of ${a.thresholds[key]}${a.met[key] === true ? " ✓" : a.met[key] === false ? `, ${a.remaining[key]} to go` : ""}`;
  return [
    `Timeline ${s.window.from} → ${s.window.to} (${s.window.hours} h), ${s.recorded_minutes} minutes recorded, coverage ${fmt(s.coverage)}, ${s.gaps.count} gaps (${s.gaps.seconds} s)`,
    `Stream: ${s.stream.sessions} sessions, ${s.stream.live_minutes} live minutes, average ${fmt(s.stream.avg_viewers)} viewers, peak ${fmt(s.stream.peak_viewers)}`,
    `Chat: ${s.chat.messages} messages, ${fmt(s.chat.per_live_minute)} per live minute, peak ${s.chat.peak_distinct_chatters_in_a_minute} distinct chatters in a minute`,
    `Community: ${s.community.follows} follows, ${s.community.subscriptions} subs + ${s.community.gift_subs} gifted, ${s.community.bits} bits, ${s.community.raids_in} raids in (${s.community.raid_viewers_in} viewers), ${s.community.raids_out} out`,
    `Economy: ${s.economy.redemptions} redemptions (${s.economy.points_spent} points), ${s.economy.prediction_events} prediction events (peak pool ${s.economy.peak_prediction_points}), ${s.economy.poll_events} poll events, hype train max level ${s.economy.hype_train_max_level}, ${s.economy.ad_seconds} s of ads`,
    `Culture (tracked streamers): average ${fmt(s.culture.avg_tracked_live)} live, ${fmt(s.culture.avg_tracked_viewers)} viewers, peak ${fmt(s.culture.peak_tracked_viewers)}`,
    ...s.culture.streamers.filter((t) => t.minutes_live > 0).map((t) => `  ${t.login}: ${Math.round(t.attention_share * 100)}% of attention, ${t.minutes_live} live min, average ${fmt(t.avg_viewers)}, peak ${fmt(t.peak_viewers)}, ${t.sessions} sessions${t.top_category ? `, mostly ${t.top_category}` : ""}`),
    `Distance to Affiliate (last ${a.thresholds.window_days} days; thresholds [VERIFY]):`,
    line("followers", "followers"),
    line("broadcast_days", "broadcast days"),
    line("broadcast_minutes", "broadcast minutes"),
    line("avg_viewers", "average viewers"),
  ].join("\n");
}
