// SPDX-License-Identifier: MIT
// The daily slate: who is big on Twitch right now, overall and by category, so a new visitor opens the Board and
// finds channels they already know, with the last week's daily peaks for a trend. Display only. Twitch figures here
// never reach points, a price or a payout. Public Helix reads (Get Streams, Get Top Games) are kept for a
// configurable retention, 7 days by default (operator decision 2026-10-03, docs/DECISION_20261003_RETENTION.md), and
// pruned after that; the file holds a login, display name, category, language and daily viewer peaks, never a title,
// chat or a Twitch user id. Twitch's Developer Agreement allows caching for 24 hours without its written
// permission; running longer is a recorded operator risk, and RADIOLAN_HUB_SLATE_RETENTION_HOURS=24 reverts it.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reservedSlug } from "./registry.js";

export const WINDOW_SECONDS = 86_400;
export const DEFAULT_RETENTION_SECONDS = 7 * 86_400;
const dayOf = (seconds) => Math.floor(seconds / 86_400);
const HELIX = "https://api.twitch.tv/helix";
const LOGIN = /^[a-z0-9_]{3,25}$/;
const text = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** The registry slug for a login: trailing underscores dropped, as the default registry does. */
export const slugOf = (login) => {
  const slug = login.replace(/_+$/, "") || login;
  return reservedSlug(slug) ? null : slug;
};

/** One observation per login from raw Helix stream rows, keeping the larger audience when a login repeats. */
export function observationsFrom(rows) {
  const byLogin = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const login = String(raw?.user_login ?? "").toLowerCase();
    const viewers = Math.floor(Number(raw?.viewer_count));
    if (raw?.type !== "live" || !LOGIN.test(login) || !Number.isFinite(viewers) || viewers < 0) continue;
    const next = { login, name: text(raw.user_name, 40) || login, game: text(raw.game_name, 60) || null, gameId: text(raw.game_id, 32) || null, language: /^[a-z]{2,3}$/.test(raw.language) ? raw.language : null, viewers };
    if (!byLogin.has(login) || byLogin.get(login).viewers < viewers) byLogin.set(login, next);
  }
  return [...byLogin.values()];
}

const CLIP_URL = /^https:\/\/(clips\.twitch\.tv|www\.twitch\.tv)\/[A-Za-z0-9_\-/]{1,200}$/;
/** One top clip per category from `[game, rawClip]` pairs: a link, a view count and the channel name; no title, no creator. */
export function clipsFrom(pairs) {
  const out = [];
  for (const [game, raw] of pairs) {
    const views = Math.floor(Number(raw?.view_count));
    const channel = String(raw?.broadcaster_name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
    if (typeof raw?.url !== "string" || !CLIP_URL.test(raw.url) || !Number.isFinite(views) || views < 0 || !channel || !game) continue;
    out.push({ game: text(game, 60), url: raw.url, views, channel });
  }
  return out;
}

/**
 * Overall top streams plus the top categories and a few streams in each. Three kinds of read, all public:
 * the unfiltered top 100, the top games, and the top streams of each of those games.
 */
export async function fetchSlateObservations({ fetchImpl = globalThis.fetch, clientId, token, categories = 8, perCategory = 10, now = () => Math.floor(Date.now() / 1000) } = {}) {
  const cleanToken = String(typeof token === "function" ? token() : token ?? "").replace(/^oauth:/i, "").trim();
  if (!clientId || !cleanToken) return { observations: [], clips: [], error: "twitch_credentials_missing" };
  const headers = { "Client-Id": clientId, Authorization: `Bearer ${cleanToken}`, accept: "application/json" };
  const get = async (path) => {
    const response = await fetchImpl(`${HELIX}${path}`, { headers, redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`status_${response.status}`);
    const body = await response.json();
    return Array.isArray(body?.data) ? body.data : [];
  };
  try {
    const top = await get("/streams?first=100");
    const games = (await get(`/games/top?first=${categories}`)).filter((g) => /^[0-9]{1,20}$/.test(String(g.id)));
    const slices = await Promise.all(games.map((g) => get(`/streams?first=${perCategory}&game_id=${g.id}`).catch(() => [])));
    // The most-viewed clip of the last day in each top category: a public Helix read, linked, never embedded or stored beyond 24 hours.
    const since = new Date(now() * 1000 - WINDOW_SECONDS * 1000).toISOString();
    const clipRows = await Promise.all(games.map((g) => get(`/clips?game_id=${g.id}&first=1&started_at=${encodeURIComponent(since)}`).then((rows) => [g.name, rows[0]]).catch(() => null)));
    return { observations: observationsFrom([...top, ...slices.flat()]), clips: clipsFrom(clipRows.filter(Boolean)), error: null };
  } catch (error) {
    return { observations: [], clips: [], error: String(error?.message ?? "fetch_failed").slice(0, 40) };
  }
}

/** Daily peaks for a row: its own buckets, or one bucket for a row that predates them. */
const daysOf = (r) => r.days ?? { [dayOf(r.seenAt)]: r.peak };

/**
 * The slate from window rows `{ login, name, game, language, days, now, seenAt }`. Pure. Ranked by today's UTC-day
 * peak, then the window peak; each streamer carries seven daily peaks (oldest first, null for a missing day).
 */
export function buildSlate(rows, { size = 30, categories = 8, perCategory = 5, at, freshSeconds = 1800, clips = [] }) {
  const today = dayOf(at);
  const clipOf = new Map(clips.map((c) => [c.game, { url: c.url, views: c.views, channel: c.channel }]));
  const live = (r) => at - r.seenAt <= freshSeconds;
  const prepared = rows.map((r) => {
    const days = daysOf(r);
    const week = Array.from({ length: 7 }, (_, i) => days[today - (6 - i)] ?? null);
    return { ...r, week, today: days[today] ?? 0, peak: Math.max(...Object.values(days), 0) };
  });
  const rank = (a, b) => b.today - a.today || b.peak - a.peak || a.login.localeCompare(b.login);
  const view = (r) => ({ login: r.login, slug: slugOf(r.login), name: r.name, game: r.game, language: r.language, peak: r.peak, today: r.today, week: r.week, live: live(r), viewers: live(r) ? r.now : null });
  const sorted = prepared.filter((r) => slugOf(r.login)).sort(rank);
  const byGame = new Map();
  for (const r of sorted) if (r.game) byGame.set(r.game, [...(byGame.get(r.game) ?? []), r]);
  const lanes = [...byGame.entries()]
    .map(([game, list]) => ({ game, total: list.reduce((n, r) => n + (r.today || r.peak), 0), list }))
    .sort((a, b) => b.total - a.total || a.game.localeCompare(b.game))
    .slice(0, categories)
    .map(({ game, list, total }) => ({
      game,
      streamers: list.slice(0, perCategory).map(view),
      channels: list.length,
      peakTotal: total,
      // Sum of the channels' daily peaks in this category: a trend, not a count of people.
      week: Array.from({ length: 7 }, (_, i) => (list.some((r) => r.week[i] !== null) ? list.reduce((n, r) => n + (r.week[i] ?? 0), 0) : null)),
      clip: clipOf.get(game) ?? null,
    }));
  const languages = {};
  for (const r of sorted.slice(0, size)) if (r.language) languages[r.language] = (languages[r.language] ?? 0) + 1;
  return { streamers: sorted.slice(0, size).map(view), categories: lanes, languages };
}

export function createSlateKeeper({ dir, fetchObservations, now = () => Math.floor(Date.now() / 1000), intervalMs = 900_000, size = 30, retentionSeconds = DEFAULT_RETENTION_SECONDS, log = console }) {
  if (!Number.isSafeInteger(retentionSeconds) || retentionSeconds < 3600 || retentionSeconds > 30 * 86_400) throw new TypeError("slate retention must be 1 hour to 30 days");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "slate.json");
  let rows = new Map();
  let clips = new Map();
  let updatedAt = null;
  let error = null;
  let timer = null;
  const prune = () => {
    const oldest = dayOf(now() - retentionSeconds);
    for (const [login, r] of rows) {
      for (const d of Object.keys(r.days ?? {})) if (Number(d) < oldest) delete r.days[d];
      if (now() - r.seenAt > retentionSeconds || (r.days && Object.keys(r.days).length === 0)) rows.delete(login);
    }
    for (const [game, c] of clips) if (now() - c.seenAt > WINDOW_SECONDS) clips.delete(game);
  };
  if (existsSync(path)) {
    try {
      const saved = JSON.parse(readFileSync(path, "utf8"));
      if (saved?.v === 1 && Array.isArray(saved.rows)) { rows = new Map(saved.rows.map((r) => [r.login, r])); clips = new Map((Array.isArray(saved.clips) ? saved.clips : []).map((c) => [c.game, c])); updatedAt = saved.updatedAt ?? null; }
    } catch { /* a corrupt window is rebuilt from the next read */ }
    prune();
  }
  const persist = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify({ v: 1, updatedAt, rows: [...rows.values()], clips: [...clips.values()] }), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  };
  const slate = () => {
    prune();
    const at = now();
    return { ...buildSlate([...rows.values()], { size, at, clips: [...clips.values()] }), retentionHours: Math.round(retentionSeconds / 3600), updatedAt, stale: updatedAt === null || at - updatedAt > intervalMs / 1000 * 3, label: `Data: Twitch. Public live figures, kept for ${retentionSeconds <= 86_400 ? "24 hours" : `${Math.round(retentionSeconds / 86_400)} days`}, for display only.` };
  };
  const api = {
    async poll() {
      const result = await fetchObservations();
      error = result.error;
      if (result.error) { log.warn?.(`slate: read failed (${result.error})`); return slate(); }
      const at = now();
      for (const o of result.observations) {
        const have = rows.get(o.login);
        const days = { ...(have ? daysOf(have) : {}) };
        days[dayOf(at)] = Math.max(days[dayOf(at)] ?? 0, o.viewers);
        rows.set(o.login, { login: o.login, name: o.name, game: o.game, language: o.language, days, now: o.viewers, seenAt: at });
      }
      // A login seen earlier but absent from this read is no longer live: its audience shows as null until it returns.
      for (const c of result.clips ?? []) clips.set(c.game, { ...c, seenAt: at });
      updatedAt = at;
      prune();
      persist();
      return slate();
    },
    slate,
    error: () => error,
    /** Registry-shaped listings for the slate's streamers; display only, unclaimed until the streamer signs in. */
    listings: () => slate().streamers.filter((s) => s.slug && !reservedSlug(s.slug)).map((s) => ({ slug: s.slug, name: s.name, kind: "tracked", twitch: s.login, streamer: null, mint: null, blurb: null })),
    /** The Board's performance object for a login in the window, or null. */
    performance(login) {
      const s = slate();
      const i = s.streamers.findIndex((r) => r.login === login);
      if (i < 0) return null;
      const r = s.streamers[i];
      return { live: r.live, viewers: r.viewers, game: r.game, startedAt: null, rank: i + 1, deltaViewers: null, week: r.week, provenance: `Data: Twitch. Recorded by Radio LAN at ${new Date((updatedAt ?? now()) * 1000).toISOString()}.` };
    },
    start() {
      if (timer) return;
      const tick = () => api.poll().catch((e) => log.warn?.(`slate: ${e?.message ?? e}`));
      void tick();
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
  return api;
}
