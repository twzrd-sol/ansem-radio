import assert from "node:assert/strict";
import test from "node:test";

import { createAttentionEvent } from "../src/core/attention-event.js";
import { fromTwitchEngagement } from "../src/providers/twitch.js";

test("normalizes a Twitch chat observation without Twitch core fields", () => {
  const event = createAttentionEvent({
    id: "twitch:message:01",
    provider: "twitch",
    source_id: "channel:123",
    signal: "chat",
    observed_at: "2026-08-25T12:00:00Z",
    participant_id: "user-hash:abc",
    content_id: "stream:456",
    evidence: { method: "irc_observation" },
    metadata: { message_id: "01" },
  });

  assert.equal(event.version, 1);
  assert.equal(event.provider, "twitch");
  assert.equal(event.observed_at, "2026-08-25T12:00:00.000Z");
  assert.equal(event.evidence.method, "irc_observation");
});

test("the same contract accepts a client-observed Spotify checkpoint", () => {
  const event = createAttentionEvent({
    id: "listen:session-1:checkpoint-7",
    provider: "spotify",
    source_id: "device:device-key-hash",
    signal: "playback",
    observed_at: "2026-08-25T12:01:00Z",
    content_id: "track:fingerprint",
    evidence: { method: "signed_client_checkpoint", digest: "sha256:abc" },
    metadata: { position_bucket_s: 120 },
  });

  assert.equal(event.provider, "spotify");
  assert.equal(event.signal, "playback");
  assert.equal(event.evidence.method, "signed_client_checkpoint");
});

test("rejects unknown signals and invalid timestamps", () => {
  const base = {
    id: "event:1",
    provider: "future-provider",
    source_id: "source:1",
    signal: "playback",
    observed_at: "2026-08-25T12:00:00Z",
  };

  assert.throws(
    () => createAttentionEvent({ ...base, signal: "token_reward" }),
    /unsupported signal/,
  );
  assert.throws(
    () => createAttentionEvent({ ...base, observed_at: "not-a-date" }),
    /ISO timestamp/,
  );
});

test("maps Twitch engagement kinds without identity or score baggage", () => {
  const event = fromTwitchEngagement({
    id: 42,
    channel_id: "123",
    kind: "subgift",
    created_at: "2026-08-25T12:02:00Z",
    participant_id: "user-hash:def",
  });

  assert.equal(event.id, "twitch:42");
  assert.equal(event.signal, "subscription");
  assert.equal(event.source_id, "channel:123");
  assert.equal(event.metadata.twitch_kind, "subgift");
  assert.equal("twitch_login" in event.metadata, false);
  assert.equal("weight" in event.metadata, false);
});

test("rejects Twitch event kinds outside the observation contract", () => {
  assert.throws(
    () =>
      fromTwitchEngagement({
        id: 43,
        channel_id: "123",
        kind: "claim",
        created_at: "2026-08-25T12:02:00Z",
      }),
    /unsupported Twitch engagement kind/,
  );
});
