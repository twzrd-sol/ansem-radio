import assert from "node:assert/strict";
import test from "node:test";

import {
  createStationIrcSession,
  TWITCH_IRC_URL,
} from "../src/live/irc-session.js";

test("station IRC uses Twitch TLS and requires an injected OAuth token", () => {
  assert.equal(TWITCH_IRC_URL, "wss://irc-ws.chat.twitch.tv:443");
  assert.throws(
    () => createStationIrcSession({ onEvent: () => {}, WebSocketImpl: class {} }),
    /oauthToken/,
  );
});
