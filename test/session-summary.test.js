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
