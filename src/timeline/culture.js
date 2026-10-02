/**
 * The culture macro view: the tracked streamers' public stream rows, sampled once a
 * minute, rolled up per streamer per UTC hour. Per-minute rows are Twitch API data and
 * live only in the 24-hour raw store; the hourly rollups (minutes live, average and peak
 * viewers, sessions, top category) are derived, local, and never published
 *.
 */

export function hourOf(time) {
  const ms = typeof time === "number" ? time : Date.parse(time);
  if (!Number.isFinite(ms)) throw new TypeError("a valid time is required");
  // "2026-10-01T20:00Z": parseable by Date.parse, unlike "2026-10-01T20Z".
  return new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString().slice(0, 16) + "Z";
}

export function createCultureAggregator() {
  const hours = new Map(); // hour -> login -> stats

  return Object.freeze({
    /** One minute's rows: [{ login, is_live, viewer_count, game_name, started_at }]. */
    sample(time, rows) {
      const hour = hourOf(time);
      if (!hours.has(hour)) hours.set(hour, new Map());
      const byLogin = hours.get(hour);
      for (const row of rows) {
        const login = String(row.login ?? "").toLowerCase();
        if (!/^[a-z0-9_]{3,25}$/.test(login)) continue;
        if (!byLogin.has(login)) byLogin.set(login, { samples: 0, live: 0, viewerSum: 0, peak: 0, sessions: new Set(), categories: new Map() });
        const s = byLogin.get(login);
        s.samples += 1;
        if (row.is_live && Number.isFinite(row.viewer_count)) {
          s.live += 1;
          s.viewerSum += row.viewer_count;
          s.peak = Math.max(s.peak, row.viewer_count);
          if (row.started_at) s.sessions.add(String(row.started_at));
          if (row.game_name) s.categories.set(row.game_name, (s.categories.get(row.game_name) ?? 0) + 1);
        }
      }
    },

    /** Finished hours (strictly before `time`), one rollup per streamer, oldest first. */
    flush(time) {
      const current = hourOf(time);
      const out = [];
      for (const hour of [...hours.keys()].filter((h) => h < current).sort()) {
        for (const [login, s] of [...hours.get(hour)].sort(([a], [b]) => a.localeCompare(b))) {
          const top = [...s.categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
          out.push(Object.freeze({
            hour,
            login,
            sampled_minutes: s.samples,
            minutes_live: s.live,
            avg_viewers: s.live ? Math.round(s.viewerSum / s.live) : null,
            peak_viewers: s.live ? s.peak : null,
            viewer_minutes: s.viewerSum,
            sessions: s.sessions.size,
            top_category: top ? top[0].slice(0, 80) : null,
          }));
        }
        hours.delete(hour);
      }
      return out;
    },
  });
}

/** Per-streamer totals over a window of hourly rollups, with each one's share of attention. */
export function cultureTable(rollups) {
  const by = new Map();
  for (const r of rollups) {
    if (!by.has(r.login)) by.set(r.login, { login: r.login, minutes_live: 0, viewer_minutes: 0, peak_viewers: 0, sessions: 0, categories: new Map() });
    const t = by.get(r.login);
    t.minutes_live += r.minutes_live;
    t.viewer_minutes += r.viewer_minutes;
    t.peak_viewers = Math.max(t.peak_viewers, r.peak_viewers ?? 0);
    t.sessions += r.sessions;
    if (r.top_category) t.categories.set(r.top_category, (t.categories.get(r.top_category) ?? 0) + r.minutes_live);
  }
  const total = [...by.values()].reduce((s, t) => s + t.viewer_minutes, 0);
  return [...by.values()]
    .map((t) => ({
      login: t.login,
      minutes_live: t.minutes_live,
      avg_viewers: t.minutes_live ? Math.round(t.viewer_minutes / t.minutes_live) : null,
      peak_viewers: t.minutes_live ? t.peak_viewers : null,
      sessions: t.sessions,
      top_category: [...t.categories].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      attention_share: total ? Math.round((t.viewer_minutes / total) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => b.attention_share - a.attention_share || a.login.localeCompare(b.login));
}
