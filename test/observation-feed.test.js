import assert from "node:assert/strict";
import test from "node:test";

import {
  createObservationFeed,
  toPublicIrcHealth,
  toPublicObservation,
} from "../src/live/observation-feed.js";

function observation(id, signal = "chat") {
  return {
    id: `twitch:${id}`,
    provider: "twitch",
    signal,
    observed_at: "2026-08-25T18:00:00Z",
    participant_id: "user-hash:private",
    evidence: { provider_event_id: id },
    metadata: { bits: 250, raw_text: "private" },
  };
}

test("public observations expose activity without identity or chat content", () => {
  const result = toPublicObservation(observation("one", "cheer"));
  assert.deepEqual(result, {
    id: "twitch:one",
    signal: "cheer",
    observed_at: "2026-08-25T18:00:00.000Z",
    label: "Cheer observed",
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("250"), false);
});

test("feed is bounded, de-duplicates events, and notifies consumers", () => {
  const feed = createObservationFeed({ maxObservations: 2 });
  const emitted = [];
  const unsubscribe = feed.subscribe((type, data) => {
    emitted.push([type, data.id ?? data.note ?? null]);
  });
  feed.observe(observation("one"));
  feed.observe(observation("two", "raid"));
  feed.observe(observation("one"));
  unsubscribe();
  feed.observe(observation("three", "subscription"));

  assert.deepEqual(feed.snapshot().observations.map(({ id }) => id), [
    "twitch:three",
    "twitch:one",
  ]);
  assert.deepEqual(
    emitted.filter(([type]) => type === "observation"),
    [
      ["observation", "twitch:one"],
      ["observation", "twitch:two"],
      ["observation", "twitch:one"],
    ],
  );
});

test("LAN note cites session duration and full-session counts without chat text", () => {
  let clock = Date.parse("2026-08-25T18:00:00Z");
  const feed = createObservationFeed({
    maxObservations: 1,
    now: () => clock,
    sessionStartedAt: "2026-08-25T18:00:00Z",
  });
  const lanEvents = [];
  feed.subscribe((type, data) => {
    if (type === "lan") lanEvents.push(data.note);
  });

  feed.observe(observation("one", "chat"));
  feed.observe(observation("two", "raid"));
  feed.observe(observation("one", "chat")); // duplicate id — no new lan
  clock = Date.parse("2026-08-25T18:45:00Z");
  feed.observe(observation("three", "cheer"));

  const snap = feed.snapshot();
  assert.equal(snap.observations.length, 1);
  assert.deepEqual(snap.lan.counts, {
    chat: 1,
    cheer: 1,
    subscription: 0,
    raid: 1,
    total: 3,
  });
  assert.equal(snap.lan.duration_seconds, 2700);
  assert.equal(
    snap.lan.note,
    "45-minute session. Observed 1 chat, 1 cheer, 1 raid.",
  );
  assert.equal(JSON.stringify(snap).includes("private"), false);
  assert.equal(lanEvents.length, 3);
  assert.equal(lanEvents.at(-1), snap.lan.note);
});

test("health removes socket internals", () => {
  const health = toPublicIrcHealth({
    enabled: true,
    irc_connected: true,
    total_events: 7,
    last_event_secs_ago: 4,
    last_error: null,
    cursor: { private: true },
    oauthToken: "secret",
  });
  assert.deepEqual(health, {
    enabled: true,
    connected: true,
    total_events: 7,
    last_event_secs_ago: 4,
    last_error: null,
  });
  assert.equal(JSON.stringify(health).includes("secret"), false);
});

test("a listener that throws does not stop the next listener or the feed", () => {
  const feed = createObservationFeed({ maxObservations: 5 });
  const seen = [];
  feed.subscribe(() => { throw new Error("bad consumer"); });
  feed.subscribe((type, data) => seen.push(data.id));
  assert.doesNotThrow(() => feed.observe(observation("one")));
  assert.ok(seen.includes("twitch:one"));
  assert.equal(feed.snapshot().observations[0].id, "twitch:one");
});
