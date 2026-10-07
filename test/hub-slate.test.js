import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createHubApi } from "../src/hub/api.js";
import { registry } from "../src/hub/registry.js";
import { buildSlate, clipsFrom, createSlateKeeper, DEFAULT_RETENTION_SECONDS, fetchSlateObservations, observationsFrom, slugOf, WINDOW_SECONDS } from "../src/hub/slate.js";
import { createHubStore } from "../src/hub/store.js";

const row = (login, viewers, game = "Just Chatting", extra = {}) => ({ user_login: login, user_name: login.toUpperCase(), viewer_count: viewers, game_name: game, game_id: "509658", language: "en", type: "live", title: "SECRET TITLE", user_id: "999", ...extra });
const NOW = 1_791_025_000;

describe("slate observations", () => {
  it("keeps only live rows with a valid login, one per login, and drops titles and ids", () => {
    const got = observationsFrom([row("alpha", 10), row("alpha", 50), row("beta", 5, "Minecraft", { type: "" }), row("Bad Login", 9), row("gamma", -1), row("delta", 7, null, { language: "klingon!" })]);
    assert.deepEqual(got.map((o) => [o.login, o.viewers]), [["alpha", 50], ["delta", 7]]);
    assert.ok(got.every((o) => !("title" in o) && !("user_id" in o) && !JSON.stringify(o).includes("SECRET")));
    assert.equal(got[1].language, null);
  });
  it("slugs drop trailing underscores like the registry does", () => assert.equal(slugOf("caseoh_"), "caseoh"));
  it("drops a login whose slug would shadow Object.prototype", () => {
    assert.equal(slugOf("constructor_"), null);
    const slate = buildSlate([{ login: "constructor_", name: "C", game: "Just Chatting", language: "en", peak: 10, now: 10, seenAt: NOW, days: { [Math.floor(NOW / 86_400)]: 10 } }], { at: NOW });
    assert.equal(slate.streamers.some((row) => row.login === "constructor_" || row.slug === "constructor"), false);
  });
});

describe("buildSlate", () => {
  const rows = [
    { login: "a1", name: "A1", game: "Just Chatting", language: "en", peak: 900, now: 800, seenAt: NOW },
    { login: "b1", name: "B1", game: "Minecraft", language: "de", peak: 700, now: 700, seenAt: NOW },
    { login: "c1", name: "C1", game: "Just Chatting", language: "en", peak: 400, now: 100, seenAt: NOW - 7200 },
    { login: "d1", name: "D1", game: null, language: "fr", peak: 300, now: 300, seenAt: NOW },
  ];
  it("ranks by peak, marks stale rows not live, and slices by category", () => {
    const s = buildSlate(rows, { size: 3, at: NOW });
    assert.deepEqual(s.streamers.map((r) => r.login), ["a1", "b1", "c1"]);
    assert.deepEqual(s.streamers.map((r) => r.live), [true, true, false]);
    assert.equal(s.streamers[2].viewers, null);
    assert.deepEqual(s.categories.map((c) => [c.game, c.streamers.map((r) => r.login)]), [["Just Chatting", ["a1", "c1"]], ["Minecraft", ["b1"]]]);
    assert.deepEqual(s.languages, { en: 2, de: 1 });
  });
  it("respects the size, category and per-category limits", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ login: `user${i}`, name: `U${i}`, game: `G${i % 12}`, language: "en", peak: 1000 - i, now: 1, seenAt: NOW }));
    const s = buildSlate(many, { size: 25, categories: 4, perCategory: 2, at: NOW });
    assert.equal(s.streamers.length, 25);
    assert.equal(s.categories.length, 4);
    assert.ok(s.categories.every((c) => c.streamers.length <= 2));
  });
});

describe("slate keeper", () => {
  it("accumulates peaks over a rolling 24 hours, prunes after, and stores no titles or ids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-slate-"));
    let clock = NOW;
    let reads = [[{ login: "alpha", name: "Alpha", game: "Just Chatting", language: "en", viewers: 100 }]];
    const keeper = createSlateKeeper({ dir, now: () => clock, retentionSeconds: WINDOW_SECONDS, fetchObservations: async () => ({ observations: reads[0], error: null }), log: { warn() {} } });
    await keeper.poll();
    clock += 900; reads = [[{ login: "alpha", name: "Alpha", game: "Just Chatting", language: "en", viewers: 60 }, { login: "beta", name: "Beta", game: "Minecraft", language: "de", viewers: 30 }]];
    const s = await keeper.poll();
    assert.equal(s.streamers[0].peak, 100, "the peak is kept");
    assert.equal(s.streamers[0].viewers, 60, "the current audience is the latest read");
    assert.equal(keeper.listings().length, 2);
    assert.equal(keeper.performance("alpha").rank, 1);
    assert.equal(keeper.performance("nobody"), null);
    const disk = readFileSync(join(dir, "slate.json"), "utf8");
    assert.ok(!/title|user_id|SECRET/i.test(disk));
    assert.equal(createSlateKeeper({ dir, now: () => clock, retentionSeconds: WINDOW_SECONDS, fetchObservations: async () => ({ observations: [] }) }).slate().streamers.length, 2, "survives restart");
    clock += WINDOW_SECONDS + 1;
    assert.equal(keeper.slate().streamers.length, 0, "rows older than 24 hours are gone");
    assert.equal(createSlateKeeper({ dir, now: () => clock, retentionSeconds: WINDOW_SECONDS, fetchObservations: async () => ({ observations: [] }) }).slate().streamers.length, 0, "and stay gone after a restart");
    rmSync(dir, { recursive: true, force: true });
  });
  it("keeps the last slate and reports stale when a read fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-slate-"));
    let fail = false; let clock = NOW;
    const keeper = createSlateKeeper({ dir, now: () => clock, intervalMs: 900_000, log: { warn() {} }, fetchObservations: async () => (fail ? { observations: [], error: "status_401" } : { observations: [{ login: "alpha", name: "A", game: "x", language: "en", viewers: 5 }], error: null }) });
    await keeper.poll();
    fail = true; clock += 3000;
    const s = await keeper.poll();
    assert.equal(s.streamers.length, 1);
    assert.equal(s.stale, true);
    assert.equal(keeper.error(), "status_401");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("fetchSlateObservations", () => {
  it("reads the top streams, the top games, and each game's top streams, with read-only headers", async () => {
    const urls = [];
    const fetchImpl = async (url, init) => {
      urls.push(url);
      assert.equal(init.headers["Client-Id"], "cid");
      assert.equal(init.headers.Authorization, "Bearer tok");
      assert.equal(init.redirect, "error");
      const data = url.includes("/games/top") ? [{ id: "1", name: "Minecraft" }, { id: "x;drop", name: "Bad" }] : url.includes("game_id=1") ? [row("miner", 40, "Minecraft")] : [row("alpha", 90)];
      return new Response(JSON.stringify({ data }));
    };
    const out = await fetchSlateObservations({ fetchImpl, clientId: "cid", token: () => "oauth:tok" });
    assert.equal(out.error, null);
    assert.deepEqual(out.observations.map((o) => o.login).sort(), ["alpha", "miner"]);
    assert.equal(urls.filter((u) => u.includes("game_id=")).length, 2, "one streams read and one clips read for the valid game; a malformed id is never queried");
    assert.ok(urls.every((u) => !u.includes("drop")));
  });
  it("reports missing credentials and failed reads without throwing", async () => {
    assert.equal((await fetchSlateObservations({ clientId: "", token: "" })).error, "twitch_credentials_missing");
    const out = await fetchSlateObservations({ fetchImpl: async () => new Response("no", { status: 401 }), clientId: "cid", token: "tok" });
    assert.deepEqual(out, { observations: [], clips: [], error: "status_401" });
  });
});

describe("slate in the hub API", () => {
  it("adds slate streamers as open, unclaimed listings behind the fixed registry, with their performance", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hub-slate-api-"));
    const keeper = createSlateKeeper({ dir, now: () => NOW, log: { warn() {} }, fetchObservations: async () => ({ error: null, observations: [{ login: "ninja", name: "Ninja", game: "Fortnite", language: "en", viewers: 5 }, { login: "newcomer", name: "Newcomer", game: "Just Chatting", language: "en", viewers: 800 }] }) });
    await keeper.poll();
    const reg = registry([{ slug: "ninja", name: "ninja", kind: "tracked", twitch: "ninja", streamer: null, mint: null }]);
    const market = { registry: reg, slate: keeper, index: { listingArena: () => null, status: () => ({ network: "devnet", observedAt: null, slot: null, stale: false }), positionsOf: () => [], history: () => [] } };
    const api = createHubApi({ origins: "https://hub.example", store: createHubStore({ dir }), now: () => NOW, market, limits: { read: 200, write: 200, auth: 200 } });
    const server = createServer(api);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
    const get = async (path) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/hub/api${path}`, { headers: { origin: "https://hub.example" } }); return { status: r.status, json: await r.json() }; };
    const listings = (await get("/market")).json.listings;
    assert.deepEqual(listings.map((l) => l.slug), ["ninja", "newcomer"], "no duplicate for a login already registered");
    assert.equal(listings[1].backingOpen, false);
    assert.equal(listings[1].claimed, false);
    assert.equal(listings[1].performance.viewers, 800);
    assert.match(listings[1].performance.provenance, /^Data: Twitch\./);
    assert.equal((await get("/market/newcomer")).status, 200);
    const slate = (await get("/slate")).json;
    assert.equal(slate.streamers[0].login, "newcomer");
    assert.equal(slate.categories.length, 2);
    assert.match(slate.label, /display/);
  });
  it("answers 404 for the slate when it is off", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hub-slate-api-"));
    const market = { registry: registry([{ slug: "ninja", name: "ninja", kind: "tracked", twitch: "ninja", streamer: null, mint: null }]), index: { listingArena: () => null, status: () => ({}), positionsOf: () => [], history: () => [] } };
    const server = createServer(createHubApi({ origins: "https://hub.example", store: createHubStore({ dir }), now: () => NOW, market, limits: { read: 200, write: 200, auth: 200 } }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
    const r = await fetch(`http://127.0.0.1:${server.address().port}/hub/api/slate`, { headers: { origin: "https://hub.example" } });
    assert.equal(r.status, 404);
  });
});

describe("top clips per category", () => {
  const clip = (over = {}) => ({ url: "https://clips.twitch.tv/AbCd-123", view_count: 4200, broadcaster_name: "Alpha", title: "SECRET CLIP TITLE", creator_name: "someone", ...over });
  it("keeps a link, views and channel only, and drops anything that is not a Twitch clip link", () => {
    const got = clipsFrom([["Just Chatting", clip()], ["Minecraft", clip({ url: "https://evil.example/x" })], ["Fortnite", clip({ url: "javascript:alert(1)" })], ["Dota 2", clip({ view_count: -1 })], ["Music", clip({ broadcaster_name: "" })], ["IRL", undefined]]);
    assert.deepEqual(got, [{ game: "Just Chatting", url: "https://clips.twitch.tv/AbCd-123", views: 4200, channel: "Alpha" }]);
    assert.ok(!JSON.stringify(got).includes("SECRET") && !JSON.stringify(got).includes("someone"));
  });
  it("asks for one clip per top category from the last 24 hours", async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      const data = url.includes("/games/top") ? [{ id: "1", name: "Minecraft" }] : url.includes("/clips") ? [clip()] : [row("alpha", 90)];
      return new Response(JSON.stringify({ data }));
    };
    const out = await fetchSlateObservations({ fetchImpl, clientId: "cid", token: "tok", now: () => NOW });
    const asked = urls.find((u) => u.includes("/clips"));
    assert.match(asked, /game_id=1&first=1&started_at=/);
    assert.equal(decodeURIComponent(asked.split("started_at=")[1]), new Date((NOW - WINDOW_SECONDS) * 1000).toISOString());
    assert.deepEqual(out.clips.map((c) => c.game), ["Minecraft"]);
  });
  it("serves each lane's clip, keeps it 24 hours, and stores no title", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-slate-"));
    let clock = NOW;
    const keeper = createSlateKeeper({ dir, now: () => clock, retentionSeconds: WINDOW_SECONDS, log: { warn() {} }, fetchObservations: async () => ({ error: null, observations: [{ login: "alpha", name: "Alpha", game: "Just Chatting", language: "en", viewers: 5 }], clips: [{ game: "Just Chatting", url: "https://clips.twitch.tv/AbCd-123", views: 9, channel: "Alpha" }] }) });
    const s = await keeper.poll();
    assert.deepEqual(s.categories[0].clip, { url: "https://clips.twitch.tv/AbCd-123", views: 9, channel: "Alpha" });
    assert.ok(!/title/i.test(readFileSync(join(dir, "slate.json"), "utf8")));
    assert.equal(createSlateKeeper({ dir, now: () => clock, retentionSeconds: WINDOW_SECONDS, fetchObservations: async () => ({ observations: [] }) }).slate().categories.length, 1, "survives restart");
    clock += WINDOW_SECONDS + 1;
    assert.equal(keeper.slate().categories.length, 0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the embeddable badge", () => {
  it("renders an inert SVG with the channel's reading, escapes hostile names and states the source", async () => {
    const { renderBadge } = await import("../src/hub/badge.js");
    const live = renderBadge({ listing: { name: 'Evil<script>"&', claimed: true }, performance: { live: true, viewers: 12345, game: "Just Chatting", provenance: "x" } });
    assert.match(live, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(!/<script|javascript:|href=|<image|foreignObject/i.test(live), "no script, link or external reference");
    assert.ok(live.includes("Evil&lt;script&gt;&quot;&amp;"));
    assert.ok(live.includes("Live · 12,345 watching") && live.includes("Just Chatting") && live.includes("Streamer joined") && live.includes("Data: Twitch"));
    const off = renderBadge({ listing: { name: "Quiet", claimed: false }, performance: { live: false, viewers: null, game: null } });
    assert.ok(off.includes("Offline right now") && !off.includes("Streamer joined"));
    const none = renderBadge({ listing: { name: "x".repeat(60) }, performance: null });
    assert.ok(none.includes("On Twitch") && !none.includes("Data: Twitch") && none.includes("…"));
  });
  it("serves /hub/api/badge/<slug>.svg publicly with safe headers, and 404s an unknown listing", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hub-badge-"));
    const keeper = createSlateKeeper({ dir, now: () => NOW, log: { warn() {} }, fetchObservations: async () => ({ error: null, observations: [{ login: "newcomer", name: "Newcomer", game: "Just Chatting", language: "en", viewers: 800 }] }) });
    await keeper.poll();
    const market = { registry: registry([{ slug: "ninja", name: "ninja", kind: "tracked", twitch: "ninja", streamer: null, mint: null }]), slate: keeper, index: { listingArena: () => null, status: () => ({ network: "devnet" }), positionsOf: () => [], history: () => [] } };
    const server = createServer(createHubApi({ origins: "https://hub.example", store: createHubStore({ dir }), now: () => NOW, market, limits: { read: 200, write: 200, auth: 200 } }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
    const get = (path) => fetch(`http://127.0.0.1:${server.address().port}${path}`);
    const ok = await get("/hub/api/badge/newcomer.svg");
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type"), /^image\/svg\+xml/);
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
    assert.equal(ok.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.match(ok.headers.get("content-security-policy"), /default-src 'none'/);
    assert.match(ok.headers.get("cache-control"), /max-age=300/);
    assert.match(await ok.text(), /Live · 800 watching/);
    assert.equal((await get("/hub/api/badge/ghost.svg")).status, 404);
    assert.equal((await get("/hub/api/badge/Bad_Slug.svg")).status, 404);
  });
});

describe("retention beyond 24 hours", () => {
  const DAY = 86_400;
  const start = Math.floor(NOW / DAY) * DAY + 3600; // an hour into a UTC day, so day offsets are exact
  const make = (dir, clockRef, viewersRef, extra = {}) => createSlateKeeper({ dir, now: () => clockRef.t, log: { warn() {} }, ...extra, fetchObservations: async () => ({ error: null, observations: [{ login: "alpha", name: "Alpha", game: "Just Chatting", language: "en", viewers: viewersRef.v }] }) });
  it("defaults to 7 days and builds a week of daily peaks, oldest first, with gaps as null", async () => {
    assert.equal(DEFAULT_RETENTION_SECONDS, 7 * DAY);
    const dir = mkdtempSync(join(tmpdir(), "hub-slate-"));
    const clock = { t: start }; const viewers = { v: 100 };
    const keeper = make(dir, clock, viewers);
    await keeper.poll();
    clock.t += 2 * DAY; viewers.v = 300; await keeper.poll();
    clock.t += 900; viewers.v = 250; const s = await keeper.poll();
    assert.deepEqual(s.streamers[0].week, [null, null, null, null, 100, null, 300]);
    assert.equal(s.streamers[0].today, 300);
    assert.equal(s.streamers[0].peak, 300);
    assert.deepEqual(s.categories[0].week, [null, null, null, null, 100, null, 300]);
    assert.equal(s.retentionHours, 168);
    assert.match(s.label, /kept for 7 days/);
    assert.deepEqual(createSlateKeeper({ dir, now: () => clock.t, fetchObservations: async () => ({ observations: [] }) }).slate().streamers[0].week, s.streamers[0].week, "survives restart");
    rmSync(dir, { recursive: true, force: true });
  });
  it("drops days and channels older than the retention", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-slate-"));
    const clock = { t: start }; const viewers = { v: 100 };
    const keeper = make(dir, clock, viewers);
    await keeper.poll();
    clock.t += 5 * DAY; viewers.v = 40; await keeper.poll();
    clock.t += 3 * DAY; // the first day is now 8 days old
    const week = keeper.slate().streamers[0].week;
    assert.deepEqual(week, [null, null, null, 40, null, null, null].map((v, i) => (i === 3 ? v : v)), "only the 5-day-old reading remains in the window");
    clock.t += 6 * DAY;
    assert.equal(keeper.slate().streamers.length, 0, "a channel not seen for longer than the retention is gone");
    rmSync(dir, { recursive: true, force: true });
  });
  it("can be set back to 24 hours, labels itself so, and refuses nonsense retentions", () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-slate-"));
    const k = createSlateKeeper({ dir, now: () => NOW, retentionSeconds: DAY, fetchObservations: async () => ({ observations: [] }) });
    assert.match(k.slate().label, /kept for 24 hours/);
    for (const bad of [0, 59, 31 * DAY, 1.5, "x"]) assert.throws(() => createSlateKeeper({ dir, now: () => NOW, retentionSeconds: bad, fetchObservations: async () => ({ observations: [] }) }), /retention/);
    rmSync(dir, { recursive: true, force: true });
  });
  it("ranks the slate by today's peak, so last week's leaders do not stick", () => {
    const today = Math.floor(NOW / DAY);
    const rows = [
      { login: "oldking", name: "Old", game: "x", language: "en", days: { [today - 3]: 9000 }, now: 1, seenAt: NOW - 3 * DAY },
      { login: "riser", name: "Riser", game: "x", language: "en", days: { [today - 1]: 10, [today]: 500 }, now: 500, seenAt: NOW },
    ];
    const out = buildSlate(rows, { at: NOW });
    assert.deepEqual(out.streamers.map((r) => r.login), ["riser", "oldking"]);
    assert.equal(out.streamers[1].peak, 9000);
    assert.equal(out.streamers[1].today, 0);
  });
});
