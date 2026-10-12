import { RLAN_MINT } from "../chain/config";

export const RLAN_TOKEN_URL = `https://clawpump.tech/tokens/${RLAN_MINT}`;
export const BUY_RLAN_LINE = "Back a channel with $RLAN. Eligible Play credits count 2× while your linked position is active, within caps.";
export const HOW_TO_BUY = "How to buy: open ClawPump → swap SOL for RLAN → back the channel here";
export const HOW_TO_BUY_STEPS = [
  { n: "1", title: "Open ClawPump" },
  { n: "2", title: "Swap SOL for RLAN" },
  { n: "3", title: "Back the channel here" },
] as const;
export const BACKING_BOOST = "An active $RLAN position on your linked wallet gives eligible Play credits 2× weight, within published caps. ICELAN task rewards are separate.";
export const FOLLOWING_LOCAL = "Following lives in this browser and never credits ICELAN.";
export const ICELAN_BOOK_CAP = "The book caps at 100,000 ICELAN.";
export const VAULT_HOLDS = "The mainnet vault was funded with 100,000 ICELAN on October 7, 2026.";

export type StationClaim = "unavailable" | "season_end" | "task_book" | null | undefined;

export type ClaimsInput = {
  dayZero?: boolean;
  claimFlag?: boolean;
  stationClaim?: StationClaim;
};

export const dayZeroEnabled = (): boolean => import.meta.env.VITE_HUB_DAY_ZERO === "1";
/** Same flag #184 uses for the Collect claim control. */
export const icelanClaimEnabled = (): boolean => import.meta.env.VITE_HUB_ICELAN_CLAIM === "1";

/** Open only when both hub flags and the station task-book mode are on. */
export function icelanClaimsOpen(input: ClaimsInput = {}): boolean {
  const dayZero = input.dayZero ?? dayZeroEnabled();
  const claimFlag = input.claimFlag ?? icelanClaimEnabled();
  return dayZero === true && claimFlag === true && input.stationClaim === "task_book";
}

/** Fallback when end-to-end claim availability has not been established. Never promise a date or infer payout history. */
export const CLAIMS_OPEN_OFF = "Recorded now. Check Collect for claim availability.";
/** The same fallback on the Collect page itself, so it never tells a visitor to check the page they are on. */
export const CLAIMS_HERE_OFF = "Recorded now. ICELAN claims are not open on this page yet.";
export const ICELAN_COLLECT_OFF = `${CLAIMS_OPEN_OFF} ${VAULT_HOLDS}`;
export const HERO_HONEST_OFF = CLAIMS_OPEN_OFF;

/** Flag-on copy. Recorded ICELAN is claimable on the hub only when the triple is on. */
export const CLAIMS_OPEN_ON = "Recorded ICELAN can be claimed to your linked wallet on the hub.";

export const claimsStory = (input: ClaimsInput = {}): string => (icelanClaimsOpen(input) ? CLAIMS_OPEN_ON : CLAIMS_OPEN_OFF);
export const claimsOpenCopy = (input: ClaimsInput = {}): string => claimsStory(input);
/** Collect-page variant of claimsStory. */
export const claimsHereCopy = (input: ClaimsInput = {}): string => (icelanClaimsOpen(input) ? CLAIMS_OPEN_ON : CLAIMS_HERE_OFF);
export const icelanCollectCopy = (input: ClaimsInput | boolean = {}): string => {
  const open = typeof input === "boolean" ? input : icelanClaimsOpen(input);
  return open ? CLAIMS_OPEN_ON : ICELAN_COLLECT_OFF;
};
export const heroHonestCopy = (input: ClaimsInput = {}): string => (icelanClaimsOpen(input) ? CLAIMS_OPEN_ON : HERO_HONEST_OFF);

/** Default (flags off) aliases so closed-vault tests keep a stable phrase. */
export const CLAIMS_OPEN = CLAIMS_OPEN_OFF;
export const ICELAN_COLLECT = ICELAN_COLLECT_OFF;
export const HERO_HONEST = HERO_HONEST_OFF;

export const HERO_TITLE = "Play free every season. Back a channel with $RLAN.";
export const HERO_STORY = "Radio LAN is the station: free seasons for the streamers you watch, with AI agents in the room. $RLAN is its token, optional and separate from season points. Link Twitch and a wallet to record ICELAN task rewards. An active $RLAN position gives eligible Play credits 2× weight, within caps. ICELAN task rewards are separate.";
export const HERO_MISSION = "Mission: a creator economy where attention is rewarded transparently and on-chain.";
export const LISTING_POINTS_LINE = "Season points come from activities on this site and stay separate. An active $RLAN position on your linked wallet gives eligible Play credits 2× weight, within caps. ICELAN task rewards are separate.";

/** Owner-allowed ICELAN-task phrasing (2026-10-07). Other earn/claim/payout/price words stay banned. */
const ALLOWED_PUBLIC_MONEY = [
  /(?:record|records|recorded) ICELAN task rewards?/gi,
  /recorded as \$ICELAN/gi,
  /recorded now\. check collect for claim availability\.?/gi,
  /recorded now\. ICELAN claims are not open on this page yet\.?/gi,
  /recorded ICELAN can be claimed to your linked wallet on the hub\.?/gi,
  /(?:No )?earned badges(?: yet)?/gi,
] as const;

export function stripAllowedPublicMoney(text: string): string {
  return ALLOWED_PUBLIC_MONEY.reduce((s, re) => s.replace(re, " "), text);
}
