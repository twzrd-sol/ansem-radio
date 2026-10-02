import assert from "node:assert/strict";
import test from "node:test";

import { createStationIrcSession } from "../src/live/irc-session.js";
import { DEFAULT_SEND_LIMIT, MAX_IRC_MESSAGE_CHARS, createTwitchIrcSocket } from "../src/providers/twitch-irc-socket.js";

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
    open() { this.readyState = 1; this.emit("open"); }
    server(data) { this.emit("message", { data }); }
    send(data) { assert.equal(this.readyState, 1); this.sent.push(data); }
    close(code, reason) { this.readyState = 3; this.emit("close", { code, reason }); }
  }
  return FakeWebSocket;
}

const ready =
  ":tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands\r\n" +
  ":tmi.twitch.tv 001 radiolanlive :Welcome, GLHF!\r\n";

function connected({ allowSend, sendLimit, clock } = {}) {
  const FakeWebSocket = fakeSockets();
  const client = createTwitchIrcSocket({
    login: "radiolanlive",
    oauthToken: "oauth:test-token",
    channels: ["radiolanlive"],
    onEvent: () => {},
    WebSocketImpl: FakeWebSocket,
    clock,
    allowSend,
    sendLimit,
  });
  client.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.server(ready);
  const privmsgs = () => socket.sent.filter((line) => line.startsWith("PRIVMSG"));
  return { client, socket, privmsgs };
}

test("sending is disabled by default and the socket stays receive-only", () => {
  const { client, privmsgs } = connected();
  assert.equal(client.allowSend, false);
  assert.deepEqual(client.say("hello"), { sent: false, reason: "send_disabled" });
  assert.deepEqual(privmsgs(), []);
  const session = createStationIrcSession({ login: "radiolanlive", oauthToken: "oauth:x", onEvent: () => {}, WebSocketImpl: fakeSockets() });
  assert.equal(session.allowSend, false);
  assert.deepEqual(session.say("hello"), { sent: false, reason: "send_disabled" });
});

test("say refuses before ready, refuses unjoined channels, then sends PRIVMSG to the joined room", () => {
  const FakeWebSocket = fakeSockets();
  const client = createTwitchIrcSocket({
    login: "radiolanlive", oauthToken: "oauth:t", channels: ["radiolanlive"], onEvent: () => {},
    WebSocketImpl: FakeWebSocket, allowSend: true,
  });
  client.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.deepEqual(client.say("early"), { sent: false, reason: "not_connected" });
  socket.server(ready);
  assert.deepEqual(client.say("elsewhere", "someoneelse"), { sent: false, reason: "not_joined" });
  assert.deepEqual(client.say("x", "not a login!"), { sent: false, reason: "channel_invalid" });
  assert.deepEqual(client.say("   "), { sent: false, reason: "empty" });
  assert.deepEqual(client.say("a".repeat(MAX_IRC_MESSAGE_CHARS + 1)), { sent: false, reason: "too_long" });
  assert.deepEqual(client.say("/ban someone"), { sent: false, reason: "command_like" });
  assert.deepEqual(client.say(".timeout someone 600"), { sent: false, reason: "command_like" });
  assert.deepEqual(client.say("  /me waves"), { sent: false, reason: "command_like" });
  assert.deepEqual(client.say("Ledger (AI agent): line one\r\nline two"), { sent: true, reason: null });
  assert.deepEqual(socket.sent.filter((line) => line.startsWith("PRIVMSG")), ["PRIVMSG #radiolanlive :Ledger (AI agent): line one line two\r\n"]);
  assert.equal(client.state().total_sent, 1);
});

test("say enforces the per-account bucket and frees capacity as the window slides", () => {
  let now = Date.parse("2026-09-30T12:00:00Z");
  const { client, privmsgs } = connected({ allowSend: true, clock: () => now });
  for (let index = 0; index < DEFAULT_SEND_LIMIT.messages; index += 1) {
    assert.equal(client.say(`take ${index}`).sent, true);
  }
  assert.deepEqual(client.say("one too many"), { sent: false, reason: "rate_limited" });
  assert.equal(privmsgs().length, DEFAULT_SEND_LIMIT.messages);
  now += DEFAULT_SEND_LIMIT.windowMs;
  assert.deepEqual(client.say("after the window"), { sent: true, reason: null });
  assert.equal(privmsgs().length, DEFAULT_SEND_LIMIT.messages + 1);
});

test("a custom, smaller bucket is honored", () => {
  let now = 0;
  const { client } = connected({ allowSend: true, clock: () => now, sendLimit: { messages: 2, windowMs: 10_000 } });
  assert.equal(client.say("a").sent, true);
  assert.equal(client.say("b").sent, true);
  assert.equal(client.say("c").reason, "rate_limited");
  now = 10_000;
  assert.equal(client.say("d").sent, true);
});
