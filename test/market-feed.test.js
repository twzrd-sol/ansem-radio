import assert from "node:assert/strict";
import test from "node:test";

import { createMarketFeed, toPublicBoard } from "../src/live/market-feed.js";
import { twitchBoard } from "./twitch-fixtures.js";

function board(extra = {}) {
  return { ...twitchBoard(), errors: [{ login: "ninja", error: "status_503" }], ...extra };
}

test("public board keeps the Twitch row fields, drops titles and error detail, and refuses other row kinds", () => {
  const pub = toPublicBoard(board());
  assert.equal(pub.kind, "twitch_live");
  assert.equal(pub.rows.length, 2);
  assert.deepEqual(Object.keys(pub.rows[0]), ["kind", "login", "display_name", "is_live", "viewer_count", "game_id", "game_name", "started_at", "minutes_live", "rank", "gap_to_leader", "delta_viewers"]);
  assert.equal(pub.rows[0].viewer_count, 41250);
  assert.deepEqual(pub.errors, ["ninja"]);
  assert.equal(JSON.stringify(pub).includes("http"), false);
  assert.throws(() => toPublicBoard(null), /board/);
  assert.throws(() => toPublicBoard({ rows: [{ kind: "price", probability: 0.4 }] }), /twitch_live/);
});

test("market feed refreshes on start, reschedules, emits, and survives fetch failures", async () => {
  let calls = 0;
  const scheduled = [];
  const emitted = [];
  const feed = createMarketFeed({
    fetchBoard: async () => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error("down"), { code: "upstream_down" });
      return board();
    },
    intervalMs: 5000,
    schedule: (fn, ms) => { scheduled.push([fn, ms]); return scheduled.length; },
    cancel: () => {},
    now: () => Date.parse("2026-09-30T00:00:00Z"),
  });
  feed.subscribe((type, data) => emitted.push([type, data.last_error, data.board?.rows.length ?? null]));

  const first = await feed.start();
  assert.equal(first.enabled, true);
  assert.equal(first.board.rows.length, 2);
  assert.equal(first.updated_at, "2026-09-30T00:00:00.000Z");
  assert.deepEqual(scheduled.map(([, ms]) => ms), [5000]);

  await scheduled[0][0]();
  const second = feed.snapshot();
  assert.equal(second.last_error, "upstream_down");
  assert.equal(second.board.rows.length, 2, "last good board is kept");
  assert.equal(scheduled.length, 2);

  feed.stop();
  await scheduled[1][0]();
  assert.equal(calls, 2, "no fetch after stop");
  assert.deepEqual(emitted, [["board", null, 2], ["board", "upstream_down", 2]]);
  assert.throws(() => createMarketFeed({ fetchBoard: 1 }), /fetchBoard/);
});

test("public board carries twitch rows with their own field set, and the feed hands the previous raw board back for deltas", async () => {
  const { buildTwitchBoard, normalizeTwitchStream } = await import("../src/markets/twitch-metrics.js");
  const at = "2026-09-30T03:00:00Z";
  const raw = buildTwitchBoard([normalizeTwitchStream({ user_login: "xqc", user_name: "xQc", type: "live", viewer_count: 30000, game_name: "Slots", title: "come to https://example.com now", started_at: "2026-09-30T02:00:00Z" }, "xqc", at)], { now: () => Date.parse(at) });
  const pub = toPublicBoard({ ...raw, errors: [{ error: "status_401" }] });
  assert.equal(pub.kind, "twitch_live");
  assert.deepEqual(Object.keys(pub.rows[0]), ["kind", "login", "display_name", "is_live", "viewer_count", "game_id", "game_name", "started_at", "minutes_live", "rank", "gap_to_leader", "delta_viewers"]);
  assert.equal(JSON.stringify(pub).includes("http"), false, "third-party titles never reach the payload");
  assert.deepEqual(pub.errors, ["status_401"]);
  assert.equal(pub.live_count, 1);

  const seen = [];
  const feed = createMarketFeed({
    fetchBoard: async ({ previous }) => { seen.push(previous ? previous.generated_at : null); return { ...raw, errors: [] }; },
    intervalMs: 1000,
    schedule: () => 1,
    cancel: () => {},
    now: () => Date.parse(at),
  });
  await feed.start();
  await feed.refresh();
  assert.deepEqual(seen, [null, raw.generated_at]);
  feed.stop();
});
