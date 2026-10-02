/**
 * Twitch-native market line: public live metrics from Helix `Get Streams` for an allowlist of
 * streamers. Twitch's own data about Twitch, displayed on Twitch. No venue, no price, no money.
 * Needs a Client-Id and any valid Twitch token (the station's chat token works for this read).
 */

export const HELIX_STREAMS_URL = "https://api.twitch.tv/helix/streams";

/** Twitch logins the channel covers. Kick-only or YouTube-only creators are not here on purpose. */
export const TRACKED_STREAMERS = Object.freeze([
  "kaicenat", "ninja", "plaqueboymax", "jynxzi", "jasontheween", "xqc",
  "ishowspeed", "agent00", "dukedennis", "fanum", "caseoh_", "stableronaldo",
]);

function login(value) {
  const cleaned = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(cleaned)) throw new TypeError("a Twitch login is required");
  return cleaned;
}

function text(value, max = 120) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function isoOrNull(value) {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** One row per tracked login, live or not. Helix only returns live streams. */
export function normalizeTwitchStream(raw, trackedLogin, fetchedAt = new Date().toISOString()) {
  const user = login(trackedLogin);
  if (!raw) {
    return Object.freeze({
      kind: "twitch_live", login: user, display_name: user, is_live: false, viewer_count: null,
      game_id: null, game_name: null, title: null, started_at: null, minutes_live: null, source: "twitch public",
      fetched_at: new Date(fetchedAt).toISOString(),
    });
  }
  if (login(raw.user_login) !== user) throw new TypeError("stream row does not match the tracked login");
  const viewers = Number(raw.viewer_count);
  const started = isoOrNull(raw.started_at);
  const minutes = started ? Math.max(0, Math.floor((Date.parse(fetchedAt) - Date.parse(started)) / 60_000)) : null;
  return Object.freeze({
    kind: "twitch_live",
    login: user,
    display_name: text(raw.user_name || user, 40),
    is_live: raw.type === "live",
    viewer_count: Number.isFinite(viewers) && viewers >= 0 ? Math.floor(viewers) : null,
    game_id: text(raw.game_id, 32) || null,
    game_name: text(raw.game_name, 60) || null,
    title: text(raw.title, 120) || null,
    started_at: started,
    minutes_live: minutes,
    source: "twitch public",
    fetched_at: new Date(fetchedAt).toISOString(),
  });
}

/**
 * Board: live rows ranked by viewers, with rank, gap to the leader, and delta since the previous
 * board when one is supplied. Offline rows are kept in `offline` for the "who is dark" beat.
 */
export function buildTwitchBoard(rows, { previous = null, now = () => Date.now(), limit = 12 } = {}) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  const allLive = rows.filter((row) => row.is_live && row.viewer_count !== null)
    .sort((a, b) => (b.viewer_count - a.viewer_count) || a.login.localeCompare(b.login));
  const live = allLive.slice(0, Math.max(1, Number(limit) || 12));
  const prevByLogin = new Map((previous?.rows ?? []).map((row) => [row.login, row]));
  const leader = live[0]?.viewer_count ?? null;
  const ranked = live.map((row, index) => {
    const prev = prevByLogin.get(row.login);
    const delta = prev && prev.viewer_count !== null ? row.viewer_count - prev.viewer_count : null;
    return Object.freeze({
      ...row,
      rank: index + 1,
      gap_to_leader: leader === null ? null : leader - row.viewer_count,
      delta_viewers: delta,
    });
  });
  const race = ranked.length >= 2
    ? Object.freeze({ a: ranked[0].login, b: ranked[1].login, gap: ranked[0].viewer_count - ranked[1].viewer_count })
    : null;
  const offline = rows.filter((row) => !row.is_live).map((row) => row.login).sort();
  return Object.freeze({
    kind: "twitch_live",
    source: "twitch public",
    generated_at: new Date(now()).toISOString(),
    live_count: allLive.length,
    displayed_count: ranked.length,
    /** Sum over every live TRACKED channel (not the displayed subset, not the category). */
    tracked_live_viewers: allLive.reduce((sum, row) => sum + row.viewer_count, 0),
    race,
    offline: Object.freeze(offline),
    rows: Object.freeze(ranked),
  });
}

export function describeTwitchRow(row) {
  if (!row.is_live) return `${row.display_name} is offline`;
  const viewers = row.viewer_count.toLocaleString("en-US");
  const game = row.game_name ? ` in ${row.game_name}` : "";
  const since = row.minutes_live !== null ? `, live ${row.minutes_live} min` : "";
  const rank = row.rank ? `#${row.rank} ` : "";
  return `${rank}${row.display_name}: ${viewers} watching${game}${since}`;
}

/** Fetch live metrics for the allowlist. Auth failures are reported, never thrown. */
export async function fetchTwitchBoard({
  fetchImpl = globalThis.fetch,
  clientId = process.env.TWITCH_CLIENT_ID,
  token = process.env.TWITCH_IRC_OAUTH_TOKEN,
  logins = TRACKED_STREAMERS,
  previous = null,
  now = () => Date.now(),
  url = HELIX_STREAMS_URL,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
  const tracked = [...new Set(logins.map(login))];
  const fetchedAt = new Date(now()).toISOString();
  const errors = [];
  let streams = [];
  const cleanToken = String(token ?? "").replace(/^oauth:/i, "").trim();
  if (!clientId || !cleanToken) {
    errors.push({ error: "twitch_credentials_missing" });
  } else {
    const query = tracked.map((item) => `user_login=${encodeURIComponent(item)}`).join("&");
    try {
      const response = await fetchImpl(`${url}?first=100&${query}`, {
        headers: { "Client-Id": clientId, Authorization: `Bearer ${cleanToken}`, accept: "application/json" },
      });
      if (!response.ok) {
        errors.push({ error: `status_${response.status}` });
      } else {
        const body = await response.json();
        streams = Array.isArray(body?.data) ? body.data : [];
      }
    } catch {
      errors.push({ error: "fetch_failed" });
    }
  }
  const byLogin = new Map(streams.map((item) => [String(item.user_login ?? "").toLowerCase(), item]));
  const rows = [];
  for (const item of tracked) {
    try {
      rows.push(normalizeTwitchStream(byLogin.get(item) ?? null, item, fetchedAt));
    } catch {
      errors.push({ login: item, error: "row_invalid" });
    }
  }
  const board = buildTwitchBoard(rows, { previous, now });
  return Object.freeze({ ...board, errors: Object.freeze(errors) });
}
