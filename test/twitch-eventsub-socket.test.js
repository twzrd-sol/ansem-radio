import assert from "node:assert/strict";
import test from "node:test";

import { HELIX_EVENTSUB_URL, createEventSubSession } from "../src/providers/twitch-eventsub-socket.js";
import { TIMELINE_SUBSCRIPTIONS } from "../src/providers/twitch-eventsub.js";

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.listeners = new Map();
    this.closed = null;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type, value = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(value);
  }
  message(obj) {
    this.emit("message", { data: JSON.stringify(obj) });
  }
  send(data) {
    this.sent.push(data);
  }
  close(code, reason) {
    this.readyState = 3;
    this.closed = { code, reason };
    this.emit("close", { code, reason });
  }
}

function harness({ failTypes = [] } = {}) {
  FakeWebSocket.instances = [];
  let now = Date.parse("2026-10-01T20:00:00Z");
  const timers = [];
  const posts = [];
  const events = [];
  const gaps = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    posts.push({ url, body, auth: init.headers.Authorization });
    const ok = !failTypes.includes(body.type);
    return { ok, status: ok ? 202 : 403, json: async () => ({}) };
  };
  const session = createEventSubSession({
    accessToken: "oauth:tok",
    clientId: "cid",
    broadcasterId: "1001",
    participantKey: "k".repeat(32),
    onEvent: (e) => events.push(e),
    onGap: (g) => gaps.push(g),
    WebSocketImpl: FakeWebSocket,
    fetchImpl,
    clock: () => now,
    schedule: (fn, ms) => {
      const t = { fn, at: now + ms, done: false };
      timers.push(t);
      return t;
    },
    cancel: (t) => {
      if (t) t.done = true;
    },
  });
  const advance = (ms) => {
    now += ms;
    for (const t of timers) if (!t.done && t.at <= now) {
      t.done = true;
      t.fn();
    }
  };
  return { session, posts, events, gaps, advance, ws: () => FakeWebSocket.instances.at(-1), all: FakeWebSocket.instances, now: () => now };
}

const welcome = (id, keepalive = 10) => ({ metadata: { message_id: `w-${id}`, message_type: "session_welcome", message_timestamp: "2026-10-01T20:00:00Z" }, payload: { session: { id, status: "connected", keepalive_timeout_seconds: keepalive } } });
const follow = (id, at = "2026-10-01T20:00:01Z") => ({
  metadata: { message_id: id, message_type: "notification", message_timestamp: at, subscription_type: "channel.follow", subscription_version: "2" },
  payload: { subscription: { type: "channel.follow", condition: { broadcaster_user_id: "1001" } }, event: { user_id: "5", user_login: "fan", broadcaster_user_id: "1001" } },
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("on welcome it subscribes every type to this session with the bearer token, then counts", async () => {
  const h = harness({ failTypes: ["channel.goal.begin"] });
  h.session.start();
  h.ws().message(welcome("S1"));
  await flush();
  assert.equal(h.posts.length, TIMELINE_SUBSCRIPTIONS.length);
  assert.ok(h.posts.every((p) => p.url === HELIX_EVENTSUB_URL && p.auth === "Bearer tok" && p.body.transport.session_id === "S1" && p.body.transport.method === "websocket"));
  const state = h.session.state();
  assert.equal(state.connected, true);
  assert.equal(state.subscribed, TIMELINE_SUBSCRIPTIONS.length - 1);
  assert.deepEqual(state.failed, [{ type: "channel.goal.begin", status: 403 }]);
  assert.equal(h.ws().sent.length, 0); // never sends on the socket
});

test("notifications are normalized, deduplicated by message id, and stale ones skipped", async () => {
  const h = harness();
  h.session.start();
  h.ws().message(welcome("S1"));
  await flush();
  h.ws().message(follow("n1"));
  h.ws().message(follow("n1"));
  h.ws().message(follow("n2", "2026-10-01T19:40:00Z")); // 20 minutes old
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].event.signal, "follow");
  assert.match(h.events[0].event.participant_id, /^user-hmac:/);
  assert.equal(h.session.state().duplicates, 1);
  assert.equal(h.session.state().stale, 1);
});

test("a missed keepalive is a lost connection: a gap opens, it reconnects, resubscribes, and the gap closes", async () => {
  const h = harness();
  h.session.start();
  h.ws().message(welcome("S1", 10));
  await flush();
  h.advance(14_000);
  assert.equal(h.session.state().connected, true); // keepalive window plus slack not yet passed
  h.advance(2_000);
  assert.equal(h.session.state().connected, false);
  assert.equal(h.all[0].closed.reason, "keepalive_timeout");
  h.advance(1_000); // first backoff
  assert.equal(h.all.length, 2);
  h.ws().message(welcome("S2"));
  await flush();
  assert.equal(h.session.state().connected, true);
  assert.equal(h.posts.filter((p) => p.body.transport.session_id === "S2").length, TIMELINE_SUBSCRIPTIONS.length);
  assert.equal(h.gaps.length, 1);
  assert.equal(h.gaps[0].reason, "keepalive_timeout");
  assert.ok(Date.parse(h.gaps[0].end) > Date.parse(h.gaps[0].start));
});

test("keepalives keep the session alive", async () => {
  const h = harness();
  h.session.start();
  h.ws().message(welcome("S1", 10));
  await flush();
  for (let i = 0; i < 5; i += 1) {
    h.advance(9_000);
    h.ws().message({ metadata: { message_id: `k${i}`, message_type: "session_keepalive" }, payload: {} });
  }
  assert.equal(h.session.state().connected, true);
  assert.equal(h.gaps.length, 0);
});

test("session_reconnect hands over without resubscribing or opening a gap", async () => {
  const h = harness();
  h.session.start();
  h.ws().message(welcome("S1"));
  await flush();
  const first = h.ws();
  first.message({ metadata: { message_id: "r", message_type: "session_reconnect" }, payload: { session: { id: "S1", status: "reconnecting", reconnect_url: "wss://eventsub.wss.twitch.tv/ws?reconnect=abc" } } });
  const second = h.ws();
  assert.equal(second.url, "wss://eventsub.wss.twitch.tv/ws?reconnect=abc");
  assert.equal(first.closed, null); // old socket stays until the new welcome
  second.message(welcome("S1"));
  await flush();
  assert.equal(first.closed.reason, "reconnect_handover");
  assert.equal(h.posts.length, TIMELINE_SUBSCRIPTIONS.length); // no second round of subscriptions
  second.message(follow("n9"));
  assert.equal(h.events.length, 1);
  assert.equal(h.gaps.length, 0);
});

test("a dropped socket opens a gap and backs off; revocations are recorded; stop is quiet", async () => {
  const h = harness();
  h.session.start();
  h.ws().message(welcome("S1"));
  await flush();
  h.ws().message({ metadata: { message_id: "v", message_type: "revocation" }, payload: { subscription: { type: "channel.follow", status: "authorization_revoked" } } });
  assert.deepEqual(h.session.state().revoked, [{ type: "channel.follow", status: "authorization_revoked" }]);
  h.ws().close(1006, "network");
  assert.equal(h.session.state().gap_open, true);
  h.advance(1_000);
  assert.equal(h.all.length, 2);
  h.ws().close(1006, "again"); // second failure waits longer
  h.advance(1_000);
  assert.equal(h.all.length, 2);
  h.advance(1_000);
  assert.equal(h.all.length, 3);
  h.session.stop();
  h.advance(120_000);
  assert.equal(h.all.length, 3);
});

test("a rotated token is used for later subscriptions", async () => {
  const h = harness();
  h.session.start();
  h.session.setToken("oauth:newtok");
  h.ws().message(welcome("S1"));
  await flush();
  assert.ok(h.posts.every((p) => p.auth === "Bearer newtok"));
});
