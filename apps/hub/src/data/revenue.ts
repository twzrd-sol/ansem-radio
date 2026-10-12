// Honest Solana revenue facts for the hub frontpage. These flags stay closed until
// a tag-5 market is open and an $ICELAN vault exists. They do not open Collect.
import { CLAWPUMP_ORIGIN, CLAWPUMP_TOKEN_URL, ICELAN_MINT, RLAN_MINT } from "../chain/config";

export { CLAWPUMP_ORIGIN, CLAWPUMP_TOKEN_URL, ICELAN_MINT, RLAN_MINT };

/** Mainnet explorer only. These mints are not the build's rehearsal cluster. */
export const RLAN_EXPLORER_URL = `https://explorer.solana.com/address/${RLAN_MINT}`;
export const ICELAN_EXPLORER_URL = `https://explorer.solana.com/address/${ICELAN_MINT}`;

/** ClawPump published split (docs/STREAMER_MARKETS.md, 2026-09-30). Not a vault and not season points. */
export const CREATOR_SHARE_PERCENT = 75;
export const PLATFORM_SHARE_PERCENT = 25;

export const ICELAN_VAULT_CREATED = true;
export const COLLECT_OPEN = false;
export const TAG5_MARKET_OPEN = false;

export const REVENUE = Object.freeze({
  eyebrow: "Solana",
  title: "Fees and tokens, as they are",
  lede: "Creator share, $RLAN links, and the $ICELAN vault. The locker stays closed. Recorded now. Check Collect for claim availability.",
  strip: Object.freeze(["Locker closed", "Initial vault funding: 100,000 ICELAN", "Check Collect for availability"] as const),
  creator: Object.freeze({
    title: "Creator share",
    status: "On ClawPump",
    kind: "live" as const,
    text: `ClawPump's token fees split ${CREATOR_SHARE_PERCENT} percent creator share and ${PLATFORM_SHARE_PERCENT} percent platform. That share is not season points and does not open the locker.`,
  }),
  rlan: Object.freeze({
    title: "$RLAN",
    status: "Mint live",
    kind: "live" as const,
    text: "$RLAN is Radio LAN's token. It is for future programming, not this season's points.",
  }),
  icelan: Object.freeze({
    title: "$ICELAN",
    status: "Recorded now",
    kind: "closed" as const,
    text: "The mainnet vault was funded with 100,000 ICELAN on October 7, 2026. Recorded now. Check Collect for claim availability. Season points are not $ICELAN.",
  }),
});
