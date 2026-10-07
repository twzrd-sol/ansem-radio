import assert from "node:assert/strict";
import test from "node:test";

import {
  TRACKED_STREAMERS,
  buildTwitchBoard,
  describeTwitchRow,
  fetchTwitchBoard,
  normalizeTwitchStream,
} from "../src/markets/twitch-metrics.js";

const AT = "2026-09-30T03:00:00Z";

function stream(login, viewers, overrides = {}) {
  return {
    id: `id-${login}`, user_id: "1", user_login: login, user_name: login.toUpperCase(),
    game_id: "509658", game_name: "Just Chatting", type: "live", title: `${login} live  with   spaces`,
    viewer_count: viewers, started_at: "2026-09-30T02:15:00Z", ...overrides,
  };
}

test("normalize keeps public live metrics only and marks missing streams offline", () => {
  const live = normalizeTwitchStream(stream("kaicenat", 41250), "KaiCenat", AT);
  assert.equal(live.kind, "twitch_live");
  assert.equal(live.is_live, true);
  assert.equal(live.viewer_count, 41250);
  assert.equal(live.minutes_live, 45);
  assert.equal(live.game_id, "509658", "stable category id is kept for accounting");
  assert.equal(live.title, "kaicenat live with spaces");
  assert.equal(JSON.stringify(live).includes("thumbnail"), false);
  const dark = normalizeTwitchStream(null, "ninja", AT);
  assert.equal(dark.is_live, false);
  assert.equal(dark.viewer_count, null);
  assert.throws(() => normalizeTwitchStream(stream("xqc", 1), "ninja", AT), /does not match/);
  assert.throws(() => normalizeTwitchStream(null, "no spaces!", AT), /login/);
});

test("board ranks live rows, computes gaps, deltas from the previous board, a race, and the dark list", () => {
  const rows = [
    normalizeTwitchStream(stream("kaicenat", 41250), "kaicenat", AT),
    normalizeTwitchStream(stream("jynxzi", 22000), "jynxzi", AT),
    normalizeTwitchStream(stream("xqc", 30000), "xqc", AT),
    normalizeTwitchStream(null, "ninja", AT),
  ];
  const previous = buildTwitchBoard([
    normalizeTwitchStream(stream("kaicenat", 40000), "kaicenat", AT),
    normalizeTwitchStream(stream("xqc", 31000), "xqc", AT),
  ], { now: () => Date.parse(AT) - 60_000 });
  const board = buildTwitchBoard(rows, { previous, now: () => Date.parse(AT) });
  assert.deepEqual(board.rows.map((row) => [row.login, row.rank, row.gap_to_leader, row.delta_viewers]), [
    ["kaicenat", 1, 0, 1250],
    ["xqc", 2, 11250, -1000],
    ["jynxzi", 3, 19250, null],
  ]);
  assert.deepEqual(board.race, { a: "kaicenat", b: "xqc", gap: 11250 });
  assert.deepEqual(board.offline, ["ninja"]);
  assert.equal(board.live_count, 3);
  assert.equal(board.tracked_live_viewers, 93250);
  const capped = buildTwitchBoard(rows, { previous, now: () => Date.parse(AT), limit: 2 });
  assert.equal(capped.displayed_count, 2);
  assert.equal(capped.live_count, 3, "live count is every tracked live channel");
  assert.equal(capped.tracked_live_viewers, 93250, "totals never shrink to the displayed subset");
  assert.equal(JSON.stringify(board).includes("http"), false);
});

test("describeTwitchRow is one chat-safe sentence", () => {
  const board = buildTwitchBoard([normalizeTwitchStream(stream("kaicenat", 41250), "kaicenat", AT)], { now: () => Date.parse(AT) });
  assert.equal(describeTwitchRow(board.rows[0]), "#1 KAICENAT: 41,250 watching in Just Chatting, live 45 min");
  assert.equal(describeTwitchRow(normalizeTwitchStream(null, "ninja", AT)), "ninja is offline");
});

test("fetchTwitchBoard sends one Helix call with Client-Id and Bearer, reports errors, never throws, and the board object has no all_rows", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init.headers]);
    return { ok: true, status: 200, json: async () => ({ data: [stream("kaicenat", 100), stream("ninja", 50)] }) };
  };
  const board = await fetchTwitchBoard({ fetchImpl, clientId: "cid", token: "oauth:tok", now: () => Date.parse(AT) });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /helix\/streams\?first=100&user_login=kaicenat/);
  assert.equal(calls[0][1]["Client-Id"], "cid");
  assert.equal(calls[0][1].Authorization, "Bearer tok");
  assert.equal(board.rows.length, 2);
  assert.equal(board.offline.length, TRACKED_STREAMERS.length - 2);
  assert.equal(Object.hasOwn(board, "all_rows"), false);
  assert.deepEqual(board.errors, []);

  const noCreds = await fetchTwitchBoard({ fetchImpl, clientId: "", token: "" });
  assert.deepEqual(noCreds.errors, [{ error: "twitch_credentials_missing" }]);
  assert.equal(noCreds.live_count, 0);

  const denied = await fetchTwitchBoard({ fetchImpl: async () => ({ ok: false, status: 401 }), clientId: "cid", token: "t" });
  assert.deepEqual(denied.errors, [{ error: "status_401" }]);
  const down = await fetchTwitchBoard({ fetchImpl: async () => { throw new Error("net"); }, clientId: "cid", token: "t" });
  assert.deepEqual(down.errors, [{ error: "fetch_failed" }]);
});
