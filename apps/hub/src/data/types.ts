import type { ArenaSchedule } from "../chain/season";

/** "sample" renders fixtures for design review; "today" is the real state and never reads a fixture. */
export type Scenario = "sample" | "today";

/** Native arena activities only (#47). Nothing from Twitch is an action. */
export type Action = "poll_response" | "question" | "accepted_work";

/**
 * The season's published policy, exactly as settlement applies it (docs/ARENA_SEASONS_v0.md): points per action,
 * and caps on points per account per UTC day and per season, across all actions.
 */
export interface Policy {
  dailyCap: number;
  weeklyCap: number;
  weights: Record<Action, number>;
}

export interface Upcoming {
  slug: string;
  name: string;
  style: string;
  opens: string;
}

/** A pool whose tokens were seen in the payout account on chain. Never a projection. */
export interface FundedPool {
  asset: "SOL" | "USDC";
  baseUnits: bigint;
  decimals: number;
}

/**
 * Plan section 4: the interface shows exactly one of these per season, and never shows money before it
 * exists. Provisional while the season is open; claimable needs the pool payout program (P2).
 */
export type RewardState =
  | { kind: "provisional" }
  | { kind: "finalized" }
  | { kind: "anchored"; root: string; anchorTx: string }
  | { kind: "funded"; root: string; anchorTx: string; pool: FundedPool }
  | { kind: "claimable"; root: string; anchorTx: string; pool: FundedPool };

export const showsMoney = (reward: RewardState): reward is Extract<RewardState, { pool: FundedPool }> =>
  reward.kind === "funded" || reward.kind === "claimable";

export interface Standing {
  points: number;
  /** null until this fan has credited points. */
  rank: number | null;
  streakDays: number;
  /** Points awarded today (UTC), against the daily cap. */
  today: number;
  /** What this fan has sent this season; pending work waits for the streamer. */
  submissions: Array<{ action: Action; status: "credited" | "pending"; pollId?: string }>;
  badges?: Array<"first_play" | "three_days">;
}

export interface CurrentSeason {
  number: number;
  /** The points season from the season config (#47), in ms. */
  opensAt: number;
  freezesAt: number;
  players: number;
  backers: number;
  reward: RewardState;
  policy: Policy;
  /** One UTC-day poll; placeholders are visible but cannot earn points. */
  poll: { id: string; question: string; options: string[]; placeholder?: boolean } | null;
  prompt: string | null;
  /** Top accounts with credited provisional points; short pseudonymous handles only. */
  board: Array<[string, number]>;
  /** null until the fan joins. */
  me: Standing | null;
}

export interface PastSeason {
  number: number;
  players: number;
  eligiblePoints: number;
  reward: RewardState;
  me: { points: number; rank: number } | null;
  top: Array<[string, number]>;
}

export interface HistoryRow {
  season: number;
  points: number;
  rank: number;
  players: number;
  reward: RewardState;
  eligiblePoints: number;
}

export interface FanAccount {
  handle: string;
  since: number;
}

export interface HubSnapshot {
  scenario: Scenario;
  season: CurrentSeason | null;
  lastSeason: PastSeason | null;
  upcoming: Upcoming[];
  fan: FanAccount | null;
  history: HistoryRow[];
  /** The backing arena's schedule, read from its account; null while no arena exists. */
  arena: ArenaSchedule | null;
}
