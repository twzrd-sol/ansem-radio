// Fixtures for design review (?preview=sample). Every screen that shows one carries a SAMPLE mark, and the
// today snapshot never imports this file's values. Names are fictional interface placeholders.
import type { FanPositions, Listing, ListingDetail, Market } from "./market";
import type { HubSnapshot } from "./types";

const DAY = 86_400_000;
const WEEK_SECONDS = 604_800n;

export const SAMPLE_WALLET = {
  address: "S7Ptm1BCKiFVmTx9SzHGkZifnScNY1rKBfUGNuj1h2MR",
  support: "Brg6YmRhaBBLYg485XcWWC7qPi2SQhZQJf2MK6rMAn8w",
  tx: "TpbFR3nDnztTjNhRPTmxwyYZc5WRSPhhMapLwMG9geyAvFBYruJgHuHV2riUxRH4QHwg5G8jSSZqrgvKaJZA3kcU",
  balanceBaseUnits: 1_000_000_000n,
};
/** A placeholder devnet test mint for the preview, shown unlinked with a SAMPLE mark. */
export const SAMPLE_MINT = "Mint7estRLAN1111111111111111111111111111111";
/** The sample backing position, in RLAN base units (6 decimals). */
export const SAMPLE_POSITION = 250_000_000n;

const SEASON = 12;
const ROOT = "bab0d0aabfc1703e20c7702f3aae46b4cbe47eaad8c39ae060a336636113a754";
/** Synthetic 64-byte signature for format-valid, unlinked SAMPLE displays. It is not a chain transaction. */
const ANCHOR_TX = "6pc4LiB8KHAPvbUbkozrTcPL5zXspYBdATv5raNDyVbhiKjrKokLb9o111kxTD5KkPVd7UBSCcFcnWFkrJ82Hu6";

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
}

export function buildSample(now: number = Date.now()): HubSnapshot {
  const opensAt = weekStart(now);
  return {
    scenario: "sample",
    season: {
      number: SEASON,
      opensAt,
      freezesAt: opensAt + 5 * DAY,
      players: 214,
      backers: 37,
      reward: { kind: "provisional" },
      policy: { dailyCap: 60, weeklyCap: 300, weights: { poll_response: 10, question: 20, accepted_work: 50 } },
      poll: { id: "thu-theme", question: "Theme for next Thursday's session?", options: ["Regional boom bap", "Producer cypher", "Deep-cut dig"] },
      prompt: "Name a producer the station should book for a live beat session, and say why.",
      board: [["crate_breed", 455], ["dusty_rhymes", 440], ["third_ear", 425], ["qwonbeat", 410], ["lyric_hazel", 380], ["bx_kydd", 365], ["soul_searching", 350], ["beatsbyzoe", 330], ["oldhead_lew", 315], ["listen_local", 300]],
      boardDetails: [
        { handle: "crate_breed", badges: ["first_play", "three_days"], streakDays: 4 },
        { handle: "dusty_rhymes", badges: ["first_play"], streakDays: 2 },
        { handle: "lyric_hazel", badges: ["first_play"], streakDays: 1 },
        { handle: "qwonbeat", badges: ["first_play", "three_days"], streakDays: 3 },
      ],
      me: { points: 230, rank: 18, streakDays: 3, today: 30, activityDays: 3, playedToday: true, badges: ["first_play", "three_days"], submissions: [{ action: "poll_response", status: "credited", pollId: "thu-theme" }, { action: "question", status: "credited" }] },
    },
    lastSeason: {
      number: SEASON - 1,
      players: 188,
      eligiblePoints: 9840,
      reward: { kind: "funded", root: ROOT, anchorTx: ANCHOR_TX, pool: { asset: "SOL", baseUnits: 800_000_000n, decimals: 9 } },
      me: { points: 312, rank: 21 },
      top: [["third_ear", 470], ["crate_breed", 462], ["lyric_hazel", 431]],
    },
    upcoming: [
      { slug: "jayro-verse", name: "Jayro Verse", style: "Underground boom bap", opens: "Thu 20:00 UTC" },
      { slug: "milake", name: "Milake", style: "Raw lyricist, live band", opens: "Fri 18:00 UTC" },
    ],
    fan: { handle: "crate_digger_07", since: 10, badges: ["first_play", "three_days"], activityDays: 3, playedToday: true, streakDays: 3 },
    history: [
      { season: 11, points: 312, rank: 21, players: 188, eligiblePoints: 9840, reward: { kind: "funded", root: ROOT, anchorTx: ANCHOR_TX, pool: { asset: "SOL", baseUnits: 800_000_000n, decimals: 9 } } },
      { season: 10, points: 145, rank: 64, players: 120, eligiblePoints: 6210, reward: { kind: "anchored", root: ROOT, anchorTx: ANCHOR_TX } },
    ],
    // Weekly on-chain seasons that started on a Monday, so this week is on-chain season 12.
    arena: { seasonStart: BigInt(Math.floor(opensAt / 1000)) - BigInt(SEASON - 1) * WEEK_SECONDS, seasonSeconds: WEEK_SECONDS },
  };
}

/** Fictional listings for the board, marked DEMO and SAMPLE wherever they show. Keys are placeholders, never real. */
const SAMPLE_STREAMER = "Samp1eStreamer1111111111111111111111111111111";
const SAMPLE_ARENA = "Samp1eArena11111111111111111111111111111111";
const perf = (live: boolean, viewers: number | null, game: string | null, at: string) => ({ live, viewers, game, startedAt: live ? at : null, rank: live ? 1 : null, deltaViewers: live ? 120 : null, provenance: `Data: Twitch. Recorded by radiolanlive at ${at}.` });
function sampleHistory(now: number, totals: number[]) {
  return totals.map((total, i) => ({ at: new Date(now - (totals.length - 1 - i) * 6 * 3_600_000).toISOString(), slot: 500_000 + i * 100, total: String(total * 1_000_000), backers: String(10 + i), requested: i % 3 === 0 ? 1 : 0 }));
}
function sampleListings(now: number): Listing[] {
  const at = new Date(now - 60_000).toISOString();
  const opensAt = weekStart(now);
  const arena = (address: string, total: number, backers: number, requested: number, netFlow: number) => ({ address, streamer: SAMPLE_STREAMER, mint: SAMPLE_MINT, decimals: 6, closed: false, seasonStart: String(Math.floor(opensAt / 1000)), seasonSeconds: "604800", season: "1", total: String(total * 1_000_000), backers: String(backers), requested, netFlow: String(netFlow * 1_000_000) });
  return [
    { slug: "radiolanlive", name: "Radio LAN", kind: "featured", demo: false, blurb: "The station that buys its next show.", twitch: "radiolanlive", keys: { streamer: SAMPLE_STREAMER, mint: SAMPLE_MINT }, backingOpen: true, arena: arena(SAMPLE_ARENA, 12_400, 37, 2, 850), performance: perf(false, null, null, at), history: sampleHistory(now, [9_800, 10_600, 11_100, 11_550, 12_400]) },
    { slug: "crate-breed", name: "Crate Breed", kind: "demo", demo: true, blurb: "Fictional creator: regional boom bap, Thursday nights.", twitch: null, keys: { streamer: SAMPLE_STREAMER, mint: SAMPLE_MINT }, backingOpen: true, arena: arena("Samp1eArena22222222222222222222222222222222", 4_210, 19, 0, -300), performance: null, history: sampleHistory(now, [4_510, 4_400, 4_300, 4_210, 4_210]) },
    { slug: "dusty-rhymes", name: "Dusty Rhymes", kind: "demo", demo: true, blurb: "Fictional creator: producer cyphers.", twitch: null, keys: { streamer: SAMPLE_STREAMER, mint: SAMPLE_MINT }, backingOpen: true, arena: arena("Samp1eArena33333333333333333333333333333333", 1_050, 6, 1, 1_050), performance: null, history: sampleHistory(now, [0, 250, 600, 900, 1_050]) },
    { slug: "ninja", name: "ninja", kind: "tracked", demo: false, blurb: null, twitch: "ninja", keys: null, backingOpen: false, arena: null, performance: perf(true, 18_240, "Fortnite", at) },
    { slug: "xqc", name: "xqc", kind: "tracked", demo: false, blurb: null, twitch: "xqc", keys: null, backingOpen: false, arena: null, performance: perf(false, null, null, at) },
  ];
}
export function sampleMarket(now: number = Date.now()): Market {
  return { network: "devnet", observedAt: new Date(now - 90_000).toISOString(), slot: 500_400, stale: false, generatedAt: Math.floor(now / 1000), listings: sampleListings(now), sample: true };
}
export function sampleListingDetail(now: number, slug: string): ListingDetail | null {
  const market = sampleMarket(now);
  const listing = market.listings.find((l) => l.slug === slug);
  return listing ? { ...market, listing } : null;
}
export function samplePositions(now: number = Date.now()): FanPositions {
  const market = sampleMarket(now);
  const schedule = { seasonStart: String(Math.floor(weekStart(now) / 1000)), seasonSeconds: "604800", closed: false };
  return {
    ...market,
    fan: SAMPLE_WALLET.address,
    positions: [
      { arena: SAMPLE_ARENA, address: "Samp1ePosition1111111111111111111111111111", state: "active", amount: String(SAMPLE_POSITION), requestedSeason: "0", openedAt: String(Math.floor(now / 1000) - 86_400), schedule, slug: "radiolanlive" },
      { arena: "Samp1eArena22222222222222222222222222222222", address: "Samp1ePosition2222222222222222222222222222", state: "requested", amount: "100000000", requestedSeason: "1", openedAt: String(Math.floor(now / 1000) - 2 * 86_400), schedule, slug: "crate-breed" },
    ],
  };
}
