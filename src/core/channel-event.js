/**
 * Channel events: what happened to a channel, as opposed to an attention event
 * (what one participant did). Stream state, title and category changes, the
 * lifecycle of predictions, polls, hype trains and goals, ad breaks, shoutouts,
 * outgoing raids and viewer-count samples.
 *
 * A channel event never identifies a participant. Totals are numbers, labels
 * are short display strings (a title, a category, an outcome name), and
 * anything that looks like a person's identity is refused, so a provider's
 * "top predictors" or "last contribution" lists cannot ride along.
 */

export const CHANNEL_EVENT_KINDS = Object.freeze([
  "stream_online",
  "stream_offline",
  "channel_update",
  "viewer_sample",
  "prediction_begin",
  "prediction_progress",
  "prediction_lock",
  "prediction_end",
  "poll_begin",
  "poll_progress",
  "poll_end",
  "hype_train_begin",
  "hype_train_progress",
  "hype_train_end",
  "goal_begin",
  "goal_progress",
  "goal_end",
  "ad_break",
  "shoutout_out",
  "shoutout_in",
  "raid_out",
]);

const kinds = new Set(CHANNEL_EVENT_KINDS);
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
// Field names that would identify a person. Checked on totals, labels and outcomes.
const IDENTITY = /(^|_)(user|login|participant|chatter|viewer_id|email|wallet)(_|$)/;
const MAX_TOTALS = 24;
const MAX_LABELS = 8;
const MAX_LABEL_CHARS = 140;
const MAX_OUTCOMES = 10;

function text(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function iso(value, field) {
  const time = new Date(text(value, field));
  if (Number.isNaN(time.valueOf())) throw new TypeError(`${field} must be an ISO timestamp`);
  return time.toISOString();
}

function checkKey(key, field) {
  if (!KEY.test(key)) throw new TypeError(`${field}.${key}: keys are lowercase snake_case`);
  if (IDENTITY.test(key)) throw new TypeError(`${field}.${key}: channel events carry no participant identity`);
}

function totalsOf(input, field) {
  const entries = Object.entries(input ?? {});
  if (entries.length > MAX_TOTALS) throw new TypeError(`${field}: at most ${MAX_TOTALS} totals`);
  const out = {};
  for (const [key, value] of entries) {
    checkKey(key, field);
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field}.${key} must be a finite number >= 0`);
    out[key] = value;
  }
  return Object.freeze(out);
}

function cleanLabel(value, field, max) {
  // Control and invisible characters out, whitespace collapsed, length capped.
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned === "") throw new TypeError(`${field} must not be empty`);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function labelsOf(input, field) {
  const entries = Object.entries(input ?? {});
  if (entries.length > MAX_LABELS) throw new TypeError(`${field}: at most ${MAX_LABELS} labels`);
  const out = {};
  for (const [key, value] of entries) {
    checkKey(key, field);
    if (typeof value !== "string") throw new TypeError(`${field}.${key} must be a string`);
    out[key] = cleanLabel(value, `${field}.${key}`, MAX_LABEL_CHARS);
  }
  return Object.freeze(out);
}

function outcomesOf(input) {
  if (input === undefined || input === null) return Object.freeze([]);
  if (!Array.isArray(input) || input.length > MAX_OUTCOMES) throw new TypeError(`outcomes: at most ${MAX_OUTCOMES}`);
  return Object.freeze(
    input.map((outcome, i) => {
      const extra = Object.keys(outcome ?? {}).filter((key) => key !== "label" && key !== "totals");
      if (extra.length > 0) throw new TypeError(`outcomes[${i}]: only label and totals (got ${extra.join(", ")})`);
      return Object.freeze({ label: cleanLabel(text(outcome.label, `outcomes[${i}].label`), `outcomes[${i}].label`, 80), totals: totalsOf(outcome.totals, `outcomes[${i}].totals`) });
    }),
  );
}

export function createChannelEvent(input) {
  if (!input || typeof input !== "object") throw new TypeError("input must be an object");
  const kind = text(input.kind, "kind");
  if (!kinds.has(kind)) throw new TypeError(`unsupported channel event kind: ${kind}`);
  const allowed = new Set(["id", "provider", "source_id", "kind", "observed_at", "content_id", "totals", "labels", "outcomes", "evidence"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) throw new TypeError(`unknown channel event fields: ${extra.join(", ")}`);
  return Object.freeze({
    version: 1,
    id: text(input.id, "id"),
    provider: text(input.provider, "provider"),
    source_id: text(input.source_id, "source_id"),
    kind,
    observed_at: iso(input.observed_at, "observed_at"),
    content_id: input.content_id ?? null,
    totals: totalsOf(input.totals, "totals"),
    labels: labelsOf(input.labels, "labels"),
    outcomes: outcomesOf(input.outcomes),
    evidence: Object.freeze({ ...(input.evidence ?? {}) }),
  });
}
