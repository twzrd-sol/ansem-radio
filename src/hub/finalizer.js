/**
 * The season finalizer (sprint zero-to-one, slice B). When a points season's endsAt passes, it freezes the
 * provisional scores once to RADIOLAN_HUB_DIR/seasons/<season>.json: the ranked handles and points, the policy, and
 * the counts. The file is labelled "provisional, not a settlement": no creator key signs on the station, so it is
 * a recap fans can read, not a root anything pays against. A frozen file is never rewritten. On start, a season whose
 * end has passed with no frozen file is frozen at once (restart catch-up); otherwise one timer fires at the end.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FROZEN_LABEL = "provisional, not a settlement";
const MAX_TIMER_MS = 2 ** 31 - 1; // setTimeout's ceiling; a later end re-arms

/** The ranked recap of one season from its credited submissions; handles only, never account ids. */
export function recapOf({ config, submissions, rank, handleOf, frozenAt }) {
  const rows = submissions.filter((s) => s.season === config.season);
  const credited = rows.filter((s) => s.status === "credited" && s.occurredAt < config.endsAt);
  const ranked = rank(credited);
  const total = ranked.reduce((sum, [, p]) => sum + p, 0n);
  return {
    v: 1,
    label: FROZEN_LABEL,
    signed: false,
    network: config.network,
    arena: config.arena,
    season: config.season,
    startsAt: config.startsAt,
    endsAt: config.endsAt,
    frozenAt,
    policy: config.policy,
    players: new Set(rows.map((s) => s.accountId)).size,
    credited: credited.length,
    pendingAtClose: rows.filter((s) => s.status === "pending").length,
    totalPoints: total.toString(),
    scores: ranked.map(([accountId, points], i) => ({ rank: i + 1, handle: handleOf(accountId), points: points.toString() })),
  };
}

export const seasonPath = (dir, season) => join(dir, "seasons", `${season}.json`);

export function readFrozen(dir, season) {
  const path = seasonPath(dir, season);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function createSeasonFinalizer({ config = null, seasons = null, store, dir = store.dir, rank, handleOf, now = () => Math.floor(Date.now() / 1000), schedule = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t), log = console }) {
  if (!config && !seasons) throw new TypeError("a season config is required");
  // A fixed config is the one-season case of the rollover helper: nothing after it.
  const known = seasons ?? { at: () => config, endedBefore: (seconds) => (seconds >= config.endsAt ? [config] : []) };
  mkdirSync(join(dir, "seasons"), { recursive: true, mode: 0o700 });
  let timer = null;

  /** Freeze every ended season that has no frozen file yet. Returns the last recap written, or null. */
  const freeze = () => {
    let wrote = null;
    for (const c of known.endedBefore(now())) {
      const path = seasonPath(dir, c.season);
      if (existsSync(path)) continue;
      const recap = recapOf({ config: c, submissions: store.submissions(), rank: (credited) => rank(credited, c), handleOf, frozenAt: now() });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(recap, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, path);
      log.info?.(`season ${c.season}: frozen (${recap.scores.length} ranked, ${recap.totalPoints} points), ${FROZEN_LABEL}`);
      wrote = recap;
    }
    return wrote;
  };

  // Freeze what has ended, then wait for the end of the season in force; the timer firing re-arms for the next one.
  const arm = () => {
    freeze();
    const current = known.at(now());
    if (now() >= current.endsAt) return;
    const ms = Math.min((current.endsAt - now()) * 1000, MAX_TIMER_MS);
    timer = schedule(() => {
      timer = null;
      try {
        arm();
      } catch (error) {
        log.warn?.(`season ${known.at(now()).season}: freeze failed: ${error?.message ?? error}`);
      }
    }, ms);
  };

  return {
    start() {
      try {
        arm();
      } catch (error) {
        log.warn?.(`season ${known.at(now()).season}: freeze failed: ${error?.message ?? error}`);
      }
    },
    stop() {
      if (timer) cancel(timer);
      timer = null;
    },
    freeze,
    frozen: () => readFrozen(dir, known.at(now()).season),
  };
}
