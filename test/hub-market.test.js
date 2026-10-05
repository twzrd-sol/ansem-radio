// The backing board: registry rules, the arena index over a fake devnet upstream, and the market routes through
// the station. Arena and position bytes follow the program's layouts (plus the real mainnet test-arena bytes, which
// must stay invisible: no listing derives them).
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { decodeBase58, encodeBase58 } from "../src/core/base58.js";
import { DEVNET_GENESIS_HASH } from "../src/core/solana.js";
import { createArenaIndex, downsample, HISTORY_DAYS, readArenas } from "../src/hub/market.js";
import { BANNED_STREAMERS, defaultRegistry, listing, loadRegistry, OFFICIAL_STREAMER, registry } from "../src/hub/registry.js";
import { createHubStore } from "../src/hub/store.js";
import { createLiveServer } from "../src/live/server.js";
import { TRACKED_STREAMERS } from "../src/markets/twitch-metrics.js";
import { arenaAddress, positionAddress } from "../src/sinks/arena.js";

const ORIGIN = "https://hub.example";
const MINT = "9ocVrg8z6wva3Z7A3rLYU4fWXFXWWf6sC4aGV7fgSJuN";
const DEMO_STREAMER = "GQ3VfL59Hn4zQ5pZrCEnbLnGZt5aKR2U7tXL3kqHfXc3"; // a fictional listing's key (no funds, no person)
const FAN = "D7ucJmECqZz7mQ9aEsBAtF4V7XxpR6N7f3aYkHmP1mZx";
const FIXTURES = JSON.parse(readFileSync(new URL("../apps/hub/src/chain/fixtures/arena-chain-fixtures.json", import.meta.url), "utf8"));
const MONDAY = 1_790_553_600; // Mon 2026-09-28 00:00 UTC
const WEEK = 604_800;
const logs = () => ({ info() {}, warn() {}, error() {} });
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

function arenaBytes({ streamer, mint, seasonStart, seasonSeconds, positions, total, closed = false }) {
  const d = new Uint8Array(112);
  d.set(new TextEncoder().encode("RLARENA1"), 0);
  d[8] = 255;
  d[9] = 6;
  d[10] = closed ? 1 : 0;
  d.set(decodeBase58(streamer), 16);
  d.set(decodeBase58(mint), 48);
  const v = new DataView(d.buffer);
  v.setBigInt64(80, BigInt(seasonStart), true);
  v.setBigUint64(88, BigInt(seasonSeconds), true);
  v.setBigUint64(96, BigInt(positions), true);
  v.setBigUint64(104, BigInt(total), true);
  return d;
}
function positionBytes({ arena, fan, amount, requested, requestedSeason = 0 }) {
  const d = new Uint8Array(104);
  d.set(new TextEncoder().encode("RLPOSIT1"), 0);
  d[10] = requested ? 1 : 0;
  d.set(decodeBase58(arena), 16);
  d.set(decodeBase58(fan), 48);
  const v = new DataView(d.buffer);
  v.setBigUint64(80, BigInt(amount), true);
  v.setBigUint64(88, BigInt(requestedSeason), true);
  v.setBigInt64(96, 1_790_600_000n, true);
  return d;
}
const demoArena = encodeBase58(arenaAddress(DEMO_STREAMER, MINT).address);
const fanPosition = encodeBase58(positionAddress(demoArena, FAN).address);

/** A fake devnet upstream: genesis, slot, and program accounts by size. `state` is mutable so tests can move the chain. */
function fakeUpstream(state) {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body);
    calls.push(method);
    const result = (() => {
      if (method === "getGenesisHash") return state.genesis ?? DEVNET_GENESIS_HASH;
      if (method === "getSlot") return state.slot;
      if (method === "getProgramAccounts") {
        if (state.fail) throw new Error("boom");
        const size = params[1].filters[0].dataSize;
        return state.accounts.filter((a) => a.data.length === size).map((a) => ({ pubkey: a.pubkey, account: { data: [b64(a.data), "base64"], lamports: 1, owner: params[0], executable: false, rentEpoch: 0, space: a.data.length } }));
      }
      throw new Error(`unexpected ${method}`);
    })();
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

describe("registry: an operator allowlist with the hub's key rules", () => {
  it("defaults to Radio LAN plus the tracked logins, backable only once a mint is set", () => {
    const rows = defaultRegistry();
    assert.equal(rows[0].slug, "radiolanlive");
    assert.equal(rows[0].kind, "featured");
    assert.equal(rows[0].streamer, null, "no mint, nothing backable");
    assert.deepEqual(rows.slice(1).map((r) => r.twitch), [...TRACKED_STREAMERS]);
    const withMint = defaultRegistry({ mint: MINT });
    assert.equal(withMint[0].streamer, OFFICIAL_STREAMER);
    assert.equal(withMint[0].mint, MINT);
  });

  it("refuses the keys the hub never presents, a featured streamer that is not the official key, and half an arena", () => {
    for (const streamer of BANNED_STREAMERS) assert.throws(() => listing({ slug: "demo-x", name: "X", kind: "demo", streamer, mint: MINT }), /never presents/);
    assert.throws(() => listing({ slug: "lan", name: "LAN", kind: "featured", streamer: DEMO_STREAMER, mint: MINT }), /official key/);
    assert.throws(() => listing({ slug: "demo-x", name: "X", kind: "demo", streamer: DEMO_STREAMER }), /both streamer and mint/);
    assert.throws(() => listing({ slug: "Bad Slug", name: "X", kind: "demo" }), /bad slug/);
    assert.throws(() => listing({ slug: "demo-x", name: "X", kind: "price" }), /kind must be/);
    assert.throws(() => listing({ slug: "demo-x", name: "X", kind: "demo", twitch: "not a login!" }), /Twitch login/);
    assert.throws(() => registry([{ slug: "aa", name: "A", kind: "demo" }, { slug: "aa", name: "B", kind: "demo" }]), /duplicate slug/);
    assert.throws(() => registry([{ slug: "aa", name: "A", kind: "featured" }, { slug: "bb", name: "B", kind: "featured" }]), /one featured/);
    assert.throws(() => registry([{ slug: "aa", name: "A", kind: "demo", streamer: DEMO_STREAMER, mint: MINT }, { slug: "bb", name: "B", kind: "demo", streamer: DEMO_STREAMER, mint: MINT }]), /duplicate arena/);
  });

  it("loads a JSON file in place of the default", () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-registry-"));
    const path = join(dir, "registry.json");
    writeFileSync(path, JSON.stringify([{ slug: "demo-one", name: "Demo One", kind: "demo", twitch: null, streamer: DEMO_STREAMER, mint: MINT, blurb: "A fictional listing." }]));
    const rows = loadRegistry({ path });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].streamer, DEMO_STREAMER);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("arena index: devnet reads, snapshots, net flow, stale", () => {
  const state = { slot: 500, accounts: [] };
  const testArena = FIXTURES.accounts.test_arena_mainnet;
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "hub-market-"));
    state.accounts = [
      { pubkey: demoArena, data: arenaBytes({ streamer: DEMO_STREAMER, mint: MINT, seasonStart: MONDAY, seasonSeconds: WEEK, positions: 2, total: 750_000_000 }) },
      { pubkey: fanPosition, data: positionBytes({ arena: demoArena, fan: FAN, amount: 500_000_000, requested: true, requestedSeason: 1 }) },
      { pubkey: encodeBase58(positionAddress(demoArena, OFFICIAL_STREAMER).address), data: positionBytes({ arena: demoArena, fan: OFFICIAL_STREAMER, amount: 250_000_000, requested: false }) },
      // The real mainnet test arena's bytes (public data): decodable, but no listing derives it.
      { pubkey: testArena.address, data: new Uint8Array(Buffer.from(testArena.data_base64, "base64")) },
    ];
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("reads and decodes every arena and position, counting requests instead of summing them", async () => {
    const { fetchImpl } = fakeUpstream(state);
    const { arenas, positions } = await readArenas({ upstream: "https://devnet.example", fetchImpl });
    assert.equal(arenas.size, 2);
    assert.equal(positions.length, 2);
    const demo = arenas.get(demoArena);
    assert.equal(demo.total, 750_000_000n);
    assert.equal(demo.positionsSeen, 2);
    assert.equal(demo.requested, 1);
    assert.equal(arenas.get(testArena.address).streamer, "GbscvafBJEkWutxm3Bi6AYfXztfojW6Jj7Yaw1TM3PhT");
  });

  it("never surfaces the test arena or the superseded candidate, whatever derives them", async () => {
    const { fetchImpl } = fakeUpstream(state);
    const index = createArenaIndex({ upstream: "https://devnet.example", fetchImpl, dir: mkdtempSync(join(tmpdir(), "hub-market-b-")), log: logs() });
    await index.refresh();
    assert.equal(index.listingArena({ streamer: "GbscvafBJEkWutxm3Bi6AYfXztfojW6Jj7Yaw1TM3PhT", mint: "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy" }), null, "decodable on chain, banned by address");
  });

  it("reads mainnet when configured for it, and refuses devnet then; the default registry backs Radio LAN with RLAN on mainnet", async () => {
    const mainnetState = { ...state, genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" };
    const index = createArenaIndex({ upstream: "https://mainnet.example", fetchImpl: fakeUpstream(mainnetState).fetchImpl, dir: mkdtempSync(join(tmpdir(), "hub-market-mn-")), expectNetwork: "mainnet", log: logs() });
    await index.refresh();
    assert.equal(index.status().network, "mainnet");
    assert.equal(index.status().lastError, null);
    const wrong = createArenaIndex({ upstream: "https://devnet.example", fetchImpl: fakeUpstream(state).fetchImpl, dir: mkdtempSync(join(tmpdir(), "hub-market-mn2-")), expectNetwork: "mainnet", log: logs() });
    await wrong.refresh();
    assert.match(wrong.status().lastError, /not Solana mainnet/);
    assert.throws(() => createArenaIndex({ upstream: "https://x.example", dir: mkdtempSync(join(tmpdir(), "hub-market-mn3-")), expectNetwork: "testnet" }), /devnet or mainnet/);
    const reg = loadRegistry({ path: undefined, network: "mainnet" });
    assert.deepEqual([reg[0].streamer, reg[0].mint], [OFFICIAL_STREAMER, "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy"]);
    assert.equal(loadRegistry({ path: undefined, network: "devnet", mint: null })[0].mint, null);
  });

  it("refuses an upstream that is not devnet, and reports it instead of throwing", async () => {
    const { fetchImpl } = fakeUpstream({ ...state, genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" });
    const index = createArenaIndex({ upstream: "https://mainnet.example", fetchImpl, dir: mkdtempSync(join(tmpdir(), "hub-market-m-")), log: logs() });
    await index.refresh();
    assert.match(index.status().lastError, /not Solana devnet/);
    assert.equal(index.status().observedAt, null);
    assert.equal(index.listingArena({ streamer: DEMO_STREAMER, mint: MINT }), null);
  });

  it("joins a listing to its arena, keeps the unregistered arena invisible, and derives net flow from the season-open snapshot", async () => {
    let clock = (MONDAY + 2 * 86_400) * 1000; // Wednesday of season 1
    const { fetchImpl, calls } = fakeUpstream(state);
    const index = createArenaIndex({ upstream: "https://devnet.example", fetchImpl, dir, now: () => clock, intervalMs: 300_000, log: logs() });
    await index.refresh();
    assert.deepEqual(calls.slice(0, 2), ["getGenesisHash", "getSlot"]);
    const status = index.status();
    assert.equal(status.network, "devnet");
    assert.equal(status.stale, false);
    assert.equal(status.arenas, 2);
    const arena = index.listingArena({ streamer: DEMO_STREAMER, mint: MINT });
    assert.deepEqual(arena, { address: demoArena, streamer: DEMO_STREAMER, mint: MINT, decimals: 6, closed: false, seasonStart: String(MONDAY), seasonSeconds: String(WEEK), season: "1", total: "750000000", backers: "2", requested: 1, netFlow: null, flowSince: null }, "the first read came two days into the season: no baseline, no invented flow");
    assert.equal(index.listingArena({ streamer: "GbscvafBJEkWutxm3Bi6AYfXztfojW6Jj7Yaw1TM3PhT", mint: "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy" }), null, "the registry never lists that streamer, and the address is banned anyway");
    // The chain moves: a deposit of 100 RLAN lands, and the next tick shows the flow since the season opened.
    state.accounts[0].data = arenaBytes({ streamer: DEMO_STREAMER, mint: MINT, seasonStart: MONDAY, seasonSeconds: WEEK, positions: 3, total: 850_000_000 });
    state.slot = 600;
    clock += 300_000;
    await index.refresh();
    assert.equal(index.listingArena({ streamer: DEMO_STREAMER, mint: MINT }).netFlow, null, "still no baseline from the rollover");
    // A season that opens while the index is up: the first read within two intervals is the baseline.
    state.accounts[0].data = arenaBytes({ streamer: DEMO_STREAMER, mint: MINT, seasonStart: MONDAY + WEEK, seasonSeconds: WEEK, positions: 3, total: 850_000_000 });
    clock = (MONDAY + WEEK) * 1000 + 60_000;
    await index.refresh();
    const atOpen = index.listingArena({ streamer: DEMO_STREAMER, mint: MINT });
    assert.equal(atOpen.season, "1");
    assert.equal(atOpen.netFlow, "0");
    assert.equal(atOpen.flowSince, new Date(clock).toISOString());
    state.accounts[0].data = arenaBytes({ streamer: DEMO_STREAMER, mint: MINT, seasonStart: MONDAY + WEEK, seasonSeconds: WEEK, positions: 4, total: 950_000_000 });
    clock += 300_000;
    await index.refresh();
    assert.equal(index.listingArena({ streamer: DEMO_STREAMER, mint: MINT }).netFlow, "100000000");
    state.accounts[0].data = arenaBytes({ streamer: DEMO_STREAMER, mint: MINT, seasonStart: MONDAY, seasonSeconds: WEEK, positions: 3, total: 850_000_000 });
    clock = (MONDAY + 2 * 86_400) * 1000 + 600_000;
    await index.refresh();
    const history = index.history(demoArena);
    assert.equal(history.length, 5);
    assert.deepEqual(history.map((h) => h.total), ["750000000", "850000000", "850000000", "950000000", "850000000"]);
    assert.deepEqual(history.map((h) => h.slot), [500, 600, 600, 600, 600]);
    const files = readdirSync(join(dir, "market"));
    assert.equal(files.length, 2);
    assert.equal(files.map((f) => readFileSync(join(dir, "market", f), "utf8").trim().split("\n").length).reduce((a, b) => a + b, 0), 10, "two arenas per tick, five ticks");
    // Positions of one fan, with the arena's schedule for the release date.
    const mine = index.positionsOf(FAN);
    assert.equal(mine.length, 1);
    assert.deepEqual(mine[0], { arena: demoArena, address: fanPosition, state: "requested", amount: "500000000", requestedSeason: "1", openedAt: "1790600000", schedule: { seasonStart: String(MONDAY), seasonSeconds: String(WEEK), closed: false } });
    // Stale after two intervals without a tick; a failing upstream keeps the last good snapshot.
    clock += 2 * 300_000 + 1;
    assert.equal(index.status().stale, true);
    state.fail = true;
    await index.refresh();
    assert.equal(index.status().lastError, "boom");
    assert.equal(index.listingArena({ streamer: DEMO_STREAMER, mint: MINT }).total, "850000000", "last good snapshot stays");
    state.fail = false;
    // A new index reloads the day file into history.
    const again = createArenaIndex({ upstream: "https://devnet.example", fetchImpl, dir, now: () => clock, log: logs() });
    assert.equal(again.history(demoArena).length, 5);
    // Rows age out of the served window during the run, not only at load.
    clock += (HISTORY_DAYS + 8) * 86_400_000; // past every earlier tick, including the season-2 ones a week later
    state.slot = 700;
    await again.refresh();
    assert.equal(again.history(demoArena).length, 1, "only this tick's row is inside the window");
  });

  it("gives null net flow before a season has a snapshot, and downsamples long histories", async () => {
    const future = { slot: 1, accounts: [{ pubkey: demoArena, data: arenaBytes({ streamer: DEMO_STREAMER, mint: MINT, seasonStart: MONDAY + 10 * WEEK, seasonSeconds: WEEK, positions: 0, total: 0 }) }] };
    const index = createArenaIndex({ upstream: "https://devnet.example", fetchImpl: fakeUpstream(future).fetchImpl, dir: mkdtempSync(join(tmpdir(), "hub-market-f-")), now: () => (MONDAY + 1) * 1000, log: logs() });
    await index.refresh();
    const arena = index.listingArena({ streamer: DEMO_STREAMER, mint: MINT });
    assert.equal(arena.season, "0");
    assert.equal(arena.netFlow, null);
    const points = downsample(Array.from({ length: 2000 }, (_, i) => ({ i })), 400);
    assert.equal(points.length, 400);
    assert.equal(points[0].i, 0);
    assert.equal(points[399].i, 1999);
  });
});

describe("market routes through the station", () => {
  const state = { slot: 700, accounts: [] };
  let dir;
  let live;
  let base;
  const get = (path) => fetch(`${base}${path}`, { headers: { origin: ORIGIN, "cf-connecting-ip": "203.0.113.40" } }).then(async (r) => ({ status: r.status, json: await r.json() }));
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "hub-market-s-"));
    state.accounts = [
      { pubkey: demoArena, data: arenaBytes({ streamer: DEMO_STREAMER, mint: MINT, seasonStart: MONDAY, seasonSeconds: WEEK, positions: 1, total: 500_000_000 }) },
      { pubkey: fanPosition, data: positionBytes({ arena: demoArena, fan: FAN, amount: 500_000_000, requested: false }) },
    ];
    const reg = registry([
      { slug: "radiolanlive", name: "Radio LAN", kind: "featured", twitch: "radiolanlive", streamer: OFFICIAL_STREAMER, mint: MINT },
      { slug: "demo-one", name: "Demo One", kind: "demo", twitch: null, streamer: DEMO_STREAMER, mint: MINT, blurb: "Fictional." },
      { slug: "ninja", name: "ninja", kind: "tracked", twitch: "ninja" },
    ]);
    const board = { kind: "twitch_live", source: "twitch public", generated_at: "2026-10-02T23:00:00.000Z", live_count: 1, rows: [{ kind: "twitch_live", login: "ninja", display_name: "Ninja", is_live: true, viewer_count: 12_345, game_name: "Fortnite", started_at: "2026-10-02T21:00:00.000Z", rank: 1, delta_viewers: 120 }], offline: ["radiolanlive"], errors: [] };
    live = createLiveServer({
      oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, log: logs(),
      hubOrigins: ORIGIN, hubStore: createHubStore({ dir }), hubRpcUrl: "https://devnet.example", hubRpcFetch: fakeUpstream(state).fetchImpl, hubRegistry: reg, hubMarketIntervalMs: 300_000,
      enableBoard: true, boardFetch: async () => board,
    });
    const { port } = await live.listen({ port: 0 });
    base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50 && (await get("/hub/api/market")).json.observedAt === null; i += 1) await new Promise((r) => setTimeout(r, 20));
  });
  after(async () => {
    await live.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the board: every listing, backing only where an arena exists, Twitch rows labelled and separate", async () => {
    const { status, json } = await get("/hub/api/market");
    assert.equal(status, 200);
    assert.equal(json.network, "devnet");
    assert.equal(json.stale, false);
    assert.ok(json.observedAt && json.slot === 700);
    assert.deepEqual(json.listings.map((l) => [l.slug, l.kind, l.demo, l.backingOpen]), [["radiolanlive", "featured", false, false], ["demo-one", "demo", true, true], ["ninja", "tracked", false, false]]);
    const lan = json.listings[0];
    assert.equal(lan.arena, null, "the official devnet arena does not exist yet");
    assert.deepEqual(lan.performance, { live: false, viewers: null, game: null, startedAt: null, rank: null, deltaViewers: null, provenance: "Data: Twitch. Recorded by radiolanlive at 2026-10-02T23:00:00.000Z." }, "an offline tracked channel is a recorded read, not a missing one");
    assert.deepEqual(lan.keys, { streamer: OFFICIAL_STREAMER, mint: MINT }, "the pair is served so the page can offer the setup step");
    assert.equal(json.listings[2].keys, null);
    const demo = json.listings[1];
    assert.equal(demo.arena.total, "500000000");
    assert.equal(demo.arena.backers, "1");
    assert.equal(demo.performance, null);
    const ninja = json.listings[2];
    assert.equal(ninja.arena, null);
    assert.equal(ninja.performance.live, true);
    assert.equal(ninja.performance.viewers, 12_345);
    assert.equal(ninja.performance.provenance, "Data: Twitch. Recorded by radiolanlive at 2026-10-02T23:00:00.000Z.");
    assert.ok(!("price" in demo) && !("price" in ninja));
  });

  it("serves one listing with its history, 404s an unknown slug, and lists a fan's positions with their listing", async () => {
    const one = await get("/hub/api/market/demo-one");
    assert.equal(one.status, 200);
    assert.equal(one.json.listing.slug, "demo-one");
    assert.equal(one.json.listing.history.length, 1);
    assert.equal(one.json.listing.history[0].total, "500000000");
    assert.equal((await get("/hub/api/market/nope")).status, 404);
    assert.equal((await get("/hub/api/market/Bad%20Slug")).status, 404);
    const mine = await get(`/hub/api/market/positions?fan=${FAN}`);
    assert.equal(mine.status, 200);
    assert.equal(mine.json.positions.length, 1);
    assert.equal(mine.json.positions[0].slug, "demo-one");
    assert.equal(mine.json.positions[0].amount, "500000000");
    assert.equal((await get("/hub/api/market/positions?fan=nope")).json.error, "fan_address_required");
    assert.equal((await get("/hub/api/market/positions")).json.error, "fan_address_required");
  });

  it("answers 404 for the market without an upstream (the index needs RADIOLAN_RPC_URL)", async () => {
    const plain = createLiveServer({ oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, log: logs(), hubOrigins: ORIGIN, hubStore: createHubStore({ dir: mkdtempSync(join(tmpdir(), "hub-market-n-")) }) });
    const { port } = await plain.listen({ port: 0 });
    try {
      const r = await fetch(`http://127.0.0.1:${port}/hub/api/market`, { headers: { "cf-connecting-ip": "203.0.113.41" } });
      assert.equal(r.status, 404);
    } finally {
      await plain.close();
    }
  });
});
