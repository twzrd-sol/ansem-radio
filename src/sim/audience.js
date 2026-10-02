/**
 * The audience: who is present each minute of each stream, and what they do that
 * both worlds can see (watching, chatting, following, raiding in, subscribing,
 * cheering, gifting). It draws from its own random stream, so the points and token
 * worlds cannot change who shows up.
 */

import { createRng } from "./rng.js";

/**
 * Returns { viewers, streams }. Each stream has minutes[] of { present: id[], chats: id[] }
 * plus per-stream event lists. Viewers carry fixed traits (sub tier, farm).
 */
export function simulateAudience(params, seed) {
  const rng = createRng(seed);
  const a = params.audience;
  const b = params.behaviour;
  const viewers = [];
  const newViewer = (traits = {}) => {
    const tierRoll = rng.next();
    const s = b.sub_share;
    const subTier = tierRoll < s.tier3 ? 3 : tierRoll < s.tier3 + s.tier2 ? 2 : tierRoll < s.tier3 + s.tier2 + s.tier1 ? 1 : 0;
    const viewer = { id: viewers.length, subTier, farm: false, raider: false, ...traits };
    viewers.push(viewer);
    return viewer;
  };
  const farm = Array.from({ length: params.farm.agents }, () => newViewer({ farm: true, subTier: 0 }));

  const streams = [];
  let previous = new Set();
  for (let s = 0; s < params.streams; s += 1) {
    const length = params.stream_minutes;
    const intenders = Math.max(1, Math.round((a.mean_concurrent * length) / a.mean_dwell_minutes));
    const returning = [...previous].filter((id) => !viewers[id].farm && !viewers[id].raider && rng.chance(a.return_probability));
    const fresh = Math.max(0, intenders - returning.length);
    const visits = [...returning.map((id) => viewers[id]), ...Array.from({ length: fresh }, () => newViewer())].map((viewer) => {
      const start = rng.int(length);
      return { viewer, start, end: Math.min(length, start + rng.exponential(a.mean_dwell_minutes)) };
    });
    const events = { follows: [], raidJoins: [], firstCheers: [], firstGifts: [] };
    if (rng.chance(params.raids.per_stream_probability)) {
      const at = rng.int(length);
      const size = Math.max(1, rng.poisson(params.raids.viewers_mean));
      for (let i = 0; i < size; i += 1) {
        const viewer = newViewer({ raider: true });
        visits.push({ viewer, start: at, end: Math.min(length, at + rng.exponential(params.raids.dwell_minutes)) });
        events.raidJoins.push({ id: viewer.id, minute: at });
      }
    }
    for (const viewer of farm) visits.push({ viewer, start: 0, end: length });

    const minutes = Array.from({ length }, () => ({ present: [], chats: [] }));
    for (const visit of visits) {
      for (let m = visit.start; m < visit.end; m += 1) {
        minutes[m].present.push(visit.viewer.id);
        const rate = visit.viewer.farm ? params.farm.chat_per_minute : b.chat_per_minute;
        if (rng.chance(Math.min(1, rate))) minutes[m].chats.push(visit.viewer.id);
      }
      const v = visit.viewer;
      if (!v.followed && (v.farm || rng.chance(b.follow_probability))) {
        v.followed = true;
        events.follows.push({ id: v.id, minute: visit.start });
      }
      if (!v.farm && rng.chance(b.first_cheer_probability)) events.firstCheers.push({ id: v.id, minute: visit.start });
      if (!v.farm && rng.chance(b.first_gift_probability)) events.firstGifts.push({ id: v.id, minute: visit.start });
    }
    const attended = new Set(visits.map((visit) => visit.viewer.id));
    streams.push({ index: s, length, minutes, events, attended: [...attended].sort((x, y) => x - y) });
    previous = attended;
  }
  return { viewers, streams };
}
