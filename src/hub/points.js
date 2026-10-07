/**
 * Provisional points for an open season (docs/HUB_FRONTEND_PLAN.md section 4): native credits use the same rule `settleSeason` in
 * src/arena/season.js applies to creator-signed credits, applied here to the hub's unsigned submissions while the
 * season is open. Nothing here is a settlement: no signatures, no root, no allocation. test/hub-points.test.js
 * checks parity with settleSeason on the same native credits. Flagged Twitch marks are separate social scores;
 * they are not valid native settlement events or ICELAN claims.
 */
import { createHash } from "node:crypto";

export const ACTIONS = Object.freeze(["question", "poll_response", "accepted_work"]);
/** Site points only. Not a viewer count, a watch minute, or an $ICELAN emission. The hub rejects this action on the public submit route. */
export const TWITCH_POINT_ACTION = "twitch_mark";

/** Default off. `RADIOLAN_POINTS_TWITCH=1` is the kill switch the other way: unset means Twitch rows never score. */
export function twitchPointsEnabled(env = process.env) {
  return env.RADIOLAN_POINTS_TWITCH === "1";
}

/**
 * Rank accounts by provisional points: points desc, then the earlier first credit, then account id, so the order is
 * reproducible from the submissions alone. Accounts with no points are not ranked. Returns [accountId, points] pairs.
 */
export function rankAccounts(policy, credited, { twitch = false } = {}) {
  const { scores } = provisionalPoints(policy, credited, { twitch });
  const firstAt = new Map();
  for (const s of credited) {
    if (pointWeight(policy, s, twitch) === null) continue;
    if (!firstAt.has(s.accountId) || s.occurredAt < firstAt.get(s.accountId)) firstAt.set(s.accountId, s.occurredAt);
  }
  return [...scores].filter(([, p]) => p > 0n).sort(([a, pa], [b, pb]) => (pa === pb ? (firstAt.get(a) - firstAt.get(b)) || a.localeCompare(b) : pa > pb ? -1 : 1));
}

/** A stable 32-byte hex action id, so a resubmission is the same logical credit and never a second one. */
export function actionId(parts) {
  return createHash("sha256").update(parts.map(String).join("\n")).digest("hex");
}

/**
 * `credits`: `{ accountId, action, occurredAt, id }` rows, credited only. Returns per-account totals and the points
 * awarded today (UTC) per account, as BigInt. Order is event time, then id, as settlement sorts.
 */
function pointWeight(policy, credit, twitch) {
  if (credit.source === "twitch" || credit.action === TWITCH_POINT_ACTION) {
    if (!twitch || credit.action !== TWITCH_POINT_ACTION || credit.source !== "twitch") return null;
    if (credit.viewers != null || credit.minutes != null) return null;
    if (!Object.hasOwn(policy.weights ?? {}, TWITCH_POINT_ACTION)) return null;
    const weight = policy.weights[TWITCH_POINT_ACTION];
    if (!Number.isInteger(weight) || weight < 0) return null;
    return BigInt(weight);
  }
  return BigInt(policy.weights[credit.action]);
}

export function provisionalPoints(policy, credits, { now, twitch = false } = {}) {
  const sorted = [...credits].sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
  const scores = new Map();
  const daily = new Map();
  for (const e of sorted) {
    const weight = pointWeight(policy, e, twitch);
    if (weight === null) continue;
    const day = `${e.accountId}:${Math.floor(e.occurredAt / 86400)}`;
    const have = scores.get(e.accountId) ?? 0n;
    const today = daily.get(day) ?? 0n;
    const candidates = [weight, BigInt(policy.dailyCap) - today, BigInt(policy.weeklyCap) - have];
    const award = candidates.reduce((a, b) => (a < b ? a : b));
    scores.set(e.accountId, have + award);
    daily.set(day, today + award);
  }
  const todayKey = now === undefined ? null : Math.floor(now / 86400);
  const today = new Map();
  if (todayKey !== null) for (const [key, points] of daily) {
    const [accountId, day] = key.split(":");
    if (Number(day) === todayKey) today.set(accountId, points);
  }
  return { scores, today };
}
