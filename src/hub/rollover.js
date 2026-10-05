/**
 * Season rollover. An arena's schedule recurs on chain (`arenaSeasonStart` plus whole multiples of
 * `arenaSeasonSeconds`), so the hub's points season can follow it with no restart and no new config file: given the
 * published config for one season, the season containing any later instant is the same config shifted by whole
 * seasons (number, startsAt, endsAt and claimDeadline together). Every derived config goes back through the strict
 * `normalizeConfig`, so a shifted window can never disagree with the arena's schedule.
 *
 * `recurring: false` keeps the old behaviour: the one published season, nothing after it.
 */
import { normalizeConfig } from "../arena/season.js";

const KEEP_ENDED = 8; // how many just-ended seasons catch-up will look back over

export function createSeasons(rawConfig, { recurring = true } = {}) {
  const base = normalizeConfig(rawConfig);
  const length = base.endsAt - base.startsAt;
  const cache = new Map([[0, base]]);

  const shifted = (k) => {
    if (!cache.has(k)) {
      cache.set(k, normalizeConfig({
        ...rawConfig,
        season: String(BigInt(rawConfig.season) + BigInt(k)),
        startsAt: rawConfig.startsAt + k * length,
        endsAt: rawConfig.endsAt + k * length,
        claimDeadline: rawConfig.claimDeadline + k * length,
      }));
      if (cache.size > 64) cache.delete(cache.keys().next().value);
    }
    return cache.get(k);
  };
  /** Whole seasons between the published one and the one containing `seconds` (0 before its end, or when not recurring). */
  const index = (seconds) => (recurring && seconds >= base.endsAt ? Math.floor((seconds - base.startsAt) / length) : 0);

  return {
    base,
    recurring,
    /** The season in force at `seconds`: the published one, or the recurring one that contains the instant. */
    at: (seconds) => shifted(index(seconds)),
    /** Seasons whose end has passed by `seconds`, oldest first, at most KEEP_ENDED back from the current one. */
    endedBefore(seconds) {
      if (seconds < base.endsAt) return [];
      if (!recurring) return [base];
      const current = index(seconds);
      const out = [];
      for (let k = Math.max(0, current - KEEP_ENDED); k < current; k += 1) out.push(shifted(k));
      return out;
    },
  };
}
