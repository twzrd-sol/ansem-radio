// The season finalizer with an injected clock and timer: frozen once at endsAt, never rewritten, caught up on restart,
// served by GET /hub/api/season/<n>, handles only, labelled provisional.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { normalizeConfig } from "../src/arena/season.js";
import { handleOf } from "../src/hub/api.js";
import { createSeasonFinalizer, FROZEN_LABEL, recapOf, seasonPath } from "../src/hub/finalizer.js";
import { rankAccounts } from "../src/hub/points.js";
import { createHubStore } from "../src/hub/store.js";
import { createLiveServer } from "../src/live/server.js";

const START = 1_790_553_600; // Mon 2026-09-28 00:00 UTC
const WEEK = 604_800;
const SEASON = {
  network: "devnet", arena: "BFFa5XyRSkoZ4F7EHrWkNDPXFumQwBm66C2KGL5KvnEu", creator: "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb", season: "1",
  arenaSeasonStart: START, arenaSeasonSeconds: WEEK, startsAt: START, endsAt: START + WEEK, claimDeadline: START + 2 * WEEK,
  asset: "SOL", budgetBaseUnits: "0",
  policy: { dailyCap: 25, weeklyCap: 100, weights: { question: 10, poll_response: 5, accepted_work: 20 } },
};
const config = normalizeConfig(SEASON);
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const logs = () => ({ info() {}, warn() {}, error() {} });
const row = (accountId, action, occurredAt, n, status = "credited", season = "1") => ({ id: `${accountId}:${n}`, accountId, season, action, actionId: String(n).padStart(64, "0"), occurredAt, status, detail: {} });

function seeded() {
  const dir = mkdtempSync(join(tmpdir(), "hub-final-"));
  const store = createHubStore({ dir });
  for (const id of [A, B, C]) store.createAccount({ id, credentials: [], joined: { "1": START } });
  store.addSubmission(row(A, "question", START + 100, 1));
  store.addSubmission(row(A, "poll_response", START + 200, 2));
  store.addSubmission(row(B, "question", START + 50, 3));
  store.addSubmission(row(B, "poll_response", START + 86_400, 4));
  store.addSubmission(row(C, "accepted_work", START + 300, 5, "pending"));
  store.addSubmission(row(C, "question", START + WEEK + 10, 6)); // after the end: never counted
  store.addSubmission(row(A, "question", START + 400, 7, "credited", "2")); // another season
  return { dir, store };
}
const rank = (credited) => rankAccounts(config.policy, credited);

describe("season finalizer", () => {
  it("recaps one season with handles only, ranked, labelled provisional and unsigned", () => {
    const { dir, store } = seeded();
    const recap = recapOf({ config, submissions: store.submissions(), rank, handleOf, frozenAt: START + WEEK });
    assert.equal(recap.label, FROZEN_LABEL);
    assert.equal(recap.signed, false);
    assert.deepEqual(recap.scores, [{ rank: 1, handle: handleOf(B), points: "15" }, { rank: 2, handle: handleOf(A), points: "15" }], "a tie goes to the earlier first credit");
    assert.equal(recap.totalPoints, "30");
    assert.equal(recap.credited, 4, "the post-end question and the other season are out");
    assert.equal(recap.pendingAtClose, 1);
    assert.equal(recap.players, 3);
    assert.ok(!JSON.stringify(recap).includes(A), "never an account id");
    rmSync(dir, { recursive: true, force: true });
  });

  it("arms one timer for the end, freezes when it fires, and never rewrites the file", () => {
    const { dir, store } = seeded();
    let clock = START + WEEK - 3_600;
    const timers = [];
    const f = createSeasonFinalizer({ config, store, rank, handleOf, now: () => clock, schedule: (fn, ms) => (timers.push({ fn, ms }), timers.length), cancel: () => {}, log: logs() });
    f.start();
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 3_600_000);
    assert.equal(f.frozen(), null);
    clock = START + WEEK;
    timers[0].fn();
    const frozen = f.frozen();
    assert.equal(frozen.frozenAt, START + WEEK);
    assert.equal(frozen.scores.length, 2);
    const before = readFileSync(seasonPath(dir, "1"), "utf8");
    assert.equal(statSync(seasonPath(dir, "1")).mode & 0o777, 0o600);
    store.addSubmission(row(C, "question", START + 500, 8)); // a late write cannot change a frozen season
    clock += 60;
    assert.equal(f.freeze(), null);
    assert.equal(readFileSync(seasonPath(dir, "1"), "utf8"), before);
    rmSync(dir, { recursive: true, force: true });
  });

  it("catches up on restart: a passed end with no file freezes on start, with no timer", () => {
    const { dir, store } = seeded();
    const timers = [];
    const f = createSeasonFinalizer({ config, store, rank, handleOf, now: () => START + WEEK + 86_400, schedule: (fn, ms) => (timers.push({ fn, ms }), 1), log: logs() });
    f.start();
    assert.equal(timers.length, 0);
    assert.equal(f.frozen().frozenAt, START + WEEK + 86_400);
    assert.equal(f.frozen().scores[0].handle, handleOf(B));
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the recap through the station: 409 while open, the recap after the end, 404 for an unknown season", async () => {
    const { dir, store } = seeded();
    let clock = START + WEEK - 60;
    const timers = [];
    const live = createLiveServer({ oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, log: logs(), hubOrigins: "https://hub.example", hubStore: store, hubSeason: SEASON, hubClock: () => clock, hubSchedule: (fn, ms) => (timers.push({ fn, ms }), 1), hubCancel: () => {} });
    const { port } = await live.listen({ port: 0 });
    const get = (p) => fetch(`http://127.0.0.1:${port}${p}`, { headers: { "cf-connecting-ip": "203.0.113.70" } }).then(async (r) => ({ status: r.status, json: await r.json() }));
    try {
      const open = await get("/hub/api/season/1");
      assert.equal(open.status, 409);
      assert.equal(open.json.error, "season_still_open");
      assert.equal(timers.length, 1, "the station armed the finalizer at listen");
      clock = START + WEEK;
      timers[0].fn();
      const done = await get("/hub/api/season/1");
      assert.equal(done.status, 200);
      assert.equal(done.json.recap.label, FROZEN_LABEL);
      assert.deepEqual(done.json.recap.scores.map((s) => s.points), ["15", "15"]);
      assert.equal((await get("/hub/api/season/9")).status, 404);
      // The state serves the frozen season as the hub's past season: provisional, top three, no personal row signed out.
      const state = await get("/hub/api/state");
      assert.deepEqual(state.json.lastSeason, { number: 1, players: 3, eligiblePoints: 30, reward: { kind: "provisional" }, me: null, top: [[handleOf(B), 15], [handleOf(A), 15]], endsAt: START + WEEK, frozenAt: START + WEEK, label: FROZEN_LABEL });
      assert.equal((await get("/hub/api/season/abc")).status, 404);
    } finally {
      await live.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
