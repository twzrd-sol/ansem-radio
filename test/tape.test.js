import assert from "node:assert/strict";
import test from "node:test";

import { quoteProvenance, tapeNotes } from "../src/markets/tape.js";
import { normalizeTwitchStream } from "../src/markets/twitch-metrics.js";

const AT = "2026-09-30T03:00:00.000Z";

test("a quote names this station, the fetch time, and Twitch, and nothing else", () => {
  const row = normalizeTwitchStream(
    { user_login: "kaicenat", user_name: "KaiCenat", type: "live", viewer_count: 10, game_name: "Just Chatting", started_at: "2026-09-30T02:00:00Z", title: "https://example.com" },
    "kaicenat",
    AT,
  );
  const line = quoteProvenance(row, { station: "radiolanlive" });
  assert.equal(line, `Data: Twitch. Recorded by radiolanlive at ${AT}.`);
  assert.equal(line.includes("http"), false);
  assert.throws(() => quoteProvenance(row, { station: "" }), /station/);
});

test("tape notes deduplicate notices and omit participant identity fields", () => {
  const raid = {
    id: "m1",
    signal: "raid",
    observed_at: "2026-10-02T18:00:00.000Z",
    participant_id: "user-hmac:secret",
    metadata: { viewers: 42, from_login: "otherchannel" },
  };
  const notes = tapeNotes([
    { event: raid },
    { event: raid },
    { event: { id: "m2", signal: "subscription", observed_at: "2026-10-02T18:01:00.000Z", participant_id: "user-hmac:other" } },
    { event: { id: "m3", signal: "chat", observed_at: "2026-10-02T18:02:00.000Z", participant_id: "user-hmac:chat" } },
    {
      event: {
        id: "m4",
        kind: "prediction_begin",
        observed_at: "2026-10-02T18:03:00.000Z",
        labels: { title: "next map" },
        outcomes: [{ label: "a", totals: { users: 10 } }, { label: "b", totals: { users: 4 } }],
      },
    },
  ]);
  assert.deepEqual(notes.map((note) => note.text), [
    "2026-10-02T18:00:00.000Z raid 42 viewers",
    "2026-10-02T18:01:00.000Z subscription",
    "2026-10-02T18:03:00.000Z prediction next map (2 outcomes)",
  ]);
  assert.equal(JSON.stringify(notes).includes("user-hmac"), false);
  assert.equal(JSON.stringify(notes).includes("otherchannel"), false);
});
