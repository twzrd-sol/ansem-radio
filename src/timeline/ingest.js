/**
 * The timeline ingest, run inside the live room so one process owns the rotating
 * Twitch token (refresh tokens are single use; two refreshing processes would lock
 * each other out). Inputs: EventSub for our own channel, the room's IRC chat
 * events, and Helix samples (one call a minute for our live state and viewers
 * plus the tracked streamers' public stream rows; the follower total every five
 * minutes). Output: the timeline store, including the hourly culture rollups.
 * It runs whether or not the station is live, and reports live state to the room. Internal only; nothing here reaches the overlay
 *.
 */

import { TRACKED_STREAMERS } from "../markets/twitch-metrics.js";
import { createEventSubSession } from "../providers/twitch-eventsub-socket.js";
import { createMinuteAggregator } from "./aggregate.js";
import { createCultureAggregator } from "./culture.js";

const TICK_MS = 10_000;
const SAMPLE_MS = 60_000;
const FOLLOWERS_MS = 300_000;
const PURGE_MS = 3_600_000;

export function createTimelineIngest({
  clientId,
  login,
  participantKey = null,
  store,
  tracked = TRACKED_STREAMERS,
  onLive = () => {},
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  createEventSub = createEventSubSession,
  clock = Date.now,
  every = (fn, ms) => setInterval(fn, ms),
  stopEvery = (timer) => clearInterval(timer),
  log = console,
}) {
  if (!store) throw new TypeError("a timeline store is required");
  const aggregator = createMinuteAggregator();
  const culture = createCultureAggregator();
  let token = null;
  let broadcasterId = null;
  let eventsub = null;
  let timers = [];
  let lastState = {};

  const now = () => clock();
  const helix = async (path) => {
    const response = await fetchImpl(`https://api.twitch.tv/helix/${path}`, {
      headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId },
    });
    if (!response.ok) throw new Error(`helix ${path.split("?")[0]}: ${response.status}`);
    return response.json();
  };

  const record = (item) => {
    aggregator.observe(item);
    if (item?.kind === "channel" && item.event.kind === "stream_online") onLive(true);
    if (item?.kind === "channel" && item.event.kind === "stream_offline") onLive(false);
    try {
      store.appendRaw(item);
    } catch (error) {
      log.warn?.(`timeline: raw write failed (${error.code ?? "error"})`);
    }
  };

  // One Helix call a minute covers the station and every tracked streamer (at most 100 logins per call).
  const logins = [...new Set([String(login).toLowerCase(), ...tracked.map((t) => String(t).toLowerCase())])].slice(0, 100);
  async function sampleStream() {
    try {
      const body = await helix(`streams?first=100&${logins.map((l) => `user_login=${encodeURIComponent(l)}`).join("&")}`);
      const live = new Map((body.data ?? []).map((s) => [String(s.user_login ?? "").toLowerCase(), s]));
      const station = live.get(String(login).toLowerCase());
      const rows = tracked.map((t) => {
        const s = live.get(String(t).toLowerCase());
        return s
          ? { login: String(t).toLowerCase(), is_live: true, viewer_count: Number(s.viewer_count) || 0, game_name: s.game_name ?? null, started_at: s.started_at ?? null }
          : { login: String(t).toLowerCase(), is_live: false, viewer_count: null, game_name: null, started_at: null };
      });
      const liveRows = rows.filter((r) => r.is_live);
      aggregator.sample(now(), {
        liveNow: Boolean(station),
        viewers: station ? Number(station.viewer_count) || 0 : null,
        trackedLive: liveRows.length,
        trackedViewers: liveRows.reduce((sum, r) => sum + r.viewer_count, 0),
      });
      culture.sample(now(), rows);
      try {
        store.appendRaw({ kind: "culture_sample", at: new Date(now()).toISOString(), rows });
      } catch {
        // The raw copy is optional; the rollup already has the minute.
      }
      onLive(Boolean(station));
    } catch {
      // A missed sample leaves the minute's viewers empty, which reads as unknown, not zero.
    }
  }

  async function sampleFollowers() {
    if (!broadcasterId) return;
    try {
      const body = await helix(`channels/followers?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=1`);
      if (Number.isFinite(body.total)) aggregator.sample(now(), { followersTotal: body.total });
    } catch {
      // Unknown, not zero.
    }
  }

  const flush = () => {
    for (const bucket of aggregator.flush(now())) {
      try {
        store.appendMinute(bucket);
      } catch (error) {
        log.warn?.(`timeline: minute write failed (${error.code ?? "error"})`);
      }
    }
    for (const rollup of culture.flush(now())) {
      try {
        store.appendCulture(rollup);
      } catch (error) {
        log.warn?.(`timeline: culture write failed (${error.code ?? "error"})`);
      }
    }
  };

  async function resolveBroadcaster() {
    const response = await fetchImpl("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${token}` } });
    if (!response.ok) throw new Error(`validate: ${response.status}`);
    const body = await response.json();
    if (String(body.login ?? "").toLowerCase() !== String(login).toLowerCase() || !body.user_id) {
      throw new Error("the token is not the station's");
    }
    return String(body.user_id);
  }

  return Object.freeze({
    /** Called with each access token the room's token manager issues; the first one starts the ingest. */
    async setToken(next) {
      token = String(next ?? "").replace(/^oauth:/i, "");
      if (!token) return;
      if (eventsub) {
        eventsub.setToken(token);
        return;
      }
      broadcasterId = await resolveBroadcaster();
      eventsub = createEventSub({
        accessToken: token,
        clientId,
        broadcasterId,
        participantKey,
        WebSocketImpl,
        fetchImpl,
        onEvent: record,
        onGap: (gap) => store.appendGap(gap),
        onState: (state) => {
          lastState = state;
        },
      });
      eventsub.start();
      timers = [
        every(() => {
          aggregator.tick(now(), { connected: Boolean(lastState.connected), seconds: TICK_MS / 1000 });
          flush();
        }, TICK_MS),
        every(() => void sampleStream(), SAMPLE_MS),
        every(() => void sampleFollowers(), FOLLOWERS_MS),
        every(() => store.purgeRaw(), PURGE_MS),
      ];
      store.purgeRaw();
      void sampleStream();
      void sampleFollowers();
    },

    /** The room's IRC chat events (already keyed, no text or logins). */
    observeIrc(event) {
      if (event?.signal === "chat") record({ kind: "attention", event });
    },

    stop() {
      for (const timer of timers) stopEvery(timer);
      timers = [];
      eventsub?.stop();
      eventsub = null;
      flush();
    },

    state: () => Object.freeze({ ...lastState, broadcaster_known: Boolean(broadcasterId), pending_minutes: aggregator.pending() }),
  });
}
