import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { creatorAffinity } from "./creatorAffinity";
import { sampleMarket } from "./sample";
import { CreatorAffinity } from "../ui/CreatorAffinity";
import type { Listing } from "./market";

const channel = (slug: string, name: string, game: string, options: Partial<Listing> = {}): Listing => ({
  slug,
  name,
  kind: "tracked",
  demo: false,
  blurb: null,
  twitch: slug,
  keys: null,
  backingOpen: false,
  arena: null,
  performance: { live: false, viewers: null, game, startedAt: null, rank: null, deltaViewers: null, provenance: "Data: Twitch" },
  ...options,
});

describe("creator affinity", () => {
  it("recommends only board channels sharing categories with this browser's selected follows", () => {
    const listings = [
      channel("follow-a", "Follow A", "Just Chatting"),
      channel("follow-b", "Follow B", "Just Chatting"),
      channel("nearby", "Nearby Creator", "Just Chatting"),
      channel("unrelated", "Unrelated Creator", "Music"),
      channel("no-category", "No Category", "Music", { performance: null }),
    ];
    const result = creatorAffinity(listings, ["follow-a", "follow-b", "missing-slug"]);

    expect(result.followedWithCategories).toBe(2);
    expect(result.interests).toEqual([{ category: "Just Chatting", followedCreators: ["follow-a", "follow-b"] }]);
    expect(result.recommendations.map(({ listing, sharedCategories, followedCreators }) => ({
      slug: listing.slug, sharedCategories, followedCreators,
    }))).toEqual([{ slug: "nearby", sharedCategories: ["Just Chatting"], followedCreators: ["follow-a", "follow-b"] }]);
  });

  it("ignores demo creators without Twitch channel and category data", () => {
    const market = sampleMarket(1_791_234_567_000);
    const result = creatorAffinity(market.listings, ["crate-breed", "dusty-rhymes"]);
    expect(result.followedWithCategories).toBe(0);
    expect(result.recommendations).toEqual([]);
  });

  it("marks preview output with SampleTag and keeps live output free of sample labeling", () => {
    const listings = [channel("follow-a", "Follow A", "Just Chatting"), channel("nearby", "Nearby Creator", "Just Chatting")];
    const sampleHtml = renderToStaticMarkup(<CreatorAffinity listings={listings} followed={["follow-a"]} sample />);
    const liveHtml = renderToStaticMarkup(<CreatorAffinity listings={listings} followed={["follow-a"]} />);

    expect(sampleHtml).toContain("tag--sample");
    expect(sampleHtml).toContain("Creators near your interests");
    expect(liveHtml).not.toContain("tag--sample");
    expect(liveHtml).toContain("Suggestions use the current channel board; no other fans&#x27; data is used.");
    expect(liveHtml).toContain("Data: Twitch");
  });

  it("never recommends fictional creators in the live interest panel", () => {
    const listings = [channel("follow-a", "Follow A", "Music"), channel("fiction", "Fictional friend", "Music", { demo: true })];
    const liveHtml = renderToStaticMarkup(<CreatorAffinity listings={listings} followed={["follow-a"]} />);
    expect(liveHtml).not.toContain("Fictional friend");
    const previewHtml = renderToStaticMarkup(<CreatorAffinity listings={listings} followed={["follow-a"]} sample />);
    expect(previewHtml).toContain("Fictional friend");
    expect(previewHtml).toContain("tag--sample");
  });
});
