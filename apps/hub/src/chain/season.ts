// The arena program's schedule, as src/sinks/arena.js computes it (seasonIndex, withdrawAvailableAt).
// Seconds, BigInt. A season is whatever length the arena stored (60 s to 28 days), never a calendar week.

export const MIN_SEASON_SECONDS = 60n;
export const MAX_SEASON_SECONDS = 28n * 86_400n;

export interface ArenaSchedule {
  /** `season_start` from the arena account, unix seconds. */
  seasonStart: bigint;
  /** `season_seconds` from the arena account. */
  seasonSeconds: bigint;
}

/** 0 before the start, then 1 + one per season. */
export function seasonIndex(seasonStart: bigint, seasonSeconds: bigint, now: bigint): bigint {
  if (now < seasonStart || seasonSeconds === 0n) return 0n;
  return 1n + (now - seasonStart) / seasonSeconds;
}

/** A request made in season `requestedSeason` is available at the start of the next season. */
export function withdrawAvailableAt(seasonStart: bigint, seasonSeconds: bigint, requestedSeason: bigint): bigint {
  return seasonStart + requestedSeason * seasonSeconds;
}

/**
 * The most recent Monday 00:00 UTC at or before `now`: the season start the mainnet arena convention uses
 * (docs/examples/arena-mainnet/INIT.md), so a 7-day season rolls over on Monday. Unix day 0 was a Thursday.
 */
export function mostRecentMondayUtc(now: bigint): bigint {
  const day = now / 86_400n;
  const sinceMonday = (day + 3n) % 7n;
  return (day - sinceMonday) * 86_400n;
}

export const nowSeconds = (): bigint => BigInt(Math.floor(Date.now() / 1000));

/** When a withdrawal requested at `now` becomes available, in milliseconds. */
export function releaseIfRequestedAt(schedule: ArenaSchedule, now: bigint = nowSeconds()): number {
  const index = seasonIndex(schedule.seasonStart, schedule.seasonSeconds, now);
  return Number(withdrawAvailableAt(schedule.seasonStart, schedule.seasonSeconds, index)) * 1000;
}

export const currentSeason = (schedule: ArenaSchedule, now: bigint = nowSeconds()): bigint =>
  seasonIndex(schedule.seasonStart, schedule.seasonSeconds, now);
