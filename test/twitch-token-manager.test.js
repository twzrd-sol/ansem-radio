import assert from "node:assert/strict";
import test from "node:test";

import {
  createTwitchTokenManager,
  refreshTwitchUserToken,
  validateTwitchUserToken,
} from "../src/live/twitch-token-manager.js";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

const valid = (expiresIn = 14_400, extra = {}) => response({
  login: "radiolanlive",
  scopes: ["chat:read", "chat:edit"],
  expires_in: expiresIn,
  ...extra,
});

test("validates the account, IRC scopes, and expiry without returning the token", async () => {
  let authorization;
  const result = await validateTwitchUserToken({
    accessToken: "oauth:private-token",
    login: "RadioLANLive",
    clock: () => Date.parse("2026-08-25T20:00:00Z"),
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return valid(3_600);
    },
  });

  assert.equal(authorization, "OAuth private-token");
  assert.deepEqual(result, {
    login: "radiolanlive",
    scopes: ["chat:read", "chat:edit"],
    expires_in: 3_600,
    expires_at: "2026-08-25T21:00:00.000Z",
  });
  assert.equal(JSON.stringify(result).includes("private-token"), false);
});

test("rejects the wrong account or missing IRC scope with safe error codes", async () => {
  await assert.rejects(
    validateTwitchUserToken({
      accessToken: "private-token",
      login: "radiolanlive",
      fetchImpl: async () => valid(3_600, { login: "otheraccount" }),
    }),
    { code: "twitch_login_mismatch" },
  );
  await assert.rejects(
    validateTwitchUserToken({
      accessToken: "private-token",
      login: "radiolanlive",
      fetchImpl: async () => valid(3_600, { scopes: ["chat:read"] }),
    }),
    { code: "twitch_scope_missing" },
  );
});

test("treats Twitch service failures as retryable rather than invalid credentials", async () => {
  await assert.rejects(
    validateTwitchUserToken({
      accessToken: "private-token",
      login: "radiolanlive",
      fetchImpl: async () => response({}, 503),
    }),
    { code: "twitch_validate_unavailable" },
  );
  await assert.rejects(
    refreshTwitchUserToken({
      clientId: "client123",
      refreshToken: "private-refresh",
      fetchImpl: async () => response({}, 429),
    }),
    { code: "twitch_refresh_unavailable" },
  );
});

test("refreshes with form data and accepts Twitch refresh-token rotation", async () => {
  let request;
  const result = await refreshTwitchUserToken({
    clientId: "client123",
    refreshToken: "old-refresh",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ access_token: "new-access", refresh_token: "new-refresh" });
    },
  });

  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body.get("grant_type"), "refresh_token");
  assert.equal(request.options.body.get("refresh_token"), "old-refresh");
  assert.deepEqual(result, {
    accessToken: "new-access",
    refreshToken: "new-refresh",
  });
});

test("manager refreshes an expiring token, persists it, reconnects, and schedules ahead", async () => {
  const replies = [
    valid(60),
    response({ access_token: "new-access", refresh_token: "new-refresh" }),
    valid(14_400),
  ];
  const timers = [];
  const activated = [];
  const persisted = [];
  const manager = createTwitchTokenManager({
    clientId: "client123",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    login: "radiolanlive",
    fetchImpl: async () => replies.shift(),
    clock: () => Date.parse("2026-08-25T20:00:00Z"),
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => { timer.cancelled = true; },
    onToken: async (token) => activated.push(token),
    onTokens: async (tokens) => persisted.push(tokens),
  });

  await manager.start();
  assert.deepEqual(activated, ["new-access"]);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].refreshToken, "new-refresh");
  assert.equal(timers[0].ms, 3_600_000);
  assert.equal(manager.state().validated, true);
  assert.equal(manager.state().maintenance_scheduled, true);
  assert.equal(JSON.stringify(manager.state()).includes("new-access"), false);
  manager.stop();
  assert.equal(timers[0].cancelled, true);
});

test("manager reports a transient refresh failure and schedules a retry", async () => {
  const timers = [];
  const manager = createTwitchTokenManager({
    clientId: "client123",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    login: "radiolanlive",
    fetchImpl: async (url) => {
      if (url.endsWith("/validate")) return valid(60);
      throw new Error("network includes no credential");
    },
    schedule: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    onToken: async () => {},
  });

  await manager.start();
  assert.equal(manager.state().last_error, "twitch_refresh_unavailable");
  assert.equal(timers[0].ms, 30_000);
  assert.equal(JSON.stringify(manager.state()).includes("old-access"), false);
});

test("manager revalidates hourly without reconnecting a healthy IRC session", async () => {
  const replies = [valid(14_400), valid(10_800)];
  const timers = [];
  const activated = [];
  const manager = createTwitchTokenManager({
    clientId: "client123",
    accessToken: "current-access",
    refreshToken: "current-refresh",
    login: "radiolanlive",
    fetchImpl: async () => replies.shift(),
    schedule: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    onToken: async (token) => activated.push(token),
  });

  await manager.start();
  assert.equal(timers[0].ms, 3_600_000);
  timers[0].fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(activated, ["current-access"]);
  assert.equal(timers[1].ms, 3_600_000);
  manager.stop();
});

test("manager retries Doppler persistence without rotating or reconnecting again", async () => {
  const replies = [
    valid(60),
    response({ access_token: "new-access", refresh_token: "new-refresh" }),
    valid(14_400),
    valid(14_300),
  ];
  const timers = [];
  const activated = [];
  let persistenceAttempts = 0;
  const manager = createTwitchTokenManager({
    clientId: "client123",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    login: "radiolanlive",
    fetchImpl: async () => replies.shift(),
    schedule: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    onToken: async (token) => activated.push(token),
    onTokens: async () => {
      persistenceAttempts += 1;
      if (persistenceAttempts === 1) throw new Error("temporary Doppler failure");
    },
  });

  await manager.start();
  assert.equal(manager.state().last_error, "twitch_token_store_failed");
  assert.equal(manager.state().persistence_pending, true);
  assert.equal(timers[0].ms, 30_000);
  timers[0].fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(persistenceAttempts, 2);
  assert.equal(manager.state().persistence_pending, false);
  assert.deepEqual(activated, ["new-access"]);
  manager.stop();
});

test("shutdown during refresh still saves the newly rotated recovery token", async () => {
  let call = 0;
  let releaseRefresh;
  let markRefreshStarted;
  const refreshStarted = new Promise((resolve) => { markRefreshStarted = resolve; });
  const persisted = [];
  const activated = [];
  const manager = createTwitchTokenManager({
    clientId: "client123",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    login: "radiolanlive",
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return valid(60);
      markRefreshStarted();
      return new Promise((resolve) => { releaseRefresh = resolve; });
    },
    onToken: async (token) => activated.push(token),
    onTokens: async (tokens) => persisted.push(tokens),
  });

  const starting = manager.start();
  await refreshStarted;
  manager.stop();
  releaseRefresh(response({ access_token: "new-access", refresh_token: "new-refresh" }));
  await starting;

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].refreshToken, "new-refresh");
  assert.deepEqual(activated, []);
});
