import assert from "node:assert/strict";
import test from "node:test";

import { finalizeSession } from "../src/live/session-summary.js";

const window = { started_at: "2026-08-26T23:00:00Z", ended_at: "2026-08-27T00:30:00Z" };

test("LAN note cites duration, counts, and a declared poll winner", () => {
  const summary = finalizeSession({
    id: "show-1",
    ...window,
    observations: [
      { signal: "chat" },
      { signal: "chat" },
      { signal: "raid" },
    ],
    poll: {
      question: "Next guest city",
      options: ["Houston", "Atlanta"],
      winner: "Houston",
      declared_at: "2026-08-27T00:20:00Z",
    },
  });
  assert.equal(summary.duration_seconds, 5400);
  assert.deepEqual(summary.counts, { chat: 2, cheer: 0, subscription: 0, raid: 1, total: 3 });
  assert.equal(summary.poll.winner, "Houston");
  assert.equal(
    summary.note,
    "90-minute session. Observed 2 chat, 1 raid. Poll: Next guest city — Houston.",
  );
  assert.equal(JSON.stringify(summary).includes("user-hash"), false);
});

test("empty session stays silent and rejects invented poll winners", () => {
  const quiet = finalizeSession({ id: "show-quiet", ...window, observations: [] });
  assert.equal(quiet.counts.total, 0);
  assert.equal(quiet.poll, null);
  assert.equal(quiet.note, "90-minute session. No public observations. LAN has nothing to add.");
  assert.throws(
    () => finalizeSession({
      id: "bad-poll",
      ...window,
      poll: {
        question: "Next guest city",
        options: ["Houston", "Atlanta"],
        winner: "Chicago",
        declared_at: "2026-08-27T00:20:00Z",
      },
    }),
    /poll winner/,
  );
  assert.throws(
    () => finalizeSession({ id: "backwards", started_at: window.ended_at, ended_at: window.started_at }),
    /ended_at must be at or after started_at/,
  );
});

test("tape counts are windowed to the session and LAN cites only counts", () => {
  const out = finalizeSession({
    id: "s1",
    started_at: "2026-10-03T21:00:00Z",
    ended_at: "2026-10-03T22:00:00Z",
    observations: [{ signal: "chat" }, { signal: "raid" }],
    tape: [
      { id: "t1", observed_at: "2026-10-03T21:10:00Z", signal: "raid", kind: "raid_in" },
      { id: "t2", observed_at: "2026-10-03T21:11:00Z", signal: "raid", kind: "raid_in" },
      { id: "t3", observed_at: "2026-10-03T21:20:00Z", signal: "subscription", kind: "channel.subscription" },
      { id: "t4", observed_at: "2026-10-03T21:30:00Z", kind: "prediction_lock", labels: { title: "Encore?" } },
      // Different sessions: before and after the window. Never cited.
      { id: "t5", observed_at: "2026-10-03T20:59:59Z", signal: "raid", kind: "raid_in" },
      { id: "t6", observed_at: "2026-10-03T22:00:01Z", signal: "raid", kind: "raid_in" },
    ],
  });
  assert.deepEqual(out.tape, { raid: 2, subscription: 1, prediction: 1, total: 4 });
  assert.equal(out.note, "60-minute session. Observed 1 chat, 1 raid. Tape: 2 raids, 1 subscription, 1 prediction.");
  assert.ok(!out.note.includes("Encore") && !out.note.includes("Encore?"), "no titles, only counts");
});

test("an empty tape adds nothing to the note", () => {
  const out = finalizeSession({ id: "s", started_at: "2026-10-03T21:00:00Z", ended_at: "2026-10-03T21:30:00Z", tape: [] });
  assert.equal(out.note, "30-minute session. No public observations. LAN has nothing to add.");
});

test("an observation feed with a tape source cites the tape; without one, nothing changes", async () => {
  const { createObservationFeed } = await import("../src/live/observation-feed.js");
  const observe = (id, signal = "chat") => ({ provider: "twitch", id: String(id), signal, observed_at: "2026-10-03T21:00:01Z" });
  const taped = createObservationFeed({ tapeEvents: () => [{ id: "t1", observed_at: "2026-10-03T21:10:00Z", signal: "raid", kind: "raid_in" }] });
  taped.observe(observe("o1", "raid"));
  assert.match(taped.lanSnapshot().note, /Tape: 1 raid\.?/);
  assert.deepEqual(taped.lanSnapshot().tape, { raid: 1, subscription: 0, prediction: 0, total: 1 });

  const quiet = createObservationFeed({});
  quiet.observe(observe("o2", "raid"));
  assert.doesNotMatch(quiet.lanSnapshot().note, /Tape:/);
  assert.equal(quiet.lanSnapshot().tape, null);
});
