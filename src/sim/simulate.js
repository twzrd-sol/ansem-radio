/**
 * Offline in-stream economy simulator. Seeded and
 * reproducible: the same seed and parameters give identical output. Three random
 * streams (audience, points world, token world), so changing one world's
 * parameters cannot change who shows up or the other world's result.
 * Imports nothing that touches the network.
 */

import { simulateAudience } from "./audience.js";
import { EARN, MAX_CUSTOM_REWARDS, PREDICTION } from "./twitch-points.js";
import { runPointsWorld } from "./world-points.js";
import { WORLD_B_LABEL, runTokenWorld } from "./world-token.js";

export const WORLD_A_LABEL = "Channel Points have no monetary value and cannot be exchanged outside Twitch (Twitch policy).";

/**
 * Presets are illustrative and UNCALIBRATED: they are not radiolanlive's numbers.
 * Calibrate from the timeline (`npm run timeline -- summary --days 30 --json`).
 */
export const PRESETS = Object.freeze({
  small: {
    seed: 42,
    streams: 8,
    stream_minutes: 120,
    days_between_streams: 1,
    audience: { mean_concurrent: 6, mean_dwell_minutes: 25, return_probability: 0.35 },
    behaviour: {
      chat_per_minute: 0.1,
      follow_probability: 0.08,
      claim_bonus_probability: 0.5,
      redeem_probability_per_minute: 0.01,
      first_cheer_probability: 0.01,
      first_gift_probability: 0.003,
      sub_share: { tier1: 0.03, tier2: 0, tier3: 0 },
    },
    raids: { per_stream_probability: 0.1, viewers_mean: 15, dwell_minutes: 10 },
    predictions: { per_stream: 2, outcomes: 2, window_seconds: 180, participation: 0.4, farm_participation: 0, stake_fraction: 0.25, cancel_probability: 0.05, no_winner_rule: "burn" },
    rewards: [
      { title: "Hydrate", cost: 500 },
      { title: "Pick the next theme", cost: 2500 },
      { title: "Shoutout", cost: 10000 },
    ],
    farm: { agents: 0, chat_per_minute: 1 },
    token: { emission_per_stream: 10_000, weights: { watch_minute: 1, chat: 5 } },
  },
});

function merge(base, over) {
  if (Array.isArray(base) || Array.isArray(over) || typeof over !== "object" || over === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = typeof base?.[k] === "object" && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  return out;
}

const positive = (v, name) => {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} must be a positive number`);
};
const probability = (v, name) => {
  if (!Number.isFinite(v) || v < 0 || v > 1) throw new RangeError(`${name} must be between 0 and 1`);
};

export function resolveParams(overrides = {}, preset = "small") {
  if (!PRESETS[preset]) throw new RangeError(`unknown preset ${preset}`);
  const p = merge(structuredClone(PRESETS[preset]), overrides);
  positive(p.streams, "streams");
  positive(p.audience.mean_concurrent, "audience.mean_concurrent");
  positive(p.audience.mean_dwell_minutes, "audience.mean_dwell_minutes");
  if (!Number.isInteger(p.stream_minutes) || p.stream_minutes < EARN.streak_min_stream_minutes) {
    throw new RangeError(`stream_minutes must be an integer >= ${EARN.streak_min_stream_minutes} (watch streaks need it)`);
  }
  if (p.days_between_streams * 1440 < EARN.streak_min_gap_minutes) throw new RangeError("streams must be at least 30 minutes apart");
  for (const [k, v] of Object.entries({ ...p.behaviour, sub_share: undefined })) if (k !== "sub_share") probability(v, `behaviour.${k}`);
  probability(p.audience.return_probability, "audience.return_probability");
  for (const k of ["participation", "farm_participation", "stake_fraction", "cancel_probability"]) probability(p.predictions[k], `predictions.${k}`);
  if (p.predictions.outcomes < PREDICTION.min_outcomes || p.predictions.outcomes > PREDICTION.max_outcomes) throw new RangeError("predictions.outcomes must be 2 to 10");
  if (p.predictions.window_seconds < PREDICTION.min_window_seconds || p.predictions.window_seconds > PREDICTION.max_window_seconds) throw new RangeError("predictions.window_seconds must be 30 to 1800");
  if (!["burn", "refund"].includes(p.predictions.no_winner_rule)) throw new RangeError("predictions.no_winner_rule must be burn or refund");
  if (!Array.isArray(p.rewards) || p.rewards.length > MAX_CUSTOM_REWARDS || p.rewards.some((r) => !Number.isInteger(r.cost) || r.cost < 1)) {
    throw new RangeError(`rewards must be at most ${MAX_CUSTOM_REWARDS} with positive integer costs`);
  }
  if (!Number.isInteger(p.farm.agents) || p.farm.agents < 0) throw new RangeError("farm.agents must be a non-negative integer");
  return p;
}

/** Turn `npm run timeline -- summary --json` into overrides, and say which fields came from data. */
export function calibrationFrom(summary) {
  const overrides = {};
  const used = [];
  const s = summary?.stream;
  if (s?.avg_viewers > 0) {
    overrides.audience = { mean_concurrent: s.avg_viewers };
    used.push("audience.mean_concurrent <- stream.avg_viewers");
  }
  if (s?.sessions > 0 && s.live_minutes >= EARN.streak_min_stream_minutes * s.sessions) {
    overrides.stream_minutes = Math.round(s.live_minutes / s.sessions);
    used.push("stream_minutes <- stream.live_minutes / stream.sessions");
  }
  if (summary?.chat?.per_live_minute >= 0 && s?.avg_viewers > 0) {
    overrides.behaviour = { chat_per_minute: Math.min(1, summary.chat.per_live_minute / s.avg_viewers) };
    used.push("behaviour.chat_per_minute <- chat.per_live_minute / stream.avg_viewers");
  }
  return { overrides, used };
}

export function simulate(params) {
  const seed = params.seed >>> 0;
  const audience = simulateAudience(params, seed);
  const humans = audience.viewers.filter((v) => !v.farm);
  const perStream = audience.streams.map((stream) => {
    const counts = stream.minutes.map((m) => m.present.filter((id) => !audience.viewers[id].farm).length);
    return { average: counts.reduce((s, c) => s + c, 0) / counts.length, peak: Math.max(...counts), unique: stream.attended.filter((id) => !audience.viewers[id].farm).length };
  });
  return {
    seed,
    params,
    audience: {
      streams: audience.streams.length,
      unique_viewers: humans.length,
      average_concurrent: Math.round((perStream.reduce((s, x) => s + x.average, 0) / perStream.length) * 10) / 10,
      peak_concurrent: Math.max(...perStream.map((x) => x.peak)),
      chats: audience.streams.reduce((s, st) => s + st.minutes.reduce((t, m) => t + m.chats.filter((id) => !audience.viewers[id].farm).length, 0), 0),
    },
    world_a: { label: WORLD_A_LABEL, ...runPointsWorld(audience, params, (seed + 0x9e3779b9) >>> 0) },
    world_b: runTokenWorld(audience, params),
    notes: [
      "Presets are illustrative and uncalibrated unless calibrated_from lists fields.",
      "Prediction participants are the viewers present when it opens; outcomes are picked uniformly.",
      "[VERIFY] What Twitch does when nobody picked the winning outcome (predictions.no_winner_rule).",
      WORLD_B_LABEL,
    ],
  };
}
