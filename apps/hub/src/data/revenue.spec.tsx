import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ICELAN_MINT as CORE_ICELAN, RLAN_MINT as CORE_RLAN } from "../../../../src/hub/economy-budgets.js";
import { ICELAN_MINT, RLAN_MINT } from "../chain/config";
import { HowItWorks } from "../ui/HowItWorks";
import { LanCompanion } from "../ui/LanCompanion";
import { RevenueRail, RevenueStrip } from "../ui/RevenueRail";
import { Market } from "../screens/Market";
import type { Station } from "./station";
import {
  CLAWPUMP_TOKEN_URL,
  COLLECT_OPEN,
  CREATOR_SHARE_PERCENT,
  ICELAN_EXPLORER_URL,
  ICELAN_VAULT_CREATED,
  PLATFORM_SHARE_PERCENT,
  REVENUE,
  RLAN_EXPLORER_URL,
  TAG5_MARKET_OPEN,
} from "./revenue";

const station: Station = { status: "ready", live: false, observedAt: Date.parse("2026-10-07T00:00:00Z") };
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (el: ReactElement) => decode(html(el).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const money = /\b(pay|pays|paid|payout|payouts|payment|payments|earn|earns|earned|earning|money|claim|claims|claiming|claimable|pool|pools|price|prices|priced|trade|trades|trading|sell|sells|selling|stock|stocks)\b/i;

describe("honest Solana revenue facts", () => {
  it("pins the mainnet mints to the recorded economy addresses", () => {
    expect(RLAN_MINT).toBe(CORE_RLAN);
    expect(ICELAN_MINT).toBe(CORE_ICELAN);
    expect(CLAWPUMP_TOKEN_URL).toBe(`https://clawpump.tech/tokens/${RLAN_MINT}`);
    expect(RLAN_EXPLORER_URL).toBe(`https://explorer.solana.com/address/${RLAN_MINT}`);
    expect(ICELAN_EXPLORER_URL).toBe(`https://explorer.solana.com/address/${ICELAN_MINT}`);
  });

  it("keeps Collect and the tag-5 market closed while the vault is funded", () => {
    expect(ICELAN_VAULT_CREATED).toBe(true);
    expect(COLLECT_OPEN).toBe(false);
    expect(TAG5_MARKET_OPEN).toBe(false);
    expect(CREATOR_SHARE_PERCENT).toBe(75);
    expect(PLATFORM_SHARE_PERCENT).toBe(25);
  });

  it("renders the rail and strip without opening a vault or quoting $ICELAN as a market", () => {
    const rail = html(<RevenueRail />);
    const strip = text(<RevenueStrip />);
    const copy = text(<RevenueRail />);
    expect(strip).toContain("Locker closed");
    expect(strip).toContain("Initial vault funding: 100,000 ICELAN");
    expect(strip).toContain("Check Collect for availability");
    expect(copy).toContain(REVENUE.creator.text);
    expect(copy).toContain(REVENUE.rlan.text);
    expect(copy).toContain(REVENUE.icelan.text);
    expect(copy).toContain("Recorded now");
    expect(copy).toContain("On ClawPump");
    expect(rail).toContain(CLAWPUMP_TOKEN_URL);
    expect(rail).toContain(RLAN_EXPLORER_URL);
    expect(rail).toContain(ICELAN_EXPLORER_URL);
    expect(rail).toContain('href="#/claim"');
    expect(rail).not.toMatch(/<button/);
    expect(copy).not.toMatch(/vault is open|open for deposit|backing (adds|give|gives) points/i);
    expect(copy).not.toMatch(/\$ICELAN[^.]{0,80}\b(price|chart|worth|apy)\b/i);
    expect(copy).not.toMatch(/isn't created|isn't funded|not created|not funded/i);
    expect(money.exec(copy.replace(/Recorded now\. Check Collect for claim availability\.?/gi, " "))).toBeNull();
  });

  it("keeps the Discover page honest while the board is loading, failed, or empty", () => {
    const loading = text(<Market market={null} load="loading" onRetry={() => {}} station={station} now={station.observedAt!} />);
    const failed = text(<Market market={null} load="error" onRetry={() => {}} station={station} now={station.observedAt!} />);
    const empty = text(<Market market={{ network: "devnet", observedAt: null, slot: null, stale: false, generatedAt: 1, listings: [] }} load="ready" onRetry={() => {}} station={station} now={station.observedAt!} />);
    for (const page of [loading, failed, empty]) {
      expect(page).not.toMatch(/vault is open|open for deposit/i);
      expect(page).not.toMatch(/backing (adds|give|gives) points/i);
      expect(page).not.toMatch(/\$ICELAN[^.]{0,80}\b(price|chart|worth|apy)\b/i);
    }
    expect(empty).toContain("No channels match the current read yet.");
  });

  it("states the same honest story on How this works and in LAN's guide", () => {
    const guide = text(<HowItWorks />);
    expect(guide).toMatch(/2\u00d7 weight, within season caps/);
    expect(guide).toMatch(/Recorded now\. Check Collect for claim availability/);
    expect(guide).toMatch(/The mainnet vault was funded with 100,000 ICELAN on October 7, 2026/);
    const companion = text(<LanCompanion market={null} snapshot={null} now={station.observedAt!} ready={false} station={station} />);
    expect(companion).toMatch(/Support is open|Support isn't open/);
    expect(companion).toMatch(/Play is free/);
  });
});
