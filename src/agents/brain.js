/**
 * Agent takes: what a persona says in chat about a board row.
 * Default brain is scripted and deterministic. Any provider's output passes sanitizeTake.
 * Every line is disclosed as an AI agent. No venue URLs, no wagering or pricing vocabulary.
 */

import { describeTwitchRow } from "../markets/twitch-metrics.js";

export const MAX_TAKE_CHARS = 400;
export const DISCLOSURE = "(AI agent)";

/** Vocabulary that turns a culture channel into a betting broadcast. Never emitted. */
export const BANNED_WORDS = Object.freeze([
  "bet", "bets", "betting", "wager", "wagers", "odds", "stake", "staked", "payout", "payouts",
  "yield", "buy", "sell", "trade", "trading", "moon", "pump", "airdrop", "ticker",
  // No venue, no price: the board is viewer counts, and nothing on air is a market.
  "kalshi", "polymarket", "price", "prices", "priced", "pricing",
  // Token words (rlan, token, coin, holders, mint) were banned until the operator lifted that
  // on 2026-10-01. Price and wagering words stay banned.
]);
const BANNED = new RegExp(`\\b(${BANNED_WORDS.join("|")})\\b`, "i");
const URL = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|xyz|io|tv|sh|fun|market|markets|app)\b/gi;

export function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (const char of String(input)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic unit float in [0, 1) from any seed material. */
export function unitFromSeed(seed) {
  return fnv1a(seed) / 0x100000000;
}

export function disclosedLine(persona, body) {
  const name = String(persona?.name ?? "").trim();
  if (!name) throw new TypeError("persona name is required");
  return `${name} ${DISCLOSURE}: ${String(body).trim()}`;
}

/**
 * Enforce the on-air rules on any text, from any provider.
 * Returns { ok, text, reason }. Rejected lines are dropped, never rewritten around.
 */
export function sanitizeTake(persona, body) {
  let text = String(body ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!text) return Object.freeze({ ok: false, text: null, reason: "empty" });
  text = text.replace(URL, "").replace(/\s{2,}/g, " ").trim();
  if (!text) return Object.freeze({ ok: false, text: null, reason: "url_only" });
  const banned = text.match(BANNED);
  if (banned) return Object.freeze({ ok: false, text: null, reason: `banned_word:${banned[1].toLowerCase()}` });
  const line = disclosedLine(persona, text);
  if (line.length > MAX_TAKE_CHARS) {
    return Object.freeze({ ok: true, text: `${line.slice(0, MAX_TAKE_CHARS - 1)}…`, reason: "truncated" });
  }
  return Object.freeze({ ok: true, text: line, reason: null });
}

function n(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function deltaText(row) {
  if (row.delta_viewers === null || row.delta_viewers === undefined) return "first read of the night";
  if (row.delta_viewers === 0) return "flat since the last check";
  return `${row.delta_viewers > 0 ? "up" : "down"} ${n(Math.abs(row.delta_viewers))} since the last check`;
}

/** Twitch-native rows: the race is the story. Everything here is public Twitch data. */
const TWITCH = Object.freeze({
  console: (row) => row.rank === 1
    ? `Live board: ${describeTwitchRow(row)}. Chat, who closes the gap tonight?`
    : `Live board: ${describeTwitchRow(row)}, ${n(row.gap_to_leader)} behind #1. Chat, does it hold?`,
  numbers: (row) => `${describeTwitchRow(row)}. ${deltaText(row)}; ${row.rank === 1 ? "holding #1" : `${n(row.gap_to_leader)} to the leader`}.`,
  culture: (row) => `${row.display_name} at ${n(row.viewer_count)} ${row.minutes_live !== null ? `${row.minutes_live} minutes in` : "right now"} is a statement. I say it climbs from here.`,
  skeptic: (row) => (row.minutes_live ?? 0) >= 60
    ? `${n(row.viewer_count)} after ${row.minutes_live} minutes holds up. Fine, ${row.display_name} is real tonight.`
    : `${n(row.viewer_count)} at ${row.minutes_live ?? 0} minutes in. Early numbers lie. I say ${row.display_name} fades before the hour.`,
});

const TWITCH_OFFLINE = Object.freeze({
  console: (row) => `${row.display_name} is offline tonight. Chat, where did that audience go?`,
  numbers: (row) => `${row.display_name} offline. No data, no take.`,
  culture: (row) => `${row.display_name} dark tonight. The culture moved rooms.`,
  skeptic: (row) => `${row.display_name} offline. Good. Nothing to inflate.`,
});

/** Scripted brain: speaks only from a Twitch board row. Deterministic. */
export function scriptedTake(persona, row) {
  if (row?.kind !== "twitch_live") throw new TypeError("scripted takes need a twitch_live board row");
  const style = TWITCH[persona.style] ? persona.style : "numbers";
  return row.is_live && row.viewer_count !== null ? TWITCH[style](row) : TWITCH_OFFLINE[style](row);
}

/**
 * createBrain({ generate }) — `generate(persona, row)` may be any provider (async or not).
 * Output always passes sanitizeTake. Without `generate` the scripted brain is used.
 */
export function createBrain({ generate = null } = {}) {
  if (generate !== null && typeof generate !== "function") {
    throw new TypeError("generate must be a function when provided");
  }
  const take = async (persona, row) => {
    const body = generate ? await generate(persona, row) : scriptedTake(persona, row);
    return sanitizeTake(persona, body);
  };
  return Object.freeze({ take, provider: generate ? "custom" : "scripted" });
}
