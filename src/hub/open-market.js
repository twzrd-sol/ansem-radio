/**
 * Streamer markets, opened by Radio LAN. Only `OPERATOR_OPENER`
 * (`CrgnT4wE3KAemXyUvHgMbXiTamHxgx8LEiPzstEYX7gY`) may open a market and pay its rent. Fans back it with the
 * ClawPump mint. Points are that market's own score. Twitch figures are not an input to either.
 * These builders match the published tag 5 `init_open_market` instruction.
 */
import { TRACKED_STREAMERS } from "../markets/twitch-metrics.js";
import { reservedSlug } from "./registry.js";
import { arenaAddress, initOpenMarketInstruction, openMarketAddress } from "../sinks/arena.js";
import { actionId, provisionalPoints } from "./points.js";

/** Radio LAN on pump.fun / ClawPump. Every permissionless market is this mint. */
export const RLAN_MINT = "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy";

const SLUG = /^[a-z0-9][a-z0-9_-]{1,31}$/;

function slugOf(login) {
  const slug = String(login).toLowerCase().replace(/_+$/, "") || String(login).toLowerCase();
  if (!SLUG.test(slug) || slug.length < 3 || reservedSlug(slug)) throw new TypeError(`open market: bad listing ${login}`);
  return slug;
}

/**
 * One market per tracked login. `backing` is the fan's RLAN position. `points` are a separate
 * score for that slug. Nothing here reads a viewer count.
 */
export function streamerMarkets(logins = TRACKED_STREAMERS) {
  return Object.freeze(logins.map((login) => {
    const slug = slugOf(login);
    const market = openMarketAddress(slug).address;
    const arena = arenaAddress(market, RLAN_MINT).address;
    return Object.freeze({
      slug,
      twitch: String(login).toLowerCase(),
      mint: RLAN_MINT,
      market,
      arena,
      backing: "rlan",
      points: "market",
      closeAuthority: null,
    });
  }));
}

/** The open instruction, pinned to the ClawPump mint. A different mint is refused. */
export function openStreamerMarketInstruction({ payer, slug, seasonStart, seasonSeconds, now, mint = RLAN_MINT }) {
  if (mint !== RLAN_MINT) throw new TypeError("a permissionless market is denominated in the ClawPump mint");
  return initOpenMarketInstruction({ payer, slug: slugOf(slug), mint, seasonStart, seasonSeconds, now });
}

/**
 * Points for one market. The same account on two markets does not share a total. A credit counts
 * only when `credit.market` is this slug. Scoring is the season rule: the action weight, then the
 * daily and weekly caps. Holding RLAN does not change the score.
 */
export function scoreMarket(policy, credits, market, now) {
  const slug = slugOf(market);
  const rows = credits.filter((credit) => credit.market === slug);
  return provisionalPoints(policy, rows, { now });
}

/** Action id for a market credit, so one answer on two listings is two credits. */
export function marketActionId(market, parts) {
  return actionId([slugOf(market), ...parts]);
}
