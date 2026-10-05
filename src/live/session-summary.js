/** Evidence-backed session summary. LAN may only cite counts, duration, and a declared poll. */

const SIGNALS = Object.freeze(["chat", "cheer", "subscription", "raid"]);

function isoTimestamp(value, field) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${field} must be an ISO timestamp`);
  }
  return new Date(value).toISOString();
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function countSessionSignals(observations) {
  if (!Array.isArray(observations)) throw new TypeError("observations must be an array");
  const counts = { chat: 0, cheer: 0, subscription: 0, raid: 0 };
  for (const observation of observations) {
    if (!SIGNALS.includes(observation?.signal)) {
      throw new TypeError("observation signal is not public");
    }
    counts[observation.signal] += 1;
  }
  return Object.freeze({ ...counts, total: SIGNALS.reduce((sum, key) => sum + counts[key], 0) });
}

export function declareSessionPoll(input) {
  if (!input || typeof input !== "object") throw new TypeError("poll must be an object");
  const options = (input.options ?? []).map((option) => requiredText(option, "poll option"));
  if (options.length < 2) throw new TypeError("poll requires at least two options");
  const winner = requiredText(input.winner, "poll.winner");
  if (!options.includes(winner)) throw new TypeError("poll winner must be one of the options");
  return Object.freeze({
    question: requiredText(input.question, "poll.question"),
    options: Object.freeze(options),
    winner,
    declared_at: isoTimestamp(input.declared_at, "poll.declared_at"),
  });
}

/**
 * Counts the station-tape events LAN may cite: raids, subscriptions, and predictions
 * from the whitelisted public events. Names, ids, and totals stay out; only counts pass.
 */
export function countTapeEvents(events) {
  if (!Array.isArray(events)) throw new TypeError("tape events must be an array");
  const counts = { raid: 0, subscription: 0, prediction: 0 };
  for (const event of events) {
    const signal = event?.signal === "raid" ? "raid" : event?.signal === "subscription" ? "subscription" : /^prediction_/.test(event?.kind ?? "") ? "prediction" : null;
    if (signal) counts[signal] += 1;
  }
  const total = counts.raid + counts.subscription + counts.prediction;
  return Object.freeze({ ...counts, total });
}

export function composeLanNote({ duration_seconds, counts, poll, tape = null }) {
  const minutes = Math.max(0, Math.round(Number(duration_seconds) / 60));
  const activity = SIGNALS.filter((signal) => counts[signal] > 0)
    .map((signal) => `${counts[signal]} ${signal}`)
    .join(", ");
  const body = activity
    ? `${minutes}-minute session. Observed ${activity}.`
    : `${minutes}-minute session. No public observations. LAN has nothing to add.`;
  const tapeSentence = tape && tape.total > 0
    ? ` Tape: ${["raid", "subscription", "prediction"].filter((signal) => tape[signal] > 0).map((signal) => `${tape[signal]} ${signal}${tape[signal] === 1 ? "" : "s"}`).join(", ")}.`
    : "";
  return poll ? `${body}${tapeSentence} Poll: ${poll.question} — ${poll.winner}.` : `${body}${tapeSentence}`;
}

export function finalizeSession({ id, started_at, ended_at, observations = [], poll = null, tape = [] }) {
  const started = isoTimestamp(started_at, "started_at");
  const ended = isoTimestamp(ended_at, "ended_at");
  const duration_seconds = Math.floor((Date.parse(ended) - Date.parse(started)) / 1000);
  if (duration_seconds < 0) throw new TypeError("ended_at must be at or after started_at");
  const counts = countSessionSignals(observations);
  // Only tape events inside the session window are cited; before and after are other sessions.
  const startMs = Date.parse(started);
  const endMs = Date.parse(ended);
  const inSession = tape.filter((event) => {
    const at = Date.parse(event?.observed_at ?? "");
    return !Number.isNaN(at) && at >= startMs && at <= endMs;
  });
  const tapeCounts = countTapeEvents(inSession);
  const declared = poll ? declareSessionPoll(poll) : null;
  return Object.freeze({
    id: requiredText(id, "id"),
    started_at: started,
    ended_at: ended,
    duration_seconds,
    counts,
    tape: tapeCounts,
    poll: declared,
    note: composeLanNote({ duration_seconds, counts, poll: declared, tape: tapeCounts }),
  });
}
