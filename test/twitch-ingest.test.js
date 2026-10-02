import assert from "node:assert/strict";
import test from "node:test";

import { fromTwitchEngagement } from "../src/providers/twitch.js";
import {
  createIngestCursor,
  ircPongFor,
  nextIrcBackoffSeconds,
  reconcileIrcJoins,
  replayFromCursor,
  snapshotTwitchIngestHealth,
} from "../src/providers/twitch-ingest.js";

const ev = (id, kind, sec, extra = {}) =>
  fromTwitchEngagement({ id, channel_id: "123", kind, created_at: `2026-08-25T12:00:${sec}Z`, ...extra });

test("IRC backoff doubles and caps at 30s", () => {
  assert.equal(nextIrcBackoffSeconds(1), 2);
  assert.equal(nextIrcBackoffSeconds(16), 30);
  assert.equal(nextIrcBackoffSeconds(0), 1);
});

test("PING is answered locally; other lines are ignored", () => {
  assert.equal(ircPongFor("PING :tmi.twitch.tv"), "PONG :tmi.twitch.tv\r\n");
  assert.equal(ircPongFor("PRIVMSG #c :hi"), null);
});

test("join reconcile follows the curated set, not prior joins", () => {
  assert.deepEqual(reconcileIrcJoins(["#Old", "keep"], ["Keep", "new"]), {
    join: ["new"],
    part: ["old"],
    next_joined: ["keep", "new"],
  });
});

test("health snapshot drops claim fields and reports age", () => {
  const snap = snapshotTwitchIngestHealth({
    enabled: true,
    curated_logins: ["monstercat"],
    irc_connected: true,
    total_events: 4,
    last_event_at: "2026-08-25T12:00:00Z",
    last_join_reconcile_at: "2026-08-25T11:59:40Z",
    claim_enabled: true,
    claims_today: 9,
  }, Date.parse("2026-08-25T12:00:10Z"));
  assert.equal(snap.curated_channels, 1);
  assert.equal(snap.last_event_secs_ago, 10);
  assert.equal("claim_enabled" in snap, false);
  assert.equal("claims_today" in snap, false);
});

test("replay is exclusive of the cursor and numeric across same-timestamp ids", () => {
  const events = [ev(11, "chat", "00"), ev(9, "cheer", "00", { bits: 250 }), ev(12, "raid", "01")];
  const first = replayFromCursor(events, null);
  assert.deepEqual(first.events.map((e) => e.id), ["twitch:9", "twitch:11", "twitch:12"]);
  assert.equal(replayFromCursor(events, first.cursor).events.length, 0);
  const mid = replayFromCursor(events, createIngestCursor(first.events[0]));
  assert.deepEqual(mid.events.map((e) => e.id), ["twitch:11", "twitch:12"]);
});
