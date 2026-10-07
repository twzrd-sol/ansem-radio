// Provisional points equal settled points: the same credits, signed by an ephemeral creator key, through
// settleSeason (src/arena/season.js) and unsigned through provisionalPoints (src/hub/points.js).
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";

import { eventId, eventPreimage, settleSeason } from "../src/arena/season.js";
import { encodeBase58 } from "../src/core/base58.js";
import { actionId, provisionalPoints } from "../src/hub/points.js";

const ARENA = "GwYjjFYcc4DV8hLE6bCAQiM3rjstGWNZ6p3icjR7ZnxU";
const SEASON_START = 1_790_553_600;
const WEEK = 604_800;
const ACTIONS = ["question", "poll_response", "accepted_work"];

describe("provisional points match settlement", () => {
  it("awards the same per-account totals as settleSeason on the same credits, caps included", () => {
    const creator = generateKeyPairSync("ed25519");
    const raw = creator.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const config = {
      network: "devnet", arena: ARENA, creator: encodeBase58(new Uint8Array(raw)), season: "2",
      arenaSeasonStart: SEASON_START, arenaSeasonSeconds: WEEK,
      startsAt: SEASON_START + WEEK, endsAt: SEASON_START + 2 * WEEK, claimDeadline: SEASON_START + 3 * WEEK,
      asset: "SOL", budgetBaseUnits: "1000000000",
      policy: { dailyCap: 25, weeklyCap: 60, weights: { question: 10, poll_response: 5, accepted_work: 20 } },
    };
    // 3 accounts, 40 credits spread over the week with a deterministic pattern that crosses both caps.
    const accounts = [1, 2, 3].map((n) => createHash("sha256").update(`fan-${n}`).digest("hex"));
    const credits = [];
    for (let i = 0; i < 40; i += 1) {
      const accountId = accounts[i % 3];
      const action = ACTIONS[(i * 7) % 3];
      const occurredAt = config.startsAt + ((i * 9_973) % (WEEK - 1));
      const id = actionId([config.season, action, `item-${i}`]);
      credits.push({ accountId, action, actionId: id, occurredAt });
    }
    const signedEvents = credits.map((c) => {
      const event = { type: "credit", source: "arena_native", network: "devnet", arena: ARENA, season: "2", accountId: c.accountId, actionId: c.actionId, action: c.action, occurredAt: c.occurredAt };
      return { event, signature: Buffer.from(sign(null, eventPreimage(event), creator.privateKey)).toString("hex") };
    });
    const settled = settleSeason(config, signedEvents, { now: config.endsAt + 1 });
    assert.equal(settled.rejectedEvents.length, 0);
    // The hub sorts by its own submission id where settlement sorts by event id; same time, different tiebreak,
    // so give the hub rows the settlement's ids and compare the totals, which caps make order-sensitive.
    const rows = credits.map((c, i) => ({ ...c, status: "credited", id: eventId(signedEvents[i].event) }));
    const { scores } = provisionalPoints(config.policy, rows);
    const expected = Object.fromEntries(settled.receipts.map((r) => [r.accountId, r.points]));
    const actual = Object.fromEntries([...scores].map(([a, p]) => [a, p.toString()]));
    assert.deepEqual(actual, expected);
    assert.ok(Object.values(actual).some((p) => p === "60"), "the weekly cap was reached by at least one account");
    assert.equal(settled.manifest.totalPoints, Object.values(actual).reduce((s, p) => s + Number(p), 0).toString());
  });

  it("is order independent within a day only up to the caps, like settlement", () => {
    const policy = { dailyCap: 12, weeklyCap: 100, weights: { question: 10, poll_response: 5, accepted_work: 20 } };
    const a = "a".repeat(64);
    const rows = [
      { accountId: a, action: "poll_response", occurredAt: 100, id: "2" },
      { accountId: a, action: "question", occurredAt: 100, id: "1" },
    ];
    const { scores, today } = provisionalPoints(policy, rows, { now: 100 });
    assert.equal(scores.get(a), 12n, "question first (id 1) gets 10, the poll answer gets the remaining 2");
    assert.equal(today.get(a), 12n);
    assert.equal(provisionalPoints(policy, rows, { now: 86_400 + 100 }).today.get(a), undefined, "a day later nothing counts as today");
  });
});

describe("Twitch marks", () => {
  const policy = { dailyCap: 25, weeklyCap: 60, weights: { question: 10, poll_response: 5, accepted_work: 20, twitch_mark: 4 } };
  const row = { accountId: "a".repeat(64), action: "twitch_mark", source: "twitch", occurredAt: 100, id: "t1" };

  it("scores a Twitch mark only when the flag is on and the operator set that weight", () => {
    assert.equal(provisionalPoints(policy, [row]).scores.get(row.accountId), undefined);
    assert.equal(provisionalPoints(policy, [row], { twitch: true }).scores.get(row.accountId), 4n);
    const borrowed = { ...policy, weights: { question: 10, poll_response: 5, accepted_work: 20 } };
    assert.equal(provisionalPoints(borrowed, [row], { twitch: true }).scores.get(row.accountId), undefined, "a missing twitch_mark weight is not taken from question");
  });

  it("refuses a viewer count or a watch minute as the points input", () => {
    for (const extra of [{ viewers: 1000 }, { minutes: 30 }]) {
      assert.equal(provisionalPoints(policy, [{ ...row, ...extra }], { twitch: true }).scores.get(row.accountId), undefined);
    }
  });

  it("still scores a site question when the Twitch flag is off", () => {
    const site = { accountId: "b".repeat(64), action: "question", occurredAt: 100, id: "q1" };
    const { scores } = provisionalPoints(policy, [site, row]);
    assert.equal(scores.get(site.accountId), 10n);
    assert.equal(scores.get(row.accountId), undefined);
  });

  it("never encodes a Twitch mark as a native settlement event, on any proposed network", () => {
    for (const network of ["devnet", "mainnet", "mainnet-beta"]) {
      const event = { type: "credit", source: "arena_native", network, arena: ARENA, season: "2",
        accountId: row.accountId, actionId: actionId(["twitch", network]), action: "twitch_mark", occurredAt: 100 };
      assert.throws(() => eventPreimage(event), /unknown native arena action/);
      assert.throws(() => eventPreimage({ ...event, source: "twitch", action: "question" }), /native/);
    }
  });

  it("keeps a Twitch mark inside the same daily cap as the other activities", () => {
    const tight = { ...policy, dailyCap: 6, weeklyCap: 60 };
    const rows = [row, { ...row, id: "t2", occurredAt: 200 }];
    assert.equal(provisionalPoints(tight, rows, { twitch: true, now: 200 }).scores.get(row.accountId), 6n);
  });
});
