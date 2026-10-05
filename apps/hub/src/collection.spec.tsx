import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildSample } from "./data/sample";
import { collectionSummary, pointsShare } from "./data/collection";
import type { HubSnapshot, RewardState } from "./data/types";
import { Claim } from "./screens/Claim";

const NOW = Date.parse("2026-10-03T13:00:00Z");
const sample = buildSample(NOW);
const snapshot = (reward: RewardState, points = 312, eligiblePoints = 9840): HubSnapshot => ({ ...sample, scenario: "today", lastSeason: { ...sample.lastSeason!, reward, eligiblePoints, me: { points, rank: 21 } }, history: [] });
const page = (s: HubSnapshot) => renderToStaticMarkup(<Claim snapshot={s} load="ready" onRetry={() => {}} />);

describe("season records and collecting", () => {
  it("shows frozen points before funding, without inventing an anchor or a personal share", () => {
    const html = page(snapshot({ kind: "finalized" }));
    expect(html).toContain("Points frozen");
    expect(html).toContain("312");
    expect(html).not.toContain("Anchor transaction");
    expect(html).not.toContain("Your share");
    expect(html).not.toContain("tag--sample");
  });
  it("shows an anchored record as a verification link without presenting it as funding", () => {
    const reward = sample.history[1]!.reward;
    const html = page(snapshot(reward));
    expect(html).toContain("Board anchored");
    expect(html).toContain("Anchor transaction");
    expect(html).toContain("https://explorer.solana.com/tx/");
    expect(html).not.toContain("Perks funded");
    expect(html).not.toContain("Your share");
  });
  it("handles an empty funded season without a divide-by-zero share", () => {
    const html = page(snapshot(sample.lastSeason!.reward, 0, 0));
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain("No eligible points");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Collect · not available yet/);
  });
  it("refuses malformed anchor and funding fields before showing a share", () => {
    const reward = sample.lastSeason!.reward;
    if (!("pool" in reward)) throw new Error("fixture");
    for (const bad of [{ ...reward, root: "invented" }, { ...reward, anchorTx: "javascript:bad" }, { ...reward, pool: { ...reward.pool, baseUnits: -1n } }, { ...reward, pool: { ...reward.pool, decimals: 2 } }]) {
      const html = page(snapshot(bad));
      expect(html).toContain("Record unavailable");
      expect(html).not.toContain("Your share");
      expect(html).not.toContain("explorer.solana.com/tx/");
    }
  });
  it("does not activate a collection instruction from a fixture state", () => {
    const reward = sample.lastSeason!.reward;
    if (!("pool" in reward)) throw new Error("fixture");
    const html = page(snapshot({ ...reward, kind: "claimable" }));
    expect(html).toContain("Perks funded");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Collect · not available yet/);
    expect(html).not.toContain("tag--sample");
  });
  it("rounds valid point shares down and rejects empty, negative, excessive or unsafe counts", () => {
    expect(pointsShare(312, 9840)).toBe("3.17%");
    expect(pointsShare(1, 3)).toBe("33.33%");
    expect(pointsShare(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER)).toBe("99.99%");
    for (const [points, total] of [[0, 0], [0, 1], [-1, 1], [2, 1], [1.5, 2], [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1]]) expect(pointsShare(points!, total!)).toBeNull();
  });
  it("uses exact season boundaries and distinguishes a closed clock from a published final record", () => {
    const live = { ...sample, scenario: "today" as const, lastSeason: null, history: [] };
    const season = live.season!;
    expect(collectionSummary(live, season.opensAt - 1).label).toContain("up next");
    expect(collectionSummary(live, season.opensAt).label).toContain("still open");
    expect(collectionSummary({ ...live, season: { ...season, poll: { id: "placeholder-1", question: "Which sound opens the show?", options: ["Boom bap", "Drill"], placeholder: true } } }, season.opensAt)).toEqual({
      label: "Season 12 is a sample",
      text: "Today's poll is a placeholder. This is not a live scored season.",
    });
    expect(collectionSummary(live, season.freezesAt - 1).text).toContain("230 points so far");
    expect(collectionSummary(live, season.freezesAt)).toEqual({ label: "Season 12 is closed", text: "Its final record has not been published yet." });
    expect(collectionSummary(null, NOW).label).toBe("No season record yet");
    const pageHtml = renderToStaticMarkup(<Claim snapshot={live} load="ready" onRetry={() => {}} now={season.opensAt - 1} />);
    expect(pageHtml).toContain("UTC");
    expect(pageHtml).not.toContain("Collect · not available yet");
  });
  it("hides personal figures while signed out and marks only explicit sample records", () => {
    const out = snapshot({ kind: "finalized" });
    out.lastSeason!.me = null;
    const html = page(out);
    expect(html).toContain("Sign in");
    expect(html).not.toContain("312");
    expect(html).not.toContain("Your share");
    expect(page(sample)).toContain("tag--sample");
  });
  it("rejects mixed stages and missing funding fields instead of trusting the status label", () => {
    const funded = sample.lastSeason!.reward;
    if (!("pool" in funded)) throw new Error("fixture");
    const { pool: _pool, ...anchor } = funded;
    for (const mixed of [{ ...funded, kind: "finalized" }, { ...funded, kind: "anchored" }, { ...anchor, kind: "funded" }]) {
      const html = page(snapshot(mixed as RewardState));
      expect(html).toContain("Record unavailable");
      expect(html).not.toContain("Your share");
      expect(html).not.toContain("Anchor transaction");
    }
  });
});
