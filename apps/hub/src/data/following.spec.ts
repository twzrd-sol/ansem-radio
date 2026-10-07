import { describe, expect, it } from "vitest";
import { createFollowStore, FOLLOW_KEY } from "./following";
import { sampleMarket } from "./sample";
import { followingListings } from "./market";

describe("per-browser following", () => {
  it("migrates old stars, validates data and persists Follow across navigation and reload", () => {
    const values = new Map([["radiolan-hub:watching", JSON.stringify(["radiolanlive", "radiolanlive", 123, "../bad"])]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = createFollowStore(storage);
    expect(store.snapshot()).toEqual(["radiolanlive"]);
    let changes = 0;
    store.subscribe(() => { changes++; });
    store.toggle("crate-breed");
    expect(changes).toBe(1);
    expect(createFollowStore(storage).snapshot()).toEqual(["radiolanlive", "crate-breed"]);
    expect(JSON.parse(values.get(FOLLOW_KEY)!)).toEqual({ version: 1, slugs: ["radiolanlive", "crate-breed"] });
    store.toggle("radiolanlive");
    expect(store.snapshot()).toEqual(["crate-breed"]);
    values.set(FOLLOW_KEY, JSON.stringify({ version: 1, slugs: ["other"] }));
    store.reload();
    expect(store.snapshot()).toEqual(["other"]);
  });

  it("works when browser storage is denied", () => {
    const store = createFollowStore({ getItem: () => { throw Error("denied"); }, setItem: () => { throw Error("denied"); } });
    store.toggle("radiolanlive");
    expect(store.snapshot()).toEqual(["radiolanlive"]);
    store.toggle("radiolanlive");
    expect(store.snapshot()).toEqual([]);
  });

  it("imports only valid unique slugs into this browser's watchlist", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = createFollowStore(storage);
    store.toggle("already-followed");
    expect(store.importSlugs(["already-followed", "new-creator", "new-creator", "../bad"])).toBe(1);
    expect(store.snapshot()).toEqual(["already-followed", "new-creator"]);
    expect(JSON.parse(values.get(FOLLOW_KEY)!)).toEqual({ version: 1, slugs: ["already-followed", "new-creator"] });
  });

  it("puts live followed channels before more-backed offline creators", () => {
    const listings = sampleMarket(Date.UTC(2026, 9, 3)).listings;
    const offline = { ...listings[0]!, slug: "offline", backingOpen: true, performance: null };
    const live = { ...listings[0]!, slug: "live", backingOpen: false, arena: null, performance: { live: true, viewers: 20, game: null, startedAt: null, rank: null, deltaViewers: null, provenance: "Data: Twitch" } };
    expect(followingListings([offline, live], ["offline", "live"]).map((l) => l.slug)).toEqual(["live", "offline"]);
    expect(followingListings([offline, live], [])).toEqual([]);
  });
});
