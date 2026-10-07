import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { playRecord } from "../src/hub/play-record.js";
import { createHubStore } from "../src/hub/store.js";
import { createLiveServer } from "../src/live/server.js";

const DAY = 86_400;
const row = (occurredAt, extra = {}) => ({ action: "question", status: "credited", season: "1", occurredAt, ...extra });

test("collector evidence excludes pending, providers, backing, invalid times and future play", () => {
  assert.deepEqual(playRecord([
    row(DAY, { status: "pending" }), row(DAY, { action: "twitch_mark" }), row(DAY, { source: "twitch" }),
    row(DAY, { action: "backing" }), row(NaN), row(-1), row(4 * DAY),
  ], 3 * DAY), { badges: [], activityDays: 0, streakDays: 0, playedToday: false, firstSeason: null });
});

test("distinct UTC days earn permanent marks across seasons; streaks require consecutive days", () => {
  const rows = [row(DAY + 4), row(DAY + 5), row(3 * DAY), row(4 * DAY, { season: "2", action: "accepted_work" })];
  const record = playRecord(rows.toReversed(), 4 * DAY + 1);
  assert.deepEqual(record, { badges: [{ id: "first_play", earnedAt: DAY + 4 }, { id: "three_days", earnedAt: 4 * DAY }], activityDays: 3, playedToday: true, streakDays: 2, firstSeason: 1 });
  assert.equal(playRecord(rows, 5 * DAY).streakDays, 2);
  assert.equal(playRecord(rows, 6 * DAY).streakDays, 0);
  assert.deepEqual(playRecord(rows, 6 * DAY).badges, record.badges);
  assert.equal(playRecord([row(DAY - 1), row(DAY)], DAY).activityDays, 2);
});

test("HTTP state preserves collector badges and a frozen recap after joining a new season", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hub-collector-"));
  const store = createHubStore({ dir });
  const accountId = "a".repeat(64);
  const started = 1_790_553_600;
  const season = { network: "devnet", arena: "GwYjjFYcc4DV8hLE6bCAQiM3rjstGWNZ6p3icjR7ZnxU", creator: "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb", season: "1", arenaSeasonStart: started, arenaSeasonSeconds: 604_800, startsAt: started, endsAt: started + 604_800, claimDeadline: started + 1_209_600, asset: "SOL", budgetBaseUnits: "0", policy: { dailyCap: 25, weeklyCap: 100, weights: { question: 10, poll_response: 5, accepted_work: 20 } } };
  const now = season.endsAt + 60;
  store.createAccount({ id: accountId, createdAt: started, credentials: [], joined: { "1": started } });
  store.createSession({ id: "t".repeat(43), accountId, csrf: "test-csrf", createdAt: now, expiresAt: now + DAY });
  for (let i = 0; i < 3; i++) store.addSubmission({ ...row(started + i * DAY), id: `play-${i}`, accountId });
  const live = createLiveServer({ oauthToken: "", hubOrigins: "http://localhost:4179", hubStore: store, hubSeason: season, hubSeasonRecurring: true, hubClock: () => now, hubRpcUrl: "", hubPolls: [], log: { info() {}, warn() {} } });
  try {
    const { port } = await live.listen({ port: 0 });
    const read = async () => (await fetch(`http://127.0.0.1:${port}/hub/api/state`, { headers: { cookie: `hub_session=${"t".repeat(43)}` } })).json();
    const state = await read();
    assert.equal(state.season.number, "2");
    assert.equal(state.me.joined, false);
    assert.equal(state.me.points, "0");
    assert.deepEqual(state.me.badges.map((b) => b.id), ["first_play", "three_days"]);
    assert.equal(state.history[0].points, 30);
    assert.equal(state.history[0].season, 1);
    assert.deepEqual(state.history[0].reward, { kind: "provisional" });
    assert.equal(state.history[0].rank, 1);
    assert.equal(JSON.stringify(state.season).includes(accountId), false);
  } finally { await live.close(); rmSync(dir, { recursive: true, force: true }); }
});
