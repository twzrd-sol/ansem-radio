import assert from "node:assert/strict";
import test from "node:test";

import { createCultureAggregator, cultureTable, hourOf } from "../src/timeline/culture.js";

test("hours are UTC and floor to the hour", () => {
  assert.equal(hourOf("2026-10-01T20:59:59Z"), "2026-10-01T20:00Z");
  assert.throws(() => hourOf("x"), TypeError);
  assert.ok(Number.isFinite(Date.parse(hourOf("2026-10-01T20:30:00Z"))), "hour labels must parse");
});

test("a rollup counts live minutes, average and peak viewers, sessions and the top category", () => {
  const c = createCultureAggregator();
  const at = (m) => `2026-10-01T20:${String(m).padStart(2, "0")}:00Z`;
  c.sample(at(0), [{ login: "KaiCenat", is_live: true, viewer_count: 100, game_name: "Just Chatting", started_at: "s1" }, { login: "ninja", is_live: false }]);
  c.sample(at(1), [{ login: "kaicenat", is_live: true, viewer_count: 300, game_name: "Just Chatting", started_at: "s1" }]);
  c.sample(at(2), [{ login: "kaicenat", is_live: true, viewer_count: 200, game_name: "IRL", started_at: "s2" }, { login: "bad login!", is_live: true, viewer_count: 5 }]);
  assert.deepEqual(c.flush(at(59)), []);
  const out = c.flush("2026-10-01T21:00:00Z");
  assert.deepEqual(out.map((r) => r.login), ["kaicenat", "ninja"]);
  const k = out[0];
  assert.deepEqual([k.sampled_minutes, k.minutes_live, k.avg_viewers, k.peak_viewers, k.viewer_minutes, k.sessions, k.top_category], [3, 3, 200, 300, 600, 2, "Just Chatting"]);
  assert.deepEqual([out[1].minutes_live, out[1].avg_viewers, out[1].peak_viewers], [0, null, null]);
});

test("the culture table ranks streamers by share of attention over a window", () => {
  const table = cultureTable([
    { login: "a", minutes_live: 60, viewer_minutes: 60_000, peak_viewers: 1500, sessions: 1, top_category: "Just Chatting" },
    { login: "b", minutes_live: 30, viewer_minutes: 90_000, peak_viewers: 4000, sessions: 1, top_category: "GTA V" },
    { login: "a", minutes_live: 60, viewer_minutes: 30_000, peak_viewers: 900, sessions: 0, top_category: "IRL" },
    { login: "c", minutes_live: 0, viewer_minutes: 0, peak_viewers: null, sessions: 0, top_category: null },
  ]);
  assert.deepEqual(table.map((t) => [t.login, t.attention_share, t.minutes_live, t.avg_viewers, t.peak_viewers]), [["a", 0.5, 120, 750, 1500], ["b", 0.5, 30, 3000, 4000], ["c", 0, 0, null, null]]);
  assert.equal(table[0].top_category, "Just Chatting");
});
