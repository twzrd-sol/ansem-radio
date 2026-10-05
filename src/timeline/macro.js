/**
 * Snapshot for the /macro fan engagement chart. Reads the timeline store
 * and the room's board and returns plain JSON. Pure apart from the store reads.
 *
 * Every output field is picked by name, so a new field in the store cannot reach the page. It carries
 * counts and the tracked streamers' public stream rows only: never a participant id, never chat text.
 */

import { TRACKED_STREAMERS } from "../markets/twitch-metrics.js";
import { operationalContext } from "./macro-operations.js";
import { summarize } from "./summary.js";

export const MACRO_NOTICE = "Fan engagement view of Twitch data. Data: Twitch. Not sold, and never a payout input.";
export const MACRO_RANGES = Object.freeze([6, 24, 168]);
export const MAX_SERIES_POINTS = 240;
const MAX_GAPS = 50;
const STALE_AFTER_MS = 5 * 60_000;
const LOGIN = /^[a-z0-9_]{3,25}$/;

export function parseHours(value, fallback = 24) {
  const hours = Number(value);
  return MACRO_RANGES.includes(hours) ? hours : fallback;
}

const finite = (value) => (Number.isFinite(value) ? value : null);
const round = (value, places = 1) => (value === null ? null : Math.round(value * 10 ** places) / 10 ** places);
const text = (value, max) => {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
};

/** Per-minute aggregates reduced to at most `max` points: mean viewers and live count, worst coverage. */
export function downsample(minutes, max = MAX_SERIES_POINTS) {
  const size = Math.max(1, Math.ceil(minutes.length / max));
  const points = [];
  for (let i = 0; i < minutes.length; i += size) {
    const group = minutes.slice(i, i + size);
    const viewers = group.map((m) => finite(m.tracked_viewers)).filter((v) => v !== null);
    const live = group.map((m) => finite(m.tracked_live)).filter((v) => v !== null);
    const coverage = group.map((m) => finite(m.coverage)).filter((v) => v !== null);
    points.push({
      t: group[0].minute,
      minutes: group.length,
      tracked_viewers: viewers.length ? Math.round(viewers.reduce((a, b) => a + b, 0) / viewers.length) : null,
      tracked_viewers_peak: viewers.length ? Math.max(...viewers) : null,
      tracked_live: live.length ? round(live.reduce((a, b) => a + b, 0) / live.length) : null,
      coverage: coverage.length ? round(Math.min(...coverage), 2) : null,
    });
  }
  return points;
}

function liveNow(board) {
  const rows = board?.board?.rows;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && row.is_live !== false && LOGIN.test(String(row.login ?? "")))
    .map((row) => ({
      rank: finite(row.rank),
      login: row.login,
      display_name: text(row.display_name, 60) || row.login,
      viewer_count: finite(row.viewer_count),
      delta_viewers: finite(row.delta_viewers),
      game_name: text(row.game_name, 80) || null,
      minutes_live: finite(row.minutes_live),
      started_at: Number.isNaN(Date.parse(row.started_at)) ? null : new Date(row.started_at).toISOString(),
    }))
    .sort((a, b) => (b.viewer_count ?? 0) - (a.viewer_count ?? 0));
}

export function macroSnapshot({ store, board = null, now = Date.now(), hours = 24, anchor = null, tracked = TRACKED_STREAMERS } = {}) {
  if (!store) throw new TypeError("a timeline store is required");
  const lookbackMs = Math.max(hours, 30 * 24) * 3_600_000;
  const from = now - hours * 3_600_000;
  const allMinutes = store.readMinutes({ since: now - lookbackMs });
  const culture = store.readCulture({ since: from });
  const gaps = store.readGaps({ since: from });
  const summary = summarize(allMinutes, gaps, { now, hours, culture });

  const window = allMinutes
    .filter((m) => Date.parse(m.minute) >= from && Date.parse(m.minute) < now)
    .sort((a, b) => a.minute.localeCompare(b.minute));
  const series = downsample(window);

  const byLogin = new Map(summary.culture.streamers.map((s) => [s.login, s]));
  const streamers = [...new Set([...tracked.map((t) => String(t).toLowerCase()), ...byLogin.keys()])]
    .map((login) => {
      const s = byLogin.get(login);
      return {
        login,
        attention_share: s?.attention_share ?? 0,
        minutes_live: s?.minutes_live ?? 0,
        avg_viewers: s?.avg_viewers ?? null,
        peak_viewers: s?.peak_viewers ?? null,
        sessions: s?.sessions ?? 0,
        top_category: s?.top_category ?? null,
      };
    })
    .sort((a, b) => b.attention_share - a.attention_share || a.login.localeCompare(b.login));

  const hourly = culture
    .filter((r) => Date.parse(r.hour) >= from && Date.parse(r.hour) < now && LOGIN.test(String(r.login ?? "")))
    .map((r) => ({
      hour: r.hour,
      login: r.login,
      minutes_live: finite(r.minutes_live),
      avg_viewers: finite(r.avg_viewers),
      peak_viewers: finite(r.peak_viewers),
      viewer_minutes: finite(r.viewer_minutes),
      sessions: finite(r.sessions),
      top_category: text(r.top_category, 80) || null,
    }));

  const boardRows = liveNow(board);
  const latest = allMinutes.length ? allMinutes.reduce((a, b) => (a.minute > b.minute ? a : b)) : null;
  const latestMs = latest ? Date.parse(latest.minute) : null;
  const windowGaps = gaps.filter((g) => Date.parse(g.end) >= from && Date.parse(g.start) < now);
  // Followers are sampled every five minutes, so the newest minute usually has none.
  const followerRow = [...allMinutes].sort((a, b) => b.minute.localeCompare(a.minute)).find((m) => Number.isFinite(m.followers_total));

  const operations = operationalContext({ gaps: windowGaps, from, now,
    stationStale: latestMs === null || now - latestMs > STALE_AFTER_MS, board, anchor });
  const live = operations.board_status === "available" ? boardRows : [];
  return {
    ...operations,
    enabled: true,
    generated_at: new Date(now).toISOString(),
    notice: MACRO_NOTICE,
    window: summary.window,
    hours,
    recorded_minutes: summary.recorded_minutes,
    coverage: summary.coverage,
    gaps: {
      count: summary.gaps.count,
      seconds: summary.gaps.seconds,
      list: windowGaps.slice(-MAX_GAPS).map((g) => ({ start: g.start, end: g.end, reason: text(g.reason, 40) || null })),
    },
    tracked_total: new Set(tracked).size,
    totals: {
      tracked_viewers_now: operations.board_status === "available" ? live.reduce((sum, r) => sum + (r.viewer_count ?? 0), 0) : null,
      avg_tracked_live: summary.culture.avg_tracked_live,
      avg_tracked_viewers: summary.culture.avg_tracked_viewers,
      peak_tracked_viewers: summary.culture.peak_tracked_viewers,
    },
    streamers,
    hourly,
    series,
    live_now: live,
    board_updated_at: board?.updated_at ?? null,
    station: {
      live: latest ? latest.live ?? null : null,
      followers_total: followerRow ? followerRow.followers_total : null,
      latest_minute: latest ? latest.minute : null,
      stale: latestMs === null || now - latestMs > STALE_AFTER_MS,
      affiliate: summary.affiliate,
    },
  };
}
