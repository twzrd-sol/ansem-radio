/**
 * Published polls for the hub's free season (the zero-to-one sprint, slice A): one multiple-choice question per UTC
 * day, from the season config's `polls` or a RADIOLAN_HUB_POLLS JSON file. A poll answer credits poll_response by the
 * season's policy only on the day its poll is published, once per poll id, so answers cannot be farmed by inventing
 * poll ids. Questions marked `placeholder` are station-authored stand-ins until the operator publishes real ones,
 * and the page says so.
 */
import { readFileSync } from "node:fs";

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (value, field, max) => {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`polls: ${field} must be 1-${max} characters`);
  return value.trim();
};

/** Validated, frozen polls: unique ids, at most one per UTC day, 2 to 6 options each. */
export function normalizePolls(input) {
  if (input === null || input === undefined) return Object.freeze([]);
  if (!Array.isArray(input) || input.length > 400) throw new TypeError("polls: an array of at most 400 polls");
  const ids = new Set();
  const days = new Set();
  const polls = input.map((p) => {
    if (!p || typeof p !== "object") throw new TypeError("polls: each poll is an object");
    if (typeof p.id !== "string" || !ID.test(p.id)) throw new TypeError(`polls: bad id ${JSON.stringify(p.id)}`);
    if (typeof p.day !== "string" || !DAY.test(p.day) || Number.isNaN(Date.parse(`${p.day}T00:00:00Z`))) throw new TypeError(`polls: ${p.id} needs a day as YYYY-MM-DD`);
    if (ids.has(p.id)) throw new TypeError(`polls: duplicate id ${p.id}`);
    if (days.has(p.day)) throw new TypeError(`polls: two polls on ${p.day}`);
    ids.add(p.id);
    days.add(p.day);
    if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > 6) throw new TypeError(`polls: ${p.id} needs 2 to 6 options`);
    const options = p.options.map((o, i) => text(o, `${p.id} option ${i + 1}`, 80));
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new TypeError(`polls: ${p.id} repeats an option`);
    return Object.freeze({ id: p.id, day: p.day, question: text(p.question, `${p.id} question`, 200), options: Object.freeze(options), placeholder: p.placeholder === true });
  });
  return Object.freeze(polls);
}

export const utcDay = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** The poll published for the UTC day of `seconds`, or null. */
export const pollFor = (polls, seconds) => polls.find((p) => p.day === utcDay(seconds)) ?? null;

export function loadPolls(path = process.env.RADIOLAN_HUB_POLLS) {
  if (!path) return Object.freeze([]);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return normalizePolls(Array.isArray(parsed) ? parsed : parsed?.polls);
}
