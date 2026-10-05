/**
 * Holds the current public Twitch board for the live room and refreshes it on a timer.
 * Emits ("board", snapshot) to subscribers; the server turns that into SSE.
 */

import { fetchTwitchBoard } from "../markets/twitch-metrics.js";

// No `title`: other streamers' titles are unmoderated free text and can carry URLs. Nothing speaks or renders them.
const PUBLIC_FIELDS = Object.freeze(["kind", "login", "display_name", "is_live", "viewer_count", "game_id", "game_name", "started_at", "minutes_live", "fetched_at", "rank", "gap_to_leader", "delta_viewers"]);

function publicRow(row) {
  if (row?.kind !== "twitch_live") throw new TypeError("board rows must be twitch_live rows");
  return Object.freeze(Object.fromEntries(PUBLIC_FIELDS.filter((key) => key in row).map((key) => [key, row[key]])));
}

export function toPublicBoard(board) {
  if (!board || !Array.isArray(board.rows)) throw new TypeError("a market board is required");
  return Object.freeze({
    kind: "twitch_live",
    source: board.source,
    generated_at: board.generated_at,
    live_count: board.live_count ?? null,
    displayed_count: board.displayed_count ?? null,
    tracked_live_viewers: board.tracked_live_viewers ?? null,
    race: board.race ?? null,
    offline: Object.freeze([...(board.offline ?? [])]),
    rows: Object.freeze(board.rows.map(publicRow)),
    errors: Object.freeze((board.errors ?? []).map((item) => item.login ?? item.error)),
  });
}

export function createMarketFeed({
  fetchBoard = fetchTwitchBoard,
  intervalMs = 60_000,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => clearTimeout(timer),
  now = () => Date.now(),
} = {}) {
  if (typeof fetchBoard !== "function") throw new TypeError("fetchBoard must be a function");
  const listeners = new Set();
  let board = null;
  let lastRaw = null;
  let lastError = null;
  let updatedAt = null;
  let timer = null;
  let active = false;

  const emit = (type, data) => {
    for (const listener of listeners) listener(type, data);
  };
  const snapshot = () => Object.freeze({
    board,
    updated_at: updatedAt,
    last_error: lastError,
    enabled: active,
  });

  const refresh = async () => {
    try {
      const next = await fetchBoard({ now, previous: lastRaw });
      lastRaw = next;
      board = toPublicBoard(next);
      lastError = null;
      updatedAt = new Date(now()).toISOString();
    } catch (error) {
      lastError = error?.code ?? "board_fetch_failed";
    }
    emit("board", snapshot());
    return snapshot();
  };

  const loop = async () => {
    if (!active) return;
    await refresh();
    if (!active) return;
    timer = schedule(loop, intervalMs);
  };

  const start = async () => {
    if (active) return snapshot();
    active = true;
    await loop();
    return snapshot();
  };
  const stop = () => {
    active = false;
    if (timer) cancel(timer);
    timer = null;
    return snapshot();
  };
  const subscribe = (listener) => {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return Object.freeze({ start, stop, refresh, snapshot, subscribe });
}
