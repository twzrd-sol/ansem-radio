import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";

import { assertParticipantKey, fromTwitchIrcLine, parseTwitchIrcLine } from "../src/providers/twitch-irc.js";

const KEY = "k".repeat(32);
const OTHER_KEY = "o".repeat(32);

const chat =
  "@badge-info=;badges=;display-name=Viewer123;id=abc;room-id=123456;tmi-sent-ts=123;user-id=789012;login=viewer123 :viewer123!viewer123@viewer123.tmi.twitch.tv PRIVMSG #monstercat :hello world this is chat";
const cheer =
  "@bits=250;display-name=Cheerer;id=cheer1;room-id=654321;user-id=111;login=cheerer;tmi-sent-ts=1000 :cheerer!cheerer@cheerer.tmi.twitch.tv PRIVMSG #lofi :cheer250 wow";

test("parses PRIVMSG chat without carrying login", () => {
  const raw = parseTwitchIrcLine(chat, undefined, { participantKey: KEY });
  assert.equal(raw.kind, "chat");
  assert.equal(raw.channel_id, "123456");
  assert.equal(raw.id, "abc");
  assert.match(raw.participant_id, /^user-hmac:[0-9a-f]{32}$/);
  assert.equal("login" in raw, false);
  assert.equal("display_name" in raw, false);
  assert.equal("text" in raw, false);
  const event = fromTwitchIrcLine(chat, undefined, { participantKey: KEY });
  assert.equal(event.signal, "chat");
  assert.equal(event.evidence.method, "irc_observation");
  assert.equal("twitch_login" in event.metadata, false);
  assert.notEqual(event.participant_id, "viewer123");
  const noId = chat.replace("id=abc;", "");
  assert.equal(
    parseTwitchIrcLine(noId, "2026-08-25T12:00:00Z").id,
    parseTwitchIrcLine(noId, "2026-08-25T12:00:00Z").id,
  );
});

test("parses cheer bits and hashes the cheerer", () => {
  const raw = parseTwitchIrcLine(cheer);
  assert.equal(raw.kind, "cheer");
  assert.equal(raw.bits, 250);
  const event = fromTwitchIrcLine(cheer);
  assert.equal(event.signal, "cheer");
  assert.equal("weight" in event.metadata, false);
});

test("parses USERNOTICE kinds, isolates anonymous events, and ignores noise", () => {
  const sub =
    "@login=subber;msg-id=sub;room-id=999;user-id=222;id=s1;tmi-sent-ts=2000 :subber!subber@subber.tmi.twitch.tv USERNOTICE #music :sub message";
  assert.equal(parseTwitchIrcLine(sub).kind, "sub");
  assert.equal(fromTwitchIrcLine(sub).signal, "subscription");
  const resub = "@msg-id=resub;room-id=1;user-id=3;id=s2 USERNOTICE #c";
  const gift = "@msg-id=submysterygift;room-id=1;id=g1 USERNOTICE #c";
  assert.equal(parseTwitchIrcLine(resub).kind, "resub");
  assert.equal(parseTwitchIrcLine(gift).kind, "subgift");
  assert.equal(parseTwitchIrcLine(gift).participant_id, null);
  const raid =
    "@msg-id=raid;login=raider;room-id=1;user-id=4;id=r1;tmi-sent-ts=3000 :raider!raider@raider.tmi.twitch.tv USERNOTICE #c :raiding";
  assert.equal(fromTwitchIrcLine(raid).signal, "raid");
  assert.equal(parseTwitchIrcLine("PING :tmi.twitch.tv"), null);
  assert.equal(parseTwitchIrcLine(":tmi.twitch.tv 001 justinfan123 :Welcome"), null);
  assert.equal(parseTwitchIrcLine("@msg-id=other;room-id=1 USERNOTICE #c"), null);
});

test("participant ids are keyed: none without a key, key-dependent, and not the old unsalted hash", () => {
  assert.equal(parseTwitchIrcLine(chat).participant_id, null, "no key means no id, never an unkeyed fallback");
  assert.equal(parseTwitchIrcLine(chat, undefined, { participantKey: null }).participant_id, null);
  const a = parseTwitchIrcLine(chat, undefined, { participantKey: KEY }).participant_id;
  const again = parseTwitchIrcLine(chat, undefined, { participantKey: KEY }).participant_id;
  const other = parseTwitchIrcLine(chat, undefined, { participantKey: OTHER_KEY }).participant_id;
  assert.equal(a, again, "deterministic for one key");
  assert.notEqual(a, other, "a different key gives a different id");
  const legacy = `user-hash:${createHash("sha256").update("789012").digest("hex").slice(0, 16)}`;
  assert.notEqual(a, legacy);
  for (const guess of ["789012", "viewer123"]) {
    const unkeyed = createHash("sha256").update(guess).digest("hex");
    assert.equal(a.includes(unkeyed.slice(0, 16)), false, "an enumerable id cannot be matched with a plain hash");
  }
  const sameUserOtherChannel = chat.replace("room-id=123456", "room-id=999").replace("#monstercat", "#elsewhere");
  assert.equal(parseTwitchIrcLine(sameUserOtherChannel, undefined, { participantKey: KEY }).participant_id, a, "stable per user across channels");
  const otherUser = chat.replace("user-id=789012", "user-id=789013");
  assert.notEqual(parseTwitchIrcLine(otherUser, undefined, { participantKey: KEY }).participant_id, a);
});

test("a participant key must be long enough; unset is allowed", () => {
  assert.equal(assertParticipantKey(undefined), null);
  assert.equal(assertParticipantKey(""), null);
  assert.equal(assertParticipantKey(KEY), KEY);
  assert.throws(() => assertParticipantKey("short"), /at least 32/);
  assert.throws(() => assertParticipantKey(12345), /at least 32/);
});
