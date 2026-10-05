import { composeLanNote, countSessionSignals, countTapeEvents } from "./session-summary.js";

const PUBLIC_SIGNALS = Object.freeze({
  chat: "Chat activity observed",
  cheer: "Cheer observed",
  subscription: "Subscription observed",
  raid: "Raid observed",
});

function positiveLimit(value) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("maxObservations must be a positive integer");
  }
  return limit;
}

export function toPublicObservation(event) {
  const label = PUBLIC_SIGNALS[event?.signal];
  if (event?.provider !== "twitch" || !label) {
    throw new TypeError("a supported Twitch observation is required");
  }
  if (typeof event.id !== "string" || Number.isNaN(Date.parse(event.observed_at))) {
    throw new TypeError("observation requires an id and source timestamp");
  }
  return Object.freeze({
    id: event.id,
    signal: event.signal,
    observed_at: new Date(event.observed_at).toISOString(),
    label,
  });
}

export function toPublicIrcHealth(state = {}) {
  return Object.freeze({
    enabled: Boolean(state.enabled),
    connected: Boolean(state.irc_connected),
    total_events: Number(state.total_events ?? 0),
    last_event_secs_ago: state.last_event_secs_ago ?? null,
    last_error: state.last_error ?? null,
  });
}

export function createObservationFeed({
  maxObservations = 12,
  now = () => Date.now(),
  sessionStartedAt = null,
  /** Optional source of whitelisted public tape events for LAN's note (server wires the timeline). */
  tapeEvents = null,
} = {}) {
  const limit = positiveLimit(maxObservations);
  const listeners = new Set();
  let observations = [];
  /** Full session history for LAN notes only — never published raw. */
  let sessionSignals = [];
  let health = toPublicIrcHealth();
  let startedAt = sessionStartedAt
    ? new Date(sessionStartedAt).toISOString()
    : new Date(now()).toISOString();

  const emit = (type, data) => {
    for (const listener of listeners) listener(type, data);
  };

  const lanSnapshot = () => {
    const duration_seconds = Math.max(
      0,
      Math.floor((now() - Date.parse(startedAt)) / 1000),
    );
    const counts = countSessionSignals(sessionSignals);
    let tape = null;
    if (tapeEvents) {
      try {
        tape = countTapeEvents(tapeEvents());
      } catch {
        tape = null; // A tape source failure stays silent; LAN cites only what it can observe.
      }
    }
    return Object.freeze({
      started_at: startedAt,
      duration_seconds,
      counts,
      tape,
      note: composeLanNote({ duration_seconds, counts, poll: null, tape }),
    });
  };

  const publishLan = () => emit("lan", lanSnapshot());

  const observe = (event) => {
    const observation = toPublicObservation(event);
    const isNew = !sessionSignals.some((item) => item.id === observation.id);
    if (isNew) {
      sessionSignals = [...sessionSignals, { id: observation.id, signal: observation.signal }];
    }
    observations = [
      observation,
      ...observations.filter((item) => item.id !== observation.id),
    ].slice(0, limit);
    emit("observation", observation);
    if (isNew) publishLan();
    return observation;
  };

  const updateHealth = (state) => {
    health = toPublicIrcHealth(state);
    emit("health", health);
    return health;
  };

  const snapshot = () => Object.freeze({
    observations: Object.freeze([...observations]),
    health,
    lan: lanSnapshot(),
  });

  const subscribe = (listener) => {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return Object.freeze({ observe, updateHealth, snapshot, subscribe, lanSnapshot });
}
