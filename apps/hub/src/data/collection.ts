// Season-record presentation. Format checks do not establish chain inclusion, funding or collection authority.
import { decodeBase58 } from "../../../../src/core/base58.js";
import { seasonPhase } from "./season";
import type { HubSnapshot, PastSeason, RewardState } from "./types";

const U64_MAX = (1n << 64n) - 1n;
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function pointsShare(points: number, eligiblePoints: number): string | null {
  if (!count(points) || !count(eligiblePoints) || points === 0 || eligiblePoints === 0 || points > eligiblePoints) return null;
  const hundredths = BigInt(points) * 10_000n / BigInt(eligiblePoints);
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}%`;
}

export function recordFormatValid(last: PastSeason): boolean {
  if (!Number.isSafeInteger(last.number) || last.number < 1 || !count(last.players) || !count(last.eligiblePoints)) return false;
  if (last.me && (!count(last.me.points) || last.me.points > last.eligiblePoints || !Number.isSafeInteger(last.me.rank) || last.me.rank < 1)) return false;
  const r = last.reward;
  if (!r || typeof r !== "object") return false;
  if (r.kind === "provisional" || r.kind === "finalized") return !("root" in r || "anchorTx" in r || "pool" in r);
  if (!["anchored", "funded", "claimable"].includes(r.kind) || !("root" in r) || typeof r.root !== "string" || !/^[0-9a-f]{64}$/.test(r.root) || typeof r.anchorTx !== "string" || r.anchorTx.length > 88) return false;
  try { if (decodeBase58(r.anchorTx).length !== 64) return false; } catch { return false; }
  if ((r.kind === "funded" || r.kind === "claimable") && !("pool" in r)) return false;
  if (r.kind === "anchored" && "pool" in r) return false;
  if ("pool" in r) {
    const p = r.pool;
    if (!p || typeof p !== "object" || typeof p.baseUnits !== "bigint" || p.baseUnits <= 0n || p.baseUnits > U64_MAX || !["SOL", "USDC"].includes(p.asset) || p.decimals !== (p.asset === "SOL" ? 9 : 6)) return false;
  }
  return true;
}

export function rewardSummary(reward: RewardState): { label: string; text: string } {
  switch (reward.kind) {
    case "provisional": return { label: "Results pending", text: "A final record has not been published for this season." };
    case "finalized": return { label: "Points frozen", text: "Final points are recorded. A Solana anchor has not been published." };
    case "anchored": return { label: "Board anchored", text: "The season record includes a Solana anchor. Inclusion does not prove that perks are funded." };
    case "funded":
    case "claimable": return { label: "Perks funded", text: "Funding is recorded for this season. Collecting is not available in this hub yet." };
  }
}

export function collectionSummary(snapshot: HubSnapshot | null, now: number) {
  const last = snapshot?.lastSeason;
  if (last) return recordFormatValid(last) ? rewardSummary(last.reward) : { label: "Record unavailable", text: "The season record has inconsistent fields. Refresh to check again." };
  const season = snapshot?.season;
  if (!season) return { label: "No season record yet", text: "The next season appears here when its schedule is published." };
  switch (seasonPhase(season, now)) {
    case "upcoming": return { label: `Season ${season.number} is up next`, text: "Your season record starts when you join and play." };
    case "open": return season.poll?.placeholder
      ? { label: `Season ${season.number} is a sample`, text: "Today's poll is a placeholder. This is not a live scored season." }
      : { label: `Season ${season.number} is still open`, text: season.me ? `You have ${season.me.points} points so far. Final results appear after the season closes.` : "Join free and do activities on this site. Final results appear after the season closes." };
    case "closed": return { label: `Season ${season.number} is closed`, text: "Its final record has not been published yet." };
  }
}
