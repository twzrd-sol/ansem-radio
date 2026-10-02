import assert from "node:assert/strict";
import test from "node:test";

import { DEVICE_GRANT, TIMELINE_SCOPES, TWITCH_DEVICE_URL, connectTwitch, main, pollDeviceToken, publicActivationUri } from "../src/live/twitch-connect.js";

const ACCESS = "access-token-value-never-printed";
const REFRESH = "refresh-token-value-never-printed";

function fakeTwitch({ pending = 2, slowDown = 0, refuse = null, login = "radiolanlive", scopes = TIMELINE_SCOPES } = {}) {
  const calls = [];
  let tokenCalls = 0;
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    const form = Object.fromEntries(new URLSearchParams(init.body ?? ""));
    calls.push({ url, form, headers: init.headers });
    if (url === TWITCH_DEVICE_URL) {
      return reply(200, { device_code: "DEV", user_code: "ABCD-1234", verification_uri: "https://www.twitch.tv/activate?public=true&device-code=ABCD-1234", expires_in: 1800, interval: 5 });
    }
    if (url.endsWith("/oauth2/token")) {
      tokenCalls += 1;
      if (refuse) return reply(400, { status: 400, message: refuse });
      if (tokenCalls <= slowDown) return reply(400, { status: 400, message: "slow_down" });
      if (tokenCalls <= slowDown + pending) return reply(400, { status: 400, message: "authorization_pending" });
      return reply(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 14400, scope: scopes, token_type: "bearer" });
    }
    if (url.endsWith("/oauth2/validate")) {
      return reply(200, { client_id: "cid", login, scopes, user_id: "1", expires_in: 14400 });
    }
    return reply(404, {});
  };
  return { fetchImpl, calls };
}

const quiet = { sleep: async () => {}, clock: () => 1_000_000 };

test("the device flow requests exactly the timeline scopes and stores the approved pair", async () => {
  const { fetchImpl, calls } = fakeTwitch();
  const stored = [];
  const printed = [];
  const result = await connectTwitch({ clientId: "cid", login: "radiolanlive", store: async (t) => stored.push(t), fetchImpl, print: (l) => printed.push(l), ...quiet });
  assert.equal(result.login, "radiolanlive");
  assert.deepEqual(stored, [{ accessToken: ACCESS, refreshToken: REFRESH }]);
  const device = calls.find((c) => c.url === TWITCH_DEVICE_URL);
  assert.equal(device.form.client_id, "cid");
  assert.equal(device.form.scopes, TIMELINE_SCOPES.join(" "));
  assert.equal("client_secret" in device.form, false);
  const tokenCalls = calls.filter((c) => c.url.endsWith("/oauth2/token"));
  assert.equal(tokenCalls.length, 3); // two pending, then approved
  assert.equal(tokenCalls[0].form.grant_type, DEVICE_GRANT);
  assert.equal(tokenCalls[0].form.device_code, "DEV");
  assert.match(printed.join("\n"), /ABCD-1234/);
  assert.match(printed[0], /^Open https:\/\/www\.twitch\.tv\/activate\?(?=.*public=true)(?=.*device-code=ABCD-1234)/);
  assert.equal(printed.join("\n").includes(ACCESS) || printed.join("\n").includes(REFRESH), false);
});

test("the scope set keeps chat and adds only read scopes", () => {
  assert.ok(TIMELINE_SCOPES.includes("chat:read") && TIMELINE_SCOPES.includes("chat:edit"));
  assert.equal(TIMELINE_SCOPES.some((s) => s.includes(":manage:") || s === "user:read:chat"), false);
  assert.equal(new Set(TIMELINE_SCOPES).size, TIMELINE_SCOPES.length);
});

test("slow_down widens the polling interval", async () => {
  const { fetchImpl } = fakeTwitch({ slowDown: 1, pending: 0 });
  const waits = [];
  await pollDeviceToken({ clientId: "cid", deviceCode: "DEV", interval: 5, fetchImpl, sleep: async (ms) => waits.push(ms), clock: () => 0 });
  assert.deepEqual(waits, [5000, 10000]);
});

test("a refused or expired code stores nothing", async () => {
  const stored = [];
  const store = async (t) => stored.push(t);
  await assert.rejects(connectTwitch({ clientId: "cid", login: "radiolanlive", store, fetchImpl: fakeTwitch({ refuse: "access_denied" }).fetchImpl, print: () => {}, ...quiet }), /did not issue a token: access_denied/);
  let now = 0;
  await assert.rejects(
    pollDeviceToken({ clientId: "cid", deviceCode: "DEV", interval: 5, expiresIn: 10, fetchImpl: fakeTwitch({ pending: 99 }).fetchImpl, sleep: async (ms) => { now += ms; }, clock: () => now }),
    /expired before it was approved/,
  );
  assert.equal(stored.length, 0);
});

test("a token for another account, or missing a scope, is refused before storing", async () => {
  const stored = [];
  const store = async (t) => stored.push(t);
  await assert.rejects(
    connectTwitch({ clientId: "cid", login: "radiolanlive", store, fetchImpl: fakeTwitch({ login: "someoneelse" }).fetchImpl, print: () => {}, ...quiet }),
    /twitch_login_mismatch\. Nothing was stored/,
  );
  await assert.rejects(
    connectTwitch({ clientId: "cid", login: "radiolanlive", store, fetchImpl: fakeTwitch({ scopes: TIMELINE_SCOPES.filter((s) => s !== "bits:read") }).fetchImpl, print: () => {}, ...quiet }),
    /lacks bits:read\. Nothing was stored/,
  );
  assert.equal(stored.length, 0);
});

test("the activation link always carries public=true, once", () => {
  assert.equal(publicActivationUri("https://www.twitch.tv/activate?device-code=CMKGFSPC"), "https://www.twitch.tv/activate?device-code=CMKGFSPC&public=true");
  assert.equal(publicActivationUri("https://www.twitch.tv/activate?public=true&device-code=X"), "https://www.twitch.tv/activate?public=true&device-code=X");
});
