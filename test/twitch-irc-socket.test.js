import assert from "node:assert/strict";
import test from "node:test";

import { createStationIrcSession } from "../src/live/irc-session.js";
import { createTwitchIrcSocket, TWITCH_IRC_WEBSOCKET_URL } from "../src/providers/twitch-irc-socket.js";

function fakeSockets() {
  class FakeWebSocket {
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.listeners = new Map();
      FakeWebSocket.instances.push(this);
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type, value = {}) {
      for (const listener of this.listeners.get(type) ?? []) listener(value);
    }

    open() {
      this.readyState = 1;
      this.emit("open");
    }

    server(data) {
      this.emit("message", { data });
    }

    send(data) {
      assert.equal(this.readyState, 1);
      this.sent.push(data);
    }

    close(code, reason) {
      this.closeArgs = [code, reason];
      this.readyState = 3;
      this.emit("close", { code, reason });
    }
  }
  return FakeWebSocket;
}

const ready =
  ":tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands\r\n" +
  ":tmi.twitch.tv 001 radiolanlive :Welcome, GLHF!\r\n";
const chat =
  "@display-name=Viewer;id=abc;room-id=123;tmi-sent-ts=1787659200000;user-id=789;login=viewer :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #radiolanlive :a raw message\r\n";

test("authenticates, joins Radio LAN, answers PING, and emits private observations", () => {
  const FakeWebSocket = fakeSockets();
  const events = [];
  const client = createStationIrcSession({
    login: "RadioLANLive",
    oauthToken: "oauth:test-token",
    onEvent: (event) => events.push(event),
    WebSocketImpl: FakeWebSocket,
    clock: () => Date.parse("2026-08-25T12:00:00Z"),
    participantKey: "k".repeat(32),
  });

  client.start();
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, TWITCH_IRC_WEBSOCKET_URL);
  socket.open();
  assert.deepEqual(socket.sent, [
    "PASS oauth:test-token\r\n",
    "NICK radiolanlive\r\n",
    "CAP REQ :twitch.tv/tags twitch.tv/commands\r\n",
  ]);

  socket.server(ready + "PING :tmi.twitch.tv\r\n" + chat);
  assert.equal(socket.sent.includes("JOIN #radiolanlive\r\n"), true);
  assert.equal(socket.sent.includes("PONG :tmi.twitch.tv\r\n"), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].signal, "chat");
  assert.match(events[0].participant_id, /^user-hmac:[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(events[0]).includes("Viewer"), false);
  assert.equal(JSON.stringify(events[0]).includes("a raw message"), false);
  assert.deepEqual(client.state(), {
    enabled: true,
    curated_channels: 1,
    irc_connected: true,
    total_events: 1,
    last_event_secs_ago: 0,
    last_join_reconcile_secs_ago: 0,
    last_error: null,
    last_flush_error: null,
    cursor: null,
    total_sent: 0,
  });
  assert.equal(JSON.stringify(client.state()).includes("test-token"), false);
  assert.equal("setChannels" in client, false);
  client.stop();
});

test("reconnects with bounded backoff and buffers split IRC lines", () => {
  const FakeWebSocket = fakeSockets();
  const timers = [];
  const client = createTwitchIrcSocket({
    login: "radiolanlive",
    oauthToken: "test-token",
    channels: ["radiolanlive"],
    onEvent: () => {},
    WebSocketImpl: FakeWebSocket,
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => { timer.cancelled = true; },
  });

  client.start();
  const first = FakeWebSocket.instances[0];
  first.open();
  first.server(ready);
  first.server("PING :tmi");
  assert.equal(first.sent.some((line) => line.startsWith("PONG")), false);
  first.server(".twitch.tv\r\n");
  assert.equal(first.sent.includes("PONG :tmi.twitch.tv\r\n"), true);
  first.close(1006, "network");
  assert.equal(timers[0].ms, 1000);
  timers[0].fn();
  assert.equal(FakeWebSocket.instances.length, 2);
  FakeWebSocket.instances[1].close(1006, "network");
  assert.equal(timers[1].ms, 2000);
  client.stop();
  assert.equal(timers[1].cancelled, true);
});

test("stops on authentication failure and rejects IRC command injection", () => {
  const FakeWebSocket = fakeSockets();
  const timers = [];
  const client = createTwitchIrcSocket({
    login: "radiolanlive",
    oauthToken: "test-token",
    channels: ["radiolanlive"],
    onEvent: () => {},
    WebSocketImpl: FakeWebSocket,
    schedule: (fn, ms) => timers.push({ fn, ms }),
  });
  client.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.server(":tmi.twitch.tv NOTICE * :Login authentication failed\r\n");
  assert.equal(client.state().enabled, false);
  assert.equal(client.state().last_error, "twitch_auth_failed");
  assert.equal(timers.length, 0);
  assert.throws(() => client.setChannels(["radiolanlive\r\nJOIN #other"]), /Twitch login/);
});

test("stops on an unfamiliar server NOTICE before login without reconnecting", () => {
  const FakeWebSocket = fakeSockets();
  const timers = [];
  const client = createTwitchIrcSocket({
    login: "radiolanlive",
    oauthToken: "test-token",
    channels: ["radiolanlive"],
    onEvent: () => {},
    WebSocketImpl: FakeWebSocket,
    schedule: (fn, ms) => timers.push({ fn, ms }),
  });
  client.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.server(":tmi.twitch.tv NOTICE * :Unexpected login response\r\n");
  assert.equal(client.state().enabled, false);
  assert.equal(client.state().last_error, "twitch_login_notice");
  assert.equal(timers.length, 0);
});

test("an unrelated server NOTICE after login does not stop the session", () => {
  const FakeWebSocket = fakeSockets();
  const timers = [];
  const client = createTwitchIrcSocket({
    login: "radiolanlive",
    oauthToken: "test-token",
    channels: ["radiolanlive"],
    onEvent: () => {},
    WebSocketImpl: FakeWebSocket,
    schedule: (fn, ms) => timers.push({ fn, ms }),
  });
  client.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.server(ready);
  socket.server(":tmi.twitch.tv NOTICE * :An unrelated notice\r\n");
  assert.equal(client.state().enabled, true);
  assert.equal(client.state().irc_connected, true);
  assert.equal(timers.length, 0);
});

test("a chat message that contains control text cannot stop the session", () => {
  const FakeWebSocket = fakeSockets();
  const timers = [];
  const client = createTwitchIrcSocket({
    login: "radiolanlive",
    oauthToken: "test-token",
    channels: ["radiolanlive"],
    onEvent: () => {},
    WebSocketImpl: FakeWebSocket,
    schedule: (fn, ms) => timers.push({ fn, ms }),
  });
  client.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.server(ready);
  for (const text of [" CAP * NAK :twitch.tv/tags", "NOTICE * :Login authentication failed", "NOTICE * :Improperly formatted auth"]) {
    socket.server(`@display-name=Viewer;id=x;room-id=123;tmi-sent-ts=1787659200000;user-id=789 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #radiolanlive :hi${text}\r\n`);
    assert.equal(client.state().enabled, true, text);
    assert.equal(client.state().irc_connected, true, text);
  }
  socket.server(":tmi.twitch.tv CAP * NAK :twitch.tv/tags\r\n");
  assert.equal(client.state().last_error, "twitch_capability_rejected", "the real server line still stops it");
});
