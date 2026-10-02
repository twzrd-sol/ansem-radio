import assert from "node:assert/strict";
import test from "node:test";

import {
  officialChatSrc,
  officialPlayerSrc,
  STATION_CHANNEL,
  STATION_TITLE,
  STATION_URL,
} from "../src/live/station.js";

test("station is the locked Radio LAN channel", () => {
  assert.equal(STATION_CHANNEL, "radiolanlive");
  assert.equal(STATION_URL, "https://www.twitch.tv/radiolanlive");
  assert.equal(STATION_TITLE, "THE WZRD OF ZO presents RADIO LAN");
});

test("player URL is the official embed, not a clip or third-party host", () => {
  const src = officialPlayerSrc("localhost");
  assert.match(src, /^https:\/\/player\.twitch\.tv\/\?/);
  assert.match(src, /channel=radiolanlive/);
  assert.doesNotMatch(src, /clip=/);
  assert.doesNotMatch(src, /video=/);
  assert.match(src, /parent=localhost/);
  assert.match(src, /parent=127\.0\.0\.1/);
  assert.equal(officialPlayerSrc("https://Example.COM/path").includes("parent=example.com"), true);
});

test("chat embed is official and parent is required", () => {
  const src = officialChatSrc("localhost");
  assert.equal(src.startsWith("https://www.twitch.tv/embed/radiolanlive/chat?"), true);
  assert.throws(() => officialPlayerSrc(""), /parent host is required/);
  assert.throws(() => officialChatSrc("   "), /parent host is required/);
});
