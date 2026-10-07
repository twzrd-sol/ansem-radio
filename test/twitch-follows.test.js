import test from "node:test";
import assert from "node:assert/strict";
import { createTwitchFollowsAdapter, TWITCH_FOLLOWED_CHANNELS } from "../src/hub/twitch-follows.js";

const catalog = [
  { slug: "radiolanlive", login: "radiolanlive" },
  { slug: "caseoh", login: "CaseOh" },
];
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

test("imports only known followed logins from bounded Helix pages", async () => {
  const requests = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (!url.searchParams.has("after")) return json({
      data: [{ broadcaster_login: "caseoh" }, { broadcaster_login: "unknown_creator" }],
      pagination: { cursor: "next-page" },
    });
    return json({ data: [{ broadcaster_login: "RADIOLANLIVE" }], pagination: {} });
  };
  const list = createTwitchFollowsAdapter({ fetchImpl, clientId: "client-id" });
  const slugs = await list({ accessToken: "transient-access-token", userId: "12345", catalog });

  assert.deepEqual(slugs, ["caseoh", "radiolanlive"]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.origin + requests[0].url.pathname, TWITCH_FOLLOWED_CHANNELS);
  assert.equal(requests[0].url.searchParams.get("user_id"), "12345");
  assert.equal(requests[0].url.searchParams.get("first"), "100");
  assert.equal(requests[1].url.searchParams.get("after"), "next-page");
  for (const { init } of requests) {
    assert.equal(init.headers["Client-Id"], "client-id");
    assert.equal(init.headers.authorization, "Bearer transient-access-token");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test("refuses partial results at the page cap", async () => {
  let calls = 0;
  const list = createTwitchFollowsAdapter({
    clientId: "client-id",
    maxPages: 2,
    fetchImpl: async () => {
      calls += 1;
      return json({ data: [{ broadcaster_login: "caseoh" }], pagination: { cursor: `cursor-${calls}` } });
    },
  });
  await assert.rejects(list({ accessToken: "temporary", userId: "9", catalog }), { code: "twitch_follows_incomplete" });
  assert.equal(calls, 2);
});

test("deduplicates known slugs across complete pages", async () => {
  let calls = 0;
  const list = createTwitchFollowsAdapter({ clientId: "client-id", fetchImpl: async () => {
    calls += 1;
    return json({ data: [{ broadcaster_login: "caseoh" }], pagination: calls === 1 ? { cursor: "next" } : {} });
  } });
  assert.deepEqual(await list({ accessToken: "temporary", userId: "9", catalog }), ["caseoh"]);
  assert.equal(calls, 2);
});

test("uses one deadline across pagination and the response body", async () => {
  let clock = 0;
  let calls = 0;
  const list = createTwitchFollowsAdapter({
    clientId: "client-id",
    timeoutMs: 7,
    now: () => clock,
    fetchImpl: async () => {
      calls += 1;
      clock = calls === 1 ? 4 : 8;
      return json({ data: [{ broadcaster_login: "caseoh" }], pagination: { cursor: calls === 1 ? "next" : undefined } });
    },
  });
  await assert.rejects(list({ accessToken: "temporary-secret", userId: "12345", catalog }), (error) => {
    assert.equal(error.code, "twitch_follows_unavailable");
    assert.equal(error.message.includes("temporary-secret"), false);
    return true;
  });
  assert.equal(calls, 2);
});

test("rejects malicious cursors and stalled response bodies", async () => {
  let calls = 0;
  const badCursor = createTwitchFollowsAdapter({ clientId: "client-id", fetchImpl: async () => {
    calls += 1;
    return json({ data: [], pagination: { cursor: "../api?host=attacker" } });
  } });
  await assert.rejects(badCursor({ accessToken: "temporary", userId: "12345", catalog }), { code: "twitch_follows_unavailable" });
  assert.equal(calls, 1);

  let streamController = null;
  const destroyStream = () => {
    try { streamController?.error(new Error("stalled")); } catch { /* already closed */ }
    streamController = null;
  };
  const stream = new ReadableStream({
    start(controller) { streamController = controller; },
    cancel() { streamController = null; },
  });
  // AbortSignal.timeout() unrefs its timer, and a body that never emits holds no I/O
  // handle. A ref'd timer keeps the event loop alive until the adapter deadline fires
  // or this backup destroys the stream; either path must still refuse the import.
  const keepAlive = setTimeout(destroyStream, 50);
  const stalled = createTwitchFollowsAdapter({
    clientId: "client-id",
    timeoutMs: 20,
    fetchImpl: async (_url, init) => {
      init.signal.addEventListener("abort", destroyStream, { once: true });
      if (init.signal.aborted) destroyStream();
      return { ok: true, body: stream };
    },
  });
  try {
    await assert.rejects(stalled({ accessToken: "temporary", userId: "12345", catalog }), { code: "twitch_follows_unavailable" });
  } finally {
    clearTimeout(keepAlive);
    destroyStream();
    await stream.cancel().catch(() => {});
  }
});

test("rejects invalid inputs and catalog collisions before making a request", async () => {
  let calls = 0;
  const list = createTwitchFollowsAdapter({ clientId: "client-id", fetchImpl: async () => { calls += 1; return json({}); } });
  await assert.rejects(list({ accessToken: "token\r\nInjected: yes", userId: "12345", catalog }), { code: "twitch_follows_rejected" });
  await assert.rejects(list({ accessToken: "token", userId: "not-a-number", catalog }), { code: "twitch_follows_rejected" });
  await assert.rejects(list({ accessToken: "token", userId: "12345", catalog: [...catalog, { slug: "another", login: "caseoh" }] }), { code: "twitch_follows_rejected" });
  assert.equal(calls, 0);
});

test("uses a generic upstream error and bounds each response body", async () => {
  const failed = createTwitchFollowsAdapter({ clientId: "client-id", fetchImpl: async () => json({ error: "private detail" }, 401) });
  await assert.rejects(failed({ accessToken: "temporary-secret", userId: "12345", catalog }), (error) => {
    assert.equal(error.code, "twitch_follows_unavailable");
    assert.equal(error.status, 502);
    assert.equal(error.message.includes("temporary-secret"), false);
    return true;
  });

  const oversized = createTwitchFollowsAdapter({ clientId: "client-id", maxResponseBytes: 12, fetchImpl: async () => json({ data: [{ broadcaster_login: "caseoh" }], pagination: {} }) });
  await assert.rejects(oversized({ accessToken: "temporary", userId: "12345", catalog }), { code: "twitch_follows_unavailable" });
});
