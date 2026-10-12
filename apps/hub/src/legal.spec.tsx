import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Station } from "./data/station";
import { buildToday } from "./data/today";
import { Market } from "./screens/Market";
import { Profile } from "./screens/Profile";
import { HOW_TO_BUY } from "./data/public-copy";
import { ATTRIBUTION, LAN_ROLE } from "./brand";
import { BuyRlanBar, copyMintLabel } from "./ui/BuyRlanBar";
import { IdentityFacts } from "./ui/IdentityLinks";

describe("legal notices at account and token decisions", () => {
  it.each(["hero", "block"] as const)("shows loss and creator-fee disclosures beside the %s buy link", (variant) => {
    const html = renderToStaticMarkup(<BuyRlanBar variant={variant} />);
    expect(html).toContain("Tokens can lose all value");
    expect(html).toContain("creator fees through ClawPump");
    expect(html).toContain('href="/terms#tokens"');
    expect(html).toContain(HOW_TO_BUY);
    expect(html).toContain(copyMintLabel("idle"));
    expect(html).not.toContain("Could not copy the mint");
  });
  it("names the copy failure and puts the artist on the shell", () => {
    expect(copyMintLabel("failed")).toBe("Copy failed");
    expect(copyMintLabel("copied")).toBe("Copied");
    expect(ATTRIBUTION).toBe("Radio LAN by THE WZRD OF ZO");
    expect(LAN_ROLE).toBe("LAN is the AI DJ and broadcast console.");
    const app = readFileSync(new URL("./app/App.tsx", import.meta.url), "utf8");
    expect(app).toContain("{ATTRIBUTION}");
    expect(app).toContain("{LAN_ROLE}");
    expect(app).toContain("by {BRAND.artist}");
  });
  it("keeps Discover loading, empty, and error while the buy sentence is on screen", () => {
    const station: Station = { status: "ready", live: false, observedAt: 0 };
    const loading = renderToStaticMarkup(<Market market={null} load="loading" onRetry={() => {}} station={station} now={0} />);
    expect(loading).toContain(HOW_TO_BUY);
    expect(loading).toContain("skel");
    const failed = renderToStaticMarkup(<Market market={null} load="error" onRetry={() => {}} station={station} now={0} />);
    expect(failed).toContain("No scores changed. Nothing was sent.");
    expect(failed).toContain("Try again");
    expect(failed).toContain(HOW_TO_BUY);
    const empty = renderToStaticMarkup(<Market market={{ network: "devnet", observedAt: null, slot: null, stale: false, generatedAt: 1, listings: [] }} load="ready" onRetry={() => {}} station={station} now={0} />);
    expect(empty).toContain("No channels match the current read yet.");
    expect(empty).toContain(HOW_TO_BUY);
  });
  it("shows age, terms and privacy before account creation", () => {
    const snapshot = buildToday({ season: null, me: null, history: [], generatedAt: 0 });
    const html = renderToStaticMarkup(<Profile snapshot={snapshot} load="ready" backer={false} wallet={null} onRetry={() => {}} onAccount={async () => {}} tasks={<span id="task-records">Task records</span>} />);
    expect(html).toContain("18 or older");
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html.indexOf('href="/terms"')).toBeLessThan(html.indexOf("Create account with a passkey"));
    expect(html.indexOf("Create account with a passkey")).toBeLessThan(html.indexOf('id="task-records"'));
  });
  it("explains retained associations before either identity is linked", () => {
    const html = renderToStaticMarkup(<IdentityFacts identity={{ twitchEnabled: true, twitch: null, wallet: null }} onTwitch={() => {}} onWallet={() => {}} />);
    expect(html).toContain("Link Twitch");
    expect(html).toContain("anti-duplication and claim records");
    expect(html).toContain('href="/privacy#identity"');
  });
});
