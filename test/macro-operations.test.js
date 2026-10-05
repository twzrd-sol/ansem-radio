import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { macroSnapshot } from "../src/timeline/macro.js";
import { operationalContext, readRecordedAnchor, recordedAnchor, macroCsv } from "../src/timeline/macro-operations.js";
const now = Date.parse("2026-10-02T02:00:00Z");
const from = now - 3600_000;
const iso = (ms) => new Date(ms).toISOString();
const board = { board: { rows: [] }, updated_at: iso(now) };
const context = (extra = {}) => operationalContext({ now, from, gaps: [], stationStale: false, board, ...extra });

test("only gaps of at least a minute inside the selected window alert, with stable deduplicated ids", () => {
  const gap = (start, end) => ({ start: iso(start), end: iso(end) });
  const qualifying = gap(now - 120_000, now - 60_000);
  const gaps = [gap(now - 2000, now), qualifying, qualifying,
    gap(from - 120_000, from + 2000), gap(now + 1000, now + 120_000),
    gap(now, now - 120_000), { start: "invalid", end: iso(now) }];
  const result = context({ gaps });
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].type, "coverage_gap");
  assert.equal(result.alerts[0].start, qualifying.start);
  assert.match(result.alerts[0].message, /60 seconds/);
  assert.deepEqual(context({ gaps: gaps.reverse() }).alerts, result.alerts);
  assert.equal(context({ gaps: [gap(from - 120_000, from + 60_000)] }).alerts[0].start, iso(from));
});

test("board availability includes feed errors and future/stale timestamps; an empty fresh board is valid", () => {
  assert.equal(context().board_status, "available");
  for (const bad of [null, { ...board, updated_at: iso(now - 120_001) }, { ...board, updated_at: iso(now + 1) }, { ...board, last_error: "failed" }, { ...board, board: { rows: [], errors: ["failed"] } }]) {
    const result = context({ board: bad });
    assert.notEqual(result.board_status, "available");
    assert.equal(result.alerts[0].type, "board_stale");
  }
  assert.equal(context({ stationStale: true }).alerts[0].type, "timeline_stale");
});

test("recorded anchor fields are allowlisted and invalid records never claim verification", async () => {
  const record = JSON.parse(readFileSync(new URL("../docs/examples/attribution-devnet/anchor.json", import.meta.url)));
  const anchor = recordedAnchor({ ...record, secret: "DO_NOT_EXPORT" });
  assert.equal(anchor.entries_are_fixtures, true);
  assert.equal(anchor.session_id, null);
  assert.equal(anchor.chain_check, "not_checked_by_dashboard");
  assert.equal(anchor.status, "recorded");
  assert.equal(JSON.stringify(anchor).includes("DO_NOT_EXPORT"), false);
  assert.deepEqual(await readRecordedAnchor(), anchor);
  for (const change of [{ network: "mainnet" }, { log_id: "other" }, { signature: "invalid" }, { ledger: "bad" }, { published_slot: -1 }, { head: { ...record.head, root: "bad" } }]) assert.equal(recordedAnchor({ ...record, ...change }), null);
});

test("CSV preserves quoted values, neutralizes formulas, and exports window share with its denominator", () => {
  const store = { readMinutes: () => [], readCulture: () => [
    { hour: iso(now - 3600_000), login: "alice", minutes_live: 60, viewer_minutes: 3000, avg_viewers: 50, peak_viewers: 80, sessions: 1, top_category: ' =HYPERLINK("bad")' },
    { hour: iso(now - 3600_000), login: "bobby", minutes_live: 60, viewer_minutes: 1000, avg_viewers: 17, peak_viewers: 20, sessions: 1, top_category: 'A,"B"\nC' }], readGaps: () => [] };
  const snapshot = macroSnapshot({ store, now, hours: 6, tracked: ["alice", "bobby"], board });
  assert.deepEqual(snapshot.streamers.map((s) => s.attention_share), [0.75, 0.25]);
  assert.equal(snapshot.totals.tracked_viewers_now, 0);
  const csv = macroCsv(snapshot);
  assert.ok(csv.includes('"75","percent_of_window_tracked_viewer_minutes"'));
  assert.ok(csv.includes('"\' =HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"A,""B""\\nC"'.replace('\\n', '\n')));
  assert.ok(csv.endsWith("\r\n"));
  assert.equal(macroSnapshot({ store, now, board: { ...board, last_error: "error" } }).totals.tracked_viewers_now, null);
});
