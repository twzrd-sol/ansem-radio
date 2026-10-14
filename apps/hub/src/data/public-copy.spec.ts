import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HubStory } from "../ui/HubStory";
import {
  CLAIMS_HERE_OFF,
  CLAIMS_OPEN,
  CLAIMS_OPEN_ON,
  HERO_HONEST,
  HERO_MISSION,
  HERO_STORY,
  HERO_TITLE,
  BUY_RLAN_LINE,
  HOW_TO_BUY,
  VAULT_HOLDS,
  claimsHereCopy,
  claimsOpenCopy,
  heroHonestCopy,
  icelanClaimsOpen,
  icelanCollectCopy,
  stripAllowedPublicMoney,
} from "./public-copy";

describe("public hub copy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the owner buy path and strips only the allowed ICELAN phrases", () => {
    expect(HOW_TO_BUY).toBe("How to buy: open ClawPump → swap SOL for RLAN → back the channel here");
    expect(HERO_TITLE).toBe("Follow the streamers you watch. Play free each season.");
    expect(HERO_TITLE).not.toMatch(/\$RLAN|back a channel/i);
    expect(HERO_STORY).not.toMatch(/ICELAN|\$RLAN/);
    expect(HERO_STORY).not.toMatch(/chat/i);
    expect(HERO_STORY).not.toMatch(/culture token/);
    expect(HERO_STORY).toContain("Radio LAN brings creators, fans, and AI agents");
    expect(HERO_STORY).toContain("take part in site activities");
    expect(HERO_STORY).not.toMatch(/2×/);
    expect(CLAIMS_HERE_OFF).not.toMatch(/Check Collect/);
    expect(claimsHereCopy()).toBe(CLAIMS_HERE_OFF);
    expect(claimsHereCopy({ dayZero: true, claimFlag: true, stationClaim: "task_book" })).toBe(CLAIMS_OPEN_ON);
    expect(BUY_RLAN_LINE).toContain("2×");
    expect(BUY_RLAN_LINE).toContain("2×");
    expect(HERO_STORY).not.toMatch(/next credit|link Twitch/i);
    expect(HERO_MISSION).toContain("attention is rewarded transparently and on-chain");
    expect(CLAIMS_OPEN).toBe("Recorded now. Check Collect for claim availability.");
    expect(VAULT_HOLDS).toBe("The mainnet vault was funded with 100,000 ICELAN on October 7, 2026.");
    expect(CLAIMS_OPEN).not.toMatch(/season end|nothing has been paid/i);
    expect(claimsOpenCopy()).toBe(CLAIMS_OPEN);
    expect(heroHonestCopy()).toBe(HERO_HONEST);
    expect(stripAllowedPublicMoney(`${HERO_STORY} ${CLAIMS_OPEN} ${CLAIMS_HERE_OFF} No earned badges yet`)).not.toMatch(/\b(earn|claims|earned|paid)\b/i);
    expect(stripAllowedPublicMoney("earn by watching")).toMatch(/earn by watching/i);
  });

  it("leads with free participation and separates points without promoting claims", () => {
    const html = renderToStaticMarkup(createElement(HubStory));
    expect(html).toContain(`<h1 class="h1" tabindex="-1">${HERO_TITLE}</h1>`);
    expect(html).toContain(`<p class="lede">${HERO_STORY}</p>`);
    expect(html).not.toMatch(/Back a channel with \$RLAN/);
    expect(html).toContain("do not convert to tokens");
    expect(html).not.toMatch(/Check Collect|100,000|can be claimed/);
    expect(html).not.toMatch(/chat/i);
  });

  it("keeps claims closed unless day-zero, the hub claim flag, and task_book are all on", () => {
    expect(icelanClaimsOpen()).toBe(false);
    expect(icelanClaimsOpen({ claimFlag: true, stationClaim: "task_book" })).toBe(false);
    expect(icelanClaimsOpen({ dayZero: true, stationClaim: "task_book" })).toBe(false);
    expect(icelanClaimsOpen({ dayZero: true, claimFlag: true, stationClaim: "season_end" })).toBe(false);
    expect(icelanClaimsOpen({ dayZero: true, claimFlag: true, stationClaim: "task_book" })).toBe(true);
    expect(heroHonestCopy()).toBe(CLAIMS_OPEN);
    expect(heroHonestCopy()).not.toMatch(/can be claimed/);
    expect(heroHonestCopy()).not.toMatch(/isn't created|isn't funded|not funded|not created/i);
  });

  it("says recorded ICELAN can be claimed only when the triple is on", () => {
    vi.stubEnv("VITE_HUB_DAY_ZERO", "1");
    vi.stubEnv("VITE_HUB_ICELAN_CLAIM", "1");
    expect(claimsOpenCopy()).toBe(CLAIMS_OPEN);
    expect(claimsOpenCopy({ stationClaim: "task_book" })).toBe(CLAIMS_OPEN_ON);
    expect(icelanCollectCopy({ stationClaim: "task_book" })).toBe(CLAIMS_OPEN_ON);
    expect(heroHonestCopy({ stationClaim: "task_book" })).toBe(CLAIMS_OPEN_ON);
    expect(heroHonestCopy({ stationClaim: "task_book" })).not.toMatch(/Nothing is sent to wallets now/);
    expect(stripAllowedPublicMoney(CLAIMS_OPEN_ON)).not.toMatch(/\bclaim/i);
  });
});
