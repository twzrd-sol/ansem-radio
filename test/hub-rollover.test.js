// Season rollover: the hub follows the arena's recurring schedule with no restart. The published season is shifted by
// whole seasons (number, window, claim deadline), every derived config is strictly re-normalized, the finalizer
// freezes each ended season once and re-arms for the next, and the API serves the season in force at each instant.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { handleOf } from "../src/hub/api.js";
import { createSeasonFinalizer, readFrozen } from "../src/hub/finalizer.js";
import { rankAccounts } from "../src/hub/points.js";
import { createSeasons } from "../src/hub/rollover.js";
import { createHubStore } from "../src/hub/store.js";
import { createLiveServer } from "../src/live/server.js";

const START = 1_790_553_600; // Mon 2026-09-28 00:00 UTC
const WEEK = 604_800;
const RAW = {
  network: "devnet", arena: "BdMQ9bKdvbk6u1eKEicnwMuK6EAgjp1DinibBseBshWa", creator: "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb", season: "1",
  arenaSeasonStart: START, arenaSeasonSeconds: WEEK, startsAt: START, endsAt: START + WEEK, claimDeadline: START + 2 * WEEK,
  asset: "SOL", budgetBaseUnits: "0",
  policy: { dailyCap: 20, weeklyCap: 200, weights: { question: 10, poll_response: 10, accepted_work: 20 } },
};
const A = "a".repeat(64);
const logs = () => ({ info() {}, warn() {}, error() {} });
const credit = (accountId, n, occurredAt, season) => ({ id: `${accountId}:${n}`, accountId, season, action: "poll_response", actionId: String(n).padStart(64, "0"), occurredAt, status: "credited" });

describe("rollover helper", () => {
  it("keeps the published season until its end, then shifts number, window and claim deadline together", () => {
    const s = createSeasons(RAW);
    assert.equal(s.at(START).season, "1");
    assert.equal(s.at(START + WEEK - 1).season, "1", "the last second of season 1");
    const two = s.at(START + WEEK);
    assert.equal(two.season, "2", "the exact boundary second is season 2");
    assert.deepEqual([two.startsAt, two.endsAt, two.claimDeadline], [START + WEEK, START + 2 * WEEK, START + 3 * WEEK]);
    assert.equal(s.at(START + 5 * WEEK + 123).season, "6");
    assert.deepEqual(s.endedBefore(START + WEEK - 1), []);
    assert.deepEqual(s.endedBefore(START + WEEK).map((c) => c.season), ["1"]);
    assert.deepEqual(s.endedBefore(START + 3 * WEEK + 1).map((c) => c.season), ["1", "2", "3"]);
    assert.equal(s.endedBefore(START + 40 * WEEK).length, 8, "catch-up looks back over a bounded number of seasons");
  });

  it("with recurring off, nothing follows the one published season", () => {
    const s = createSeasons(RAW, { recurring: false });
    assert.equal(s.at(START + 9 * WEEK).season, "1");
    assert.deepEqual(s.endedBefore(START + 9 * WEEK).map((c) => c.season), ["1"]);
  });

  it("refuses a config whose window disagrees with the arena schedule before any shifting", () => {
    assert.throws(() => createSeasons({ ...RAW, endsAt: START + WEEK + 1 }), /season window does not match/);
  });
});

describe("finalizer across a rollover", () => {
  const rank = (credited, c) => rankAccounts(c.policy, credited);
  it("freezes season 1 at its end, re-arms for season 2, and catches up several ended seasons after downtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-roll-"));
    const store = createHubStore({ dir });
    store.addSubmission(credit(A, 1, START + 100, "1"));
    store.addSubmission(credit(A, 2, START + WEEK + 100, "2"));
    let clock = START + 10;
    const timers = [];
    const seasons = createSeasons(RAW);
    const fin = createSeasonFinalizer({ seasons, store, dir, rank, handleOf, now: () => clock, schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, cancel() {}, log: logs() });
    fin.start();
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, (WEEK - 10) * 1000, "one timer, for the end of the season in force");
    clock = START + WEEK;
    timers.shift().fn();
    assert.equal(readFrozen(dir, "1").totalPoints, "10", "season 1 frozen at the boundary");
    assert.equal(readFrozen(dir, "2"), null, "season 2 is open, not frozen");
    assert.equal(timers[0].ms, WEEK * 1000, "re-armed for the end of season 2");
    clock = START + 2 * WEEK;
    timers.shift().fn();
    assert.equal(readFrozen(dir, "2").totalPoints, "10");
    assert.deepEqual(readdirSync(join(dir, "seasons")).sort(), ["1.json", "2.json"]);
    // Restart after downtime: three seasons ended while down; each is frozen once, nothing rewritten.
    const dir2 = mkdtempSync(join(tmpdir(), "hub-roll2-"));
    const store2 = createHubStore({ dir: dir2 });
    store2.addSubmission(credit(A, 3, START + 2 * WEEK + 5, "3"));
    clock = START + 3 * WEEK + 77;
    const late = createSeasonFinalizer({ seasons: createSeasons(RAW), store: store2, dir: dir2, rank, handleOf, now: () => clock, schedule: (fn, ms) => { timers.push({ fn, ms }); return 9; }, cancel() {}, log: logs() });
    late.start();
    assert.deepEqual(readdirSync(join(dir2, "seasons")).sort(), ["1.json", "2.json", "3.json"]);
    assert.equal(readFrozen(dir2, "3").totalPoints, "10");
    late.start();
    assert.equal(readdirSync(join(dir2, "seasons")).length, 3);
    rmSync(dir, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  });
});

describe("the API across a rollover", () => {
  it("serves season 1, then season 2 at the boundary second, with a fresh standing and the past season as lastSeason", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hub-roll-api-"));
    let clock = START + 3 * 86_400;
    const live = createLiveServer({
      oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, hubOrigins: "https://hub.example", hubStore: createHubStore({ dir }),
      hubSeason: RAW, hubSeasonRecurring: true, hubClock: () => clock, log: logs(),
    });
    const { port } = await live.listen({ port: 0 });
    t.after(async () => { await live.close(); rmSync(dir, { recursive: true, force: true }); });
    const state = async () => (await fetch(`http://127.0.0.1:${port}/hub/api/state`, { headers: { "cf-connecting-ip": "203.0.113.50" } })).json();
    const one = await state();
    assert.equal(one.season.number, "1");
    assert.equal(one.season.open, true);
    clock = START + WEEK - 1;
    assert.equal((await state()).season.number, "1");
    clock = START + WEEK;
    const two = await state();
    assert.equal(two.season.number, "2");
    assert.equal(two.season.open, true);
    assert.equal(two.season.startsAt, START + WEEK);
    assert.equal(two.season.endsAt, START + 2 * WEEK);
    assert.ok(two.lastSeason, "the season that just ended is served as the past season");
    assert.equal(two.lastSeason.number, 1);
    assert.match(two.lastSeason.label, /provisional/);
  });
});
