import { describe, expect, it } from "vitest";

import { surfaceListing, type Listing } from "./market";

const MONDAY = "1790553600";
const WEEK = "604800";

const listing = (seasonStart: string, seasonSeconds: string): Listing => ({
  slug: "demo-one",
  name: "Demo One",
  kind: "demo",
  demo: true,
  blurb: null,
  twitch: null,
  keys: { streamer: "GQ3VfL59Hn4zQ5pZrCEnbLnGZt5aKR2U7tXL3kqHfXc3", mint: "9ocVrg8z6wva3Z7A3rLYU4fWXFXWWf6sC4aGV7fgSJuN" },
  backingOpen: true,
  arena: {
    address: "11111111111111111111111111111111",
    streamer: "GQ3VfL59Hn4zQ5pZrCEnbLnGZt5aKR2U7tXL3kqHfXc3",
    mint: "9ocVrg8z6wva3Z7A3rLYU4fWXFXWWf6sC4aGV7fgSJuN",
    decimals: 6,
    closed: false,
    seasonStart,
    seasonSeconds,
    season: "1",
    total: "1",
    backers: "1",
    requested: 0,
    netFlow: null,
  },
  performance: null,
});

describe("surfaceListing", () => {
  it("keeps a Monday / 7-day arena and hides a squat", () => {
    expect(surfaceListing(listing(MONDAY, WEEK)).arena?.seasonStart).toBe(MONDAY);
    expect(surfaceListing(listing(MONDAY, "60")).arena).toBeNull();
    expect(surfaceListing(listing(MONDAY, "60")).backingOpen).toBe(false);
    expect(surfaceListing(listing("1790639999", WEEK)).arena).toBeNull();
  });

  it("keeps the featured station arena when its 7-day season did not start on Monday", () => {
    const liveStart = "1791390680";
    const featured = { ...listing(liveStart, WEEK), slug: "radiolanlive", kind: "featured" as const, demo: false };
    expect(surfaceListing(featured).arena?.seasonStart).toBe(liveStart);
    expect(surfaceListing(featured).backingOpen).toBe(true);
    expect(surfaceListing({ ...featured, kind: "tracked" }).arena).toBeNull();
    expect(surfaceListing({ ...featured, arena: { ...featured.arena!, closed: true } }).arena).toBeNull();
    expect(surfaceListing({ ...featured, arena: { ...featured.arena!, seasonSeconds: "60" } }).arena).toBeNull();
    expect(surfaceListing({ ...featured, keys: { ...featured.keys!, mint: "MintDoesNotMatch111111111111111111111111" } }).backingOpen).toBe(false);
  });
});
