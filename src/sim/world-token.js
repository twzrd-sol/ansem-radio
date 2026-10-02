/**
 * World B: a hypothetical off-platform token, modelled only. It reads the
 * audience record and its own parameters, never World A: it is not funded by,
 * convertible from, or priced in Channel Points, Predictions or Bits (Twitch's
 * Channel Points policy). A live version would be watch- or chat-to-earn, which
 * is outside this public release; this module is strictly offline.
 */

import { gini, topShare } from "./world-points.js";

export const WORLD_B_LABEL =
  "HYPOTHETICAL. Watch/chat-to-earn is forbidden by AGENTS.md; a live version needs a dated operator decision and counsel. Never funded by or convertible from Channel Points, Predictions or Bits.";

/** Emission rule: a fixed amount per stream, pro rata to watch minutes and chats. */
export function runTokenWorld(audience, params) {
  const t = params.token;
  const balance = new Map();
  let emitted = 0;
  for (const stream of audience.streams) {
    const score = new Map();
    for (const minute of stream.minutes) {
      for (const id of minute.present) score.set(id, (score.get(id) ?? 0) + t.weights.watch_minute);
      for (const id of minute.chats) score.set(id, (score.get(id) ?? 0) + t.weights.chat);
    }
    const total = [...score.values()].reduce((s, v) => s + v, 0);
    if (!total) continue;
    for (const [id, s] of score) {
      const amount = Math.floor((t.emission_per_stream * s) / total);
      balance.set(id, (balance.get(id) ?? 0) + amount);
      emitted += amount;
    }
  }
  const farmIds = new Set(audience.viewers.filter((v) => v.farm).map((v) => v.id));
  const farmTotal = [...balance].filter(([id]) => farmIds.has(id)).reduce((s, [, v]) => s + v, 0);
  const humans = audience.viewers.filter((v) => !v.farm).map((v) => balance.get(v.id) ?? 0);
  return {
    label: WORLD_B_LABEL,
    rule: "fixed emission per stream, pro rata to watch minutes and chats",
    emitted,
    farm_share: emitted ? Math.round((farmTotal / emitted) * 1000) / 1000 : 0,
    farm_agents: farmIds.size,
    gini: Math.round(gini(humans) * 1000) / 1000,
    top10_share: Math.round(topShare(humans, 0.1) * 1000) / 1000,
  };
}
