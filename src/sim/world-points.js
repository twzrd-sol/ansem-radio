/**
 * World A: Twitch Channel Points, which have no monetary value (Channel Points
 * Acceptable Use Policy). Earning follows the published rates in twitch-points.js;
 * spending is custom rewards and predictions (proportionate share of the pool,
 * rounded down). Conservation is checked: minted - burned = sum of balances.
 */

import { createRng } from "./rng.js";
import { EARN, PREDICTION, streakBonus } from "./twitch-points.js";

/** A viewer's stake: a fraction of the balance, within Twitch's 10 to 250,000 points. 0 if they cannot stake. */
export function stakeFor(balance, fraction) {
  if (balance < PREDICTION.min_stake) return 0;
  return Math.min(PREDICTION.max_stake, Math.max(PREDICTION.min_stake, Math.floor(balance * fraction)), balance);
}

/**
 * Proportionate share of the whole pool for each winning stake, rounded down
 * ("Points round down"). Returns { payouts: Map, dust } with sum(payouts) + dust = pool.
 */
export function splitPool(winningStakes, poolTotal) {
  const winning = [...winningStakes.values()].reduce((sum, v) => sum + v, 0);
  const payouts = new Map();
  if (winning === 0) return { payouts, dust: poolTotal };
  let paid = 0;
  for (const [id, stake] of winningStakes) {
    const share = Math.floor((stake * poolTotal) / winning);
    payouts.set(id, share);
    paid += share;
  }
  return { payouts, dust: poolTotal - paid };
}

export function runPointsWorld(audience, params, seed) {
  const rng = createRng(seed);
  const p = params.predictions;
  const balance = new Map();
  const minted = { watch: 0, bonus: 0, follow: 0, raid: 0, streak: 0, first_cheer: 0, first_gift: 0 };
  const burned = { rewards: 0, prediction_rounding: 0, prediction_no_winner: 0 };
  const watched = new Map();
  const streak = new Map();
  const lastStream = new Map();
  const participated = new Set();
  const lastFirstCheer = new Map();
  const lastFirstGift = new Map();
  // "per 30 days": streams are params.days_between_streams apart.
  const once30 = (map, id, index) => {
    const last = map.get(id);
    if (last !== undefined && (index - last) * params.days_between_streams < 30) return false;
    map.set(id, index);
    return true;
  };
  const predictionLog = [];
  let maxStake = 0;

  const add = (id, source, points) => {
    if (points <= 0) return;
    balance.set(id, (balance.get(id) ?? 0) + points);
    minted[source] += points;
  };
  const take = (id, points) => {
    const have = balance.get(id) ?? 0;
    if (points > have || points < 0) throw new Error("negative balance");
    balance.set(id, have - points);
  };

  for (const stream of audience.streams) {
    const raidAt = new Map(stream.events.raidJoins.map((e) => [e.id, e.minute]));
    const followAt = new Map(stream.events.follows.map((e) => [e.id, e.minute]));
    const cheerAt = new Map(stream.events.firstCheers.map((e) => [e.id, e.minute]));
    const giftAt = new Map(stream.events.firstGifts.map((e) => [e.id, e.minute]));
    const seen = new Set();
    const predictionMinutes = new Set(Array.from({ length: p.per_stream }, (_, i) => Math.floor(((i + 1) * stream.length) / (p.per_stream + 1))));
    const windowMinutes = Math.max(1, Math.round(p.window_seconds / 60));
    const openPredictions = [];

    stream.minutes.forEach((minute, m) => {
      for (const id of minute.present) {
        const viewer = audience.viewers[id];
        if (!seen.has(id)) {
          seen.add(id);
          // Watch streak: consecutive streams, each long enough (stream_minutes >= 10 is checked by the preset).
          const s = lastStream.get(id) === stream.index - 1 ? (streak.get(id) ?? 1) + 1 : 1;
          streak.set(id, s);
          lastStream.set(id, stream.index);
          add(id, "streak", streakBonus(s));
          if (raidAt.has(id)) add(id, "raid", EARN.raid);
        }
        if (followAt.get(id) === m) add(id, "follow", EARN.follow);
        if (cheerAt.get(id) === m && once30(lastFirstCheer, id, stream.index)) add(id, "first_cheer", EARN.first_cheer);
        if (giftAt.get(id) === m && once30(lastFirstGift, id, stream.index)) add(id, "first_gift", EARN.first_gift);
        const w = (watched.get(id) ?? 0) + 1;
        watched.set(id, w);
        if (w % EARN.watch_every_minutes === 0) add(id, "watch", Math.floor(EARN.watch_points * EARN.sub_multiplier[viewer.subTier]));
        if (w % EARN.bonus_every_minutes === 0 && (viewer.farm || rng.chance(params.behaviour.claim_bonus_probability))) add(id, "bonus", EARN.bonus_points);
        // Custom rewards: a present viewer sometimes redeems something affordable.
        if (params.rewards.length && rng.chance(viewer.farm ? 0 : params.behaviour.redeem_probability_per_minute)) {
          const affordable = params.rewards.filter((r) => r.cost <= (balance.get(id) ?? 0));
          if (affordable.length) {
            const reward = rng.pick(affordable);
            take(id, reward.cost);
            burned.rewards += reward.cost;
            participated.add(id);
          }
        }
      }

      if (predictionMinutes.has(m)) {
        const pool = { outcomes: Array.from({ length: p.outcomes }, () => new Map()), closesAt: m + windowMinutes, total: 0 };
        for (const id of minute.present) {
          const viewer = audience.viewers[id];
          const have = balance.get(id) ?? 0;
          if (have < PREDICTION.min_stake || !rng.chance(viewer.farm ? p.farm_participation : p.participation)) continue;
          const stake = stakeFor(have, p.stake_fraction);
          if (stake === 0) continue;
          take(id, stake);
          maxStake = Math.max(maxStake, stake);
          pool.outcomes[rng.int(p.outcomes)].set(id, stake);
          pool.total += stake;
          participated.add(id);
        }
        openPredictions.push(pool);
      }
      for (const pool of openPredictions.filter((x) => x.closesAt === m || (m === stream.length - 1 && x.closesAt > m))) {
        openPredictions.splice(openPredictions.indexOf(pool), 1);
        resolve(pool);
      }
    });
    for (const pool of openPredictions.splice(0)) resolve(pool);
  }

  function resolve(pool) {
    if (pool.total === 0) return;
    if (rng.chance(params.predictions.cancel_probability)) {
      for (const outcome of pool.outcomes) for (const [id, stake] of outcome) balance.set(id, balance.get(id) + stake);
      predictionLog.push({ pool: pool.total, status: "canceled" });
      return;
    }
    const winner = pool.outcomes[rng.int(pool.outcomes.length)];
    const winningStake = [...winner.values()].reduce((sum, v) => sum + v, 0);
    if (winningStake === 0) {
      if (params.predictions.no_winner_rule === "refund") {
        for (const outcome of pool.outcomes) for (const [id, stake] of outcome) balance.set(id, balance.get(id) + stake);
      } else {
        burned.prediction_no_winner += pool.total;
      }
      predictionLog.push({ pool: pool.total, status: "no_winner" });
      return;
    }
    const { payouts, dust } = splitPool(winner, pool.total);
    for (const [id, share] of payouts) balance.set(id, balance.get(id) + share);
    burned.prediction_rounding += dust;
    predictionLog.push({ pool: pool.total, status: "resolved" });
  }

  const totalMinted = Object.values(minted).reduce((s, v) => s + v, 0);
  const totalBurned = Object.values(burned).reduce((s, v) => s + v, 0);
  const totalBalances = [...balance.values()].reduce((s, v) => s + v, 0);
  if (totalMinted - totalBurned !== totalBalances) throw new Error("points not conserved");
  if ([...balance.values()].some((v) => v < 0)) throw new Error("negative balance");

  const humans = audience.viewers.filter((v) => !v.farm).map((v) => balance.get(v.id) ?? 0);
  return {
    minted_by_source: minted,
    burned_by_sink: burned,
    minted: totalMinted,
    burned: totalBurned,
    outstanding: totalBalances,
    velocity: totalMinted ? round(totalBurned / totalMinted, 3) : 0,
    gini: round(gini(humans), 3),
    top10_share: round(topShare(humans, 0.1), 3),
    participation_share: round(participated.size / Math.max(1, audience.viewers.filter((v) => !v.farm).length), 3),
    farm_points_share: round(shareOf(audience.viewers.filter((v) => v.farm).map((v) => balance.get(v.id) ?? 0), totalBalances), 3),
    predictions: { count: predictionLog.length, resolved: predictionLog.filter((x) => x.status === "resolved").length, canceled: predictionLog.filter((x) => x.status === "canceled").length, no_winner: predictionLog.filter((x) => x.status === "no_winner").length, average_pool: predictionLog.length ? Math.round(predictionLog.reduce((s, x) => s + x.pool, 0) / predictionLog.length) : 0, max_stake: maxStake },
  };
}

export function gini(values) {
  const v = values.filter((x) => x >= 0).sort((a, b) => a - b);
  const n = v.length;
  const total = v.reduce((s, x) => s + x, 0);
  if (n === 0 || total === 0) return 0;
  let weighted = 0;
  v.forEach((x, i) => {
    weighted += (i + 1) * x;
  });
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

export function topShare(values, fraction) {
  const v = [...values].sort((a, b) => b - a);
  const total = v.reduce((s, x) => s + x, 0);
  if (!total) return 0;
  const k = Math.max(1, Math.ceil(v.length * fraction));
  return v.slice(0, k).reduce((s, x) => s + x, 0) / total;
}

const shareOf = (part, total) => (total ? part.reduce((s, x) => s + x, 0) / total : 0);
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;
