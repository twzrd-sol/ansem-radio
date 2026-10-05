import { describe, expect, it } from "vitest";
import { categoryLanes, collection } from "./lanes";
import type { Listing } from "./market";

const l = (slug: string, game: string | null, live = true): Listing => ({ slug, name: slug, kind: "tracked", demo: false, blurb: null, twitch: slug, keys: null, backingOpen: false, arena: null, performance: game ? { live, viewers: live ? 10 : null, game, startedAt: null, rank: null, deltaViewers: null, provenance: "Data: Twitch." } : null });
const board = [l("a", "Just Chatting"), l("b", "Just Chatting"), l("c", "Just Chatting", false), l("d", "Minecraft"), l("e", "Fortnite"), l("f", null)];

describe("category lanes", () => {
  it("counts channels per category, biggest first, ignoring channels with no read", () => {
    expect(categoryLanes(board)).toEqual([{ game: "Just Chatting", channels: 3, live: 2 }, { game: "Fortnite", channels: 1, live: 1 }, { game: "Minecraft", channels: 1, live: 1 }]);
    expect(categoryLanes(board, 1)).toHaveLength(1);
    expect(categoryLanes([])).toEqual([]);
  });
});

describe("collection meter", () => {
  it("starts empty and says what is next", () => {
    const c = collection(board, []);
    expect(c).toMatchObject({ followed: 0, total: 5, categories: 0 });
    expect(c.badges.every((b) => !b.earned)).toBe(true);
    expect(c.next).toBe("3 more to be a Scout");
  });
  it("earns Scout at three follows and Explorer at three categories", () => {
    expect(collection(board, ["a", "b", "d"]).badges.map((b) => b.earned)).toEqual([true, false, false]);
    const c = collection(board, ["a", "d", "e"]);
    expect(c.badges.map((b) => b.earned)).toEqual([true, true, false]);
    expect(c.categories).toBe(3);
    expect(c.next).toBe("Follow a whole category to finish");
  });
  it("earns Full lane only for a whole category of three or more", () => {
    expect(collection(board, ["a", "b"]).badges[2]?.earned).toBe(false);
    const c = collection(board, ["a", "b", "c"]);
    expect(c.badges.map((b) => b.earned)).toEqual([true, false, true]);
    expect(c.next).toBe("2 more categories to be an Explorer");
    expect(collection(board, ["a", "b", "c", "d", "e"]).next).toBeNull();
  });
  it("ignores follows of channels not on the board and channels with no category", () => {
    expect(collection(board, ["f", "ghost"]).followed).toBe(0);
  });
});
