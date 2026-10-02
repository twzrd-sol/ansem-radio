/** Extracted from an earlier internal implementation.rs @ 45ac7018. No claims. */

export function nextIrcBackoffSeconds(currentSeconds) {
  const current = Number(currentSeconds);
  if (!Number.isFinite(current) || current < 1) return 1;
  return Math.min(current * 2, 30);
}

export function ircPongFor(line) {
  const text = String(line ?? "").trimEnd();
  if (!text.startsWith("PING")) return null;
  return text.includes(":") ? `${text.replace("PING", "PONG")}\r\n` : "PONG :tmi.twitch.tv\r\n";
}
function loginSet(logins) {
  return new Set((logins ?? []).map((login) => {
    if (typeof login !== "string" || !login.trim()) {
      throw new TypeError("channel login must be a non-empty string");
    }
    return login.trim().replace(/^#/, "").toLowerCase();
  }));
}
export function reconcileIrcJoins(joined, desired) {
  const have = loginSet(joined);
  const want = loginSet(desired);
  return Object.freeze({
    join: Object.freeze([...want].filter((login) => !have.has(login)).sort()),
    part: Object.freeze([...have].filter((login) => !want.has(login)).sort()),
    next_joined: Object.freeze([...want].sort()),
  });
}
function secsAgo(iso, now) {
  if (!iso) return null;
  const ms = now - Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : null;
}

export function snapshotTwitchIngestHealth(health, now = Date.now()) {
  if (!health || typeof health !== "object") throw new TypeError("health must be an object");
  return Object.freeze({
    enabled: Boolean(health.enabled),
    curated_channels: Array.isArray(health.curated_logins) ? health.curated_logins.length : 0,
    irc_connected: Boolean(health.irc_connected),
    total_events: Number(health.total_events ?? 0),
    last_event_secs_ago: secsAgo(health.last_event_at, now),
    last_join_reconcile_secs_ago: secsAgo(health.last_join_reconcile_at, now),
    last_error: health.last_error ?? null,
    last_flush_error: health.last_flush_error ?? null,
    cursor: health.cursor ?? null,
    total_sent: Number(health.total_sent ?? 0),
  });
}

export function createIngestCursor(event) {
  if (!event?.id || Number.isNaN(Date.parse(event.observed_at))) {
    throw new TypeError("cursor requires id and ISO observed_at");
  }
  return Object.freeze({
    last_event_id: event.id,
    last_observed_at: event.observed_at,
    last_provider_event_id: event.evidence?.provider_event_id ?? null,
  });
}

function compareEvents(a, b) {
  const dt = Date.parse(a.observed_at) - Date.parse(b.observed_at);
  if (dt !== 0) return dt;
  const an = Number(a.evidence?.provider_event_id);
  const bn = Number(b.evidence?.provider_event_id);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function replayFromCursor(events, cursor) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  const ordered = [...events].sort(compareEvents);
  const accepted = cursor
    ? ordered.filter((event) => compareEvents(event, {
        id: cursor.last_event_id,
        observed_at: cursor.last_observed_at,
        evidence: { provider_event_id: cursor.last_provider_event_id },
      }) > 0)
    : ordered;
  const last = accepted.at(-1);
  return Object.freeze({
    events: Object.freeze(accepted),
    cursor: last ? createIngestCursor(last) : (cursor ?? null),
  });
}
