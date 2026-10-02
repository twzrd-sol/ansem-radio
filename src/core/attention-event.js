export const SIGNALS = Object.freeze([
  "presence",
  "playback",
  "chat",
  "cheer",
  "subscription",
  "raid",
  // Added 2026-10-01 for EventSub; additive, still version 1.
  "follow",
  "redemption",
]);

const signalSet = new Set(SIGNALS);

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function isoTimestamp(value, field) {
  requiredText(value, field);
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new TypeError(`${field} must be an ISO timestamp`);
  }
  return timestamp.toISOString();
}

export function createAttentionEvent(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("input must be an object");
  }

  const signal = requiredText(input.signal, "signal");
  if (!signalSet.has(signal)) {
    throw new TypeError(`unsupported signal: ${signal}`);
  }

  return Object.freeze({
    version: 1,
    id: requiredText(input.id, "id"),
    provider: requiredText(input.provider, "provider"),
    source_id: requiredText(input.source_id, "source_id"),
    signal,
    observed_at: isoTimestamp(input.observed_at, "observed_at"),
    participant_id: input.participant_id ?? null,
    content_id: input.content_id ?? null,
    evidence: Object.freeze({ ...(input.evidence ?? {}) }),
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
  });
}

