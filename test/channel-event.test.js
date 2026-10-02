import assert from "node:assert/strict";
import test from "node:test";

import { SIGNALS, createAttentionEvent } from "../src/core/attention-event.js";
import { CHANNEL_EVENT_KINDS, createChannelEvent } from "../src/core/channel-event.js";

const base = { id: "twitch:abc", provider: "twitch", source_id: "channel:1", observed_at: "2026-10-01T08:00:00Z" };

test("a prediction keeps totals and outcome labels, frozen, with no participant fields", () => {
  const event = createChannelEvent({
    ...base,
    kind: "prediction_end",
    content_id: "prediction:p1",
    totals: { points_total: 12000, outcomes: 2 },
    labels: { title: "Does the raid land?", status: "resolved" },
    outcomes: [
      { label: "Yes", totals: { points: 9000, users: 30 } },
      { label: "No", totals: { points: 3000, users: 12 } },
    ],
  });
  assert.equal(event.version, 1);
  assert.equal(event.outcomes[1].totals.users, 12);
  assert.equal(event.observed_at, "2026-10-01T08:00:00.000Z");
  assert.ok(Object.isFrozen(event) && Object.isFrozen(event.outcomes[0].totals));
  assert.equal("participant_id" in event, false);
});

test("identity-shaped keys are refused anywhere in a channel event", () => {
  const bad = [
    { kind: "prediction_progress", totals: { user_id: 5 } },
    { kind: "prediction_progress", labels: { top_predictor_login: "someone" } },
    { kind: "hype_train_progress", labels: { last_contribution_user: "x" } },
    { kind: "goal_progress", totals: { participant_count: 2 } },
    { kind: "poll_end", outcomes: [{ label: "A", totals: { chatter_total: 1 } }] },
    { kind: "poll_end", outcomes: [{ label: "A", totals: {}, user_login: "x" }] },
    { kind: "raid_out", totals: { viewers: 5 }, participant_id: "user-hmac:00" },
  ];
  for (const extra of bad) assert.throws(() => createChannelEvent({ ...base, ...extra }), TypeError, JSON.stringify(extra));
});

test("totals are finite and non-negative; labels are cleaned and capped; kinds are closed", () => {
  assert.throws(() => createChannelEvent({ ...base, kind: "viewer_sample", totals: { viewers: -1 } }), /finite number >= 0/);
  assert.throws(() => createChannelEvent({ ...base, kind: "viewer_sample", totals: { viewers: Number.NaN } }), /finite/);
  assert.throws(() => createChannelEvent({ ...base, kind: "viewer_sample", totals: { Viewers: 1 } }), /snake_case/);
  assert.throws(() => createChannelEvent({ ...base, kind: "chat_message" }), /unsupported channel event kind/);
  assert.throws(() => createChannelEvent({ ...base, kind: "channel_update", labels: { title: 5 } }), /must be a string/);
  const cleaned = createChannelEvent({ ...base, kind: "channel_update", labels: { title: `a​\nb   c`, category_name: "Just Chatting" } });
  assert.equal(cleaned.labels.title, "a b c");
  assert.equal(cleaned.labels.category_name, "Just Chatting");
  assert.equal(createChannelEvent({ ...base, kind: "channel_update", labels: { title: "x".repeat(300) } }).labels.title.length, 140);
  assert.throws(() => createChannelEvent({ ...base, kind: "poll_end", outcomes: Array(11).fill({ label: "a", totals: {} }) }), /at most 10/);
  assert.equal(CHANNEL_EVENT_KINDS.includes("stream_online"), true);
});

test("attention events gain follow and redemption, keyed participants only", () => {
  assert.deepEqual(SIGNALS.slice(-2), ["follow", "redemption"]);
  const follow = createAttentionEvent({ ...base, signal: "follow", participant_id: "user-hmac:0123" });
  assert.equal(follow.signal, "follow");
  assert.equal(follow.version, 1);
});
