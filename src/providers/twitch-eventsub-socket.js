/**
 * EventSub over WebSocket for the broadcaster's own channel. Behaviour follows
 * docs/twitch/DEV_DOCS_DIGEST.md section 1:
 * - subscribe on session_welcome (Twitch closes an unused session after 10 s);
 * - a keepalive or notification must arrive within keepalive_timeout_seconds, or
 *   the connection is treated as lost;
 * - session_reconnect: connect to the given URL as is, keep the old socket until
 *   the new welcome, and do not resubscribe (subscriptions carry over);
 * - a lost connection disables every subscription and Twitch replays nothing,
 *   so it opens a gap that closes when a new session is subscribed;
 * - delivery is at least once: dedup on message_id, skip messages older than 10 minutes.
 * Receive-only: the client never sends on the socket (Twitch closes on inbound traffic).
 */

import { TIMELINE_SUBSCRIPTIONS, fromEventSubNotification, subscriptionCondition } from "./twitch-eventsub.js";

export const EVENTSUB_WEBSOCKET_URL = "wss://eventsub.wss.twitch.tv/ws";
export const HELIX_EVENTSUB_URL = "https://api.twitch.tv/helix/eventsub/subscriptions";
const STALE_MS = 10 * 60 * 1000;
const BACKOFF_SECONDS = [1, 2, 5, 10, 30, 60];

export function createEventSubSession({
  accessToken,
  clientId,
  broadcasterId,
  subscriptions = TIMELINE_SUBSCRIPTIONS,
  participantKey = null,
  onEvent = () => {},
  onGap = () => {},
  onState = () => {},
  WebSocketImpl = globalThis.WebSocket,
  fetchImpl = globalThis.fetch,
  clock = Date.now,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => clearTimeout(timer),
  url = EVENTSUB_WEBSOCKET_URL,
  keepaliveSlackMs = 5_000,
  maxSeen = 5_000,
}) {
  if (typeof WebSocketImpl !== "function") throw new TypeError("WebSocket is unavailable");
  if (!clientId || !broadcasterId) throw new TypeError("clientId and broadcasterId are required");
  let token = String(accessToken ?? "").replace(/^oauth:/i, "");
  if (!token) throw new TypeError("accessToken is required");

  let socket = null; // the socket whose session we hold
  let pending = null; // a reconnect socket waiting for its welcome
  let stopped = true;
  let watchdog = null;
  let retryTimer = null;
  let attempt = 0;
  let gapStart = null;
  const seen = new Map(); // message_id -> received at
  const state = {
    connected: false,
    subscribed: 0,
    failed: [],
    revoked: [],
    duplicates: 0,
    stale: 0,
    events: 0,
    last_message_at: null,
    last_error: null,
  };
  const publish = () => onState(Object.freeze({ ...state, failed: [...state.failed], revoked: [...state.revoked], gap_open: gapStart !== null }));

  const openGap = (reason) => {
    if (gapStart === null) gapStart = { at: new Date(clock()).toISOString(), reason };
  };
  const closeGap = () => {
    if (gapStart === null) return;
    onGap(Object.freeze({ start: gapStart.at, end: new Date(clock()).toISOString(), reason: gapStart.reason }));
    gapStart = null;
  };

  const armWatchdog = (seconds) => {
    if (watchdog) cancel(watchdog);
    watchdog = schedule(() => lose("keepalive_timeout"), seconds * 1000 + keepaliveSlackMs);
  };
  let keepaliveSeconds = 10;

  const remember = (id) => {
    seen.set(id, clock());
    if (seen.size > maxSeen) seen.delete(seen.keys().next().value);
  };

  async function subscribeAll(sessionId) {
    const results = await Promise.allSettled(
      subscriptions.map(async (spec) => {
        const response = await fetchImpl(HELIX_EVENTSUB_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId, "Content-Type": "application/json" },
          body: JSON.stringify({
            type: spec.type,
            version: spec.version,
            condition: subscriptionCondition(spec, broadcasterId),
            transport: { method: "websocket", session_id: sessionId },
          }),
        });
        if (!response.ok) throw Object.assign(new Error(spec.type), { status: response.status, spec });
        return spec;
      }),
    );
    state.subscribed = results.filter((r) => r.status === "fulfilled").length;
    state.failed = results
      .filter((r) => r.status === "rejected")
      .map((r) => ({ type: r.reason.spec?.type ?? "unknown", status: r.reason.status ?? null }));
  }

  function handle(ws, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const type = message?.metadata?.message_type;
    if (type === "session_welcome") {
      const session = message.payload?.session ?? {};
      keepaliveSeconds = Number(session.keepalive_timeout_seconds) || 10;
      if (ws === pending) {
        // Reconnect handover: the new session already holds our subscriptions.
        const old = socket;
        socket = pending;
        pending = null;
        if (old && old.readyState < 2) old.close(1000, "reconnect_handover");
        armWatchdog(keepaliveSeconds);
        state.connected = true;
        publish();
        return;
      }
      if (ws !== socket) return;
      armWatchdog(keepaliveSeconds);
      subscribeAll(session.id)
        .then(() => {
          state.connected = true;
          state.last_error = state.subscribed === 0 ? "no_subscriptions" : null;
          attempt = 0;
          closeGap();
          publish();
        })
        .catch(() => {
          state.last_error = "subscribe_failed";
          publish();
        });
      return;
    }
    if (ws !== socket) return;
    if (type === "session_keepalive") {
      armWatchdog(keepaliveSeconds);
      return;
    }
    if (type === "session_reconnect") {
      const next = message.payload?.session?.reconnect_url;
      if (typeof next === "string") connect(next, true);
      return;
    }
    if (type === "revocation") {
      const sub = message.payload?.subscription ?? {};
      state.revoked.push({ type: sub.type ?? "unknown", status: sub.status ?? "unknown" });
      publish();
      return;
    }
    if (type !== "notification") return;
    armWatchdog(keepaliveSeconds);
    const id = message.metadata.message_id;
    if (seen.has(id)) {
      state.duplicates += 1;
      return;
    }
    remember(id);
    const sentAt = Date.parse(String(message.metadata.message_timestamp ?? "").replace(/(\.\d{3})\d+/, "$1"));
    if (!Number.isFinite(sentAt) || clock() - sentAt > STALE_MS) {
      state.stale += 1;
      return;
    }
    let normalized;
    try {
      normalized = fromEventSubNotification(message, { participantKey });
    } catch {
      state.last_error = "normalize_failed";
      return;
    }
    if (!normalized) return;
    state.events += 1;
    state.last_message_at = new Date(clock()).toISOString();
    onEvent(normalized);
  }

  function connect(target, isReconnect = false) {
    const ws = new WebSocketImpl(target);
    if (isReconnect) pending = ws;
    else socket = ws;
    ws.addEventListener("message", (message) => handle(ws, typeof message.data === "string" ? message.data : String(message.data)));
    ws.addEventListener("close", () => {
      if (ws === pending) {
        pending = null;
        return;
      }
      if (ws === socket && !stopped) lose("socket_closed");
    });
    ws.addEventListener("error", () => {
      if (ws === socket) state.last_error = "socket_error";
    });
  }

  function lose(reason) {
    if (stopped) return;
    if (watchdog) cancel(watchdog);
    watchdog = null;
    state.connected = false;
    state.last_error = reason;
    openGap(reason);
    const old = socket;
    socket = null;
    if (old && old.readyState < 2) old.close(1000, reason);
    publish();
    const delay = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
    attempt += 1;
    retryTimer = schedule(() => {
      retryTimer = null;
      if (!stopped) connect(url);
    }, delay * 1000);
  }

  return Object.freeze({
    start() {
      if (!stopped) return;
      stopped = false;
      connect(url);
    },
    stop() {
      stopped = true;
      if (watchdog) cancel(watchdog);
      if (retryTimer) cancel(retryTimer);
      for (const ws of [socket, pending]) if (ws && ws.readyState < 2) ws.close(1000, "client_stop");
      socket = null;
      pending = null;
      state.connected = false;
      publish();
    },
    /** The token manager rotates tokens; new subscriptions use the latest. */
    setToken(next) {
      const clean = String(next ?? "").replace(/^oauth:/i, "");
      if (clean) token = clean;
    },
    state: () => Object.freeze({ ...state, gap_open: gapStart !== null }),
  });
}
