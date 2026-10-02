#!/usr/bin/env node
/**
 * Connect the station's Twitch account with the Device Code Grant. The Radio LAN
 * app is a public client: no client secret exists or is needed. The operator
 * opens Twitch's activation page and approves; this process polls for the token
 * pair, checks it belongs to the station login with every requested scope, and
 * stores it through the secrets manager (refresh token first). Only the activation URL and
 * code are printed; token values never are.
 *
 *   npm run twitch:connect
 *
 * Requests only the scopes the timeline uses.
 */

import { pathToFileURL } from "node:url";

import { TWITCH_IRC_REQUIRED_SCOPES, TWITCH_TOKEN_URL, validateTwitchUserToken } from "./twitch-token-manager.js";

export const TWITCH_DEVICE_URL = "https://id.twitch.tv/oauth2/device";
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** chat:read and chat:edit keep the IRC session and the agents' posting; the rest are read-only EventSub scopes. */
export const TIMELINE_SCOPES = Object.freeze([
  ...TWITCH_IRC_REQUIRED_SCOPES,
  "moderator:read:followers",
  "channel:read:subscriptions",
  "bits:read",
  "channel:read:predictions",
  "channel:read:polls",
  "channel:read:redemptions",
  "channel:read:hype_train",
  "channel:read:goals",
  "channel:read:ads",
  "moderator:read:shoutouts",
]);

export class ConnectError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConnectError";
    this.code = code;
  }
}

async function post(fetchImpl, url, form) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new ConnectError("twitch_unreachable", "Twitch's token service could not be reached");
  }
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { ok: response.ok, status: response.status, body };
}

/**
 * Twitch documents the public-client activation page as
 * https://www.twitch.tv/activate?public=true&device-code=... but returned the link without
 * public=true on 2026-10-01. Approving on the link as returned left the device code pending
 * (Twitch kept answering authorization_pending); the same code with public=true worked.
 * The Radio LAN app is a public client, so always add it.
 */
export function publicActivationUri(uri) {
  const url = new URL(uri);
  url.searchParams.set("public", "true");
  return url.toString();
}

/** Step 1: ask Twitch for a device code and the activation page. */
export async function startDeviceAuthorization({ clientId, scopes = TIMELINE_SCOPES, fetchImpl = globalThis.fetch }) {
  if (!clientId) throw new ConnectError("client_id_missing", "TWITCH_CLIENT_ID is not set");
  const { ok, body } = await post(fetchImpl, TWITCH_DEVICE_URL, { client_id: clientId, scopes: scopes.join(" ") });
  if (!ok || !body.device_code || !body.user_code || !body.verification_uri) {
    throw new ConnectError("device_start_failed", `Twitch refused the device request: ${body.message ?? "no device code"}`);
  }
  return Object.freeze({
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: publicActivationUri(body.verification_uri),
    expiresIn: Number(body.expires_in) || 1800,
    interval: Number(body.interval) || 5,
  });
}

/** Step 2: poll until the operator approves, the code expires, or Twitch refuses. */
export async function pollDeviceToken({
  clientId,
  scopes = TIMELINE_SCOPES,
  deviceCode,
  interval = 5,
  expiresIn = 1800,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = Date.now,
}) {
  const deadline = clock() + expiresIn * 1000;
  let waitSeconds = interval;
  while (clock() < deadline) {
    await sleep(waitSeconds * 1000);
    const { ok, body } = await post(fetchImpl, TWITCH_TOKEN_URL, {
      client_id: clientId,
      scopes: scopes.join(" "),
      device_code: deviceCode,
      grant_type: DEVICE_GRANT,
    });
    if (ok && body.access_token && body.refresh_token) {
      return { accessToken: body.access_token, refreshToken: body.refresh_token };
    }
    const message = String(body.message ?? "").toLowerCase();
    if (message.includes("authorization_pending")) continue;
    if (message.includes("slow_down")) {
      waitSeconds += 5;
      continue;
    }
    throw new ConnectError("device_token_refused", `Twitch did not issue a token: ${body.message ?? "unknown reason"}`);
  }
  throw new ConnectError("device_code_expired", "The activation code expired before it was approved");
}

/**
 * The whole connect: start, print the activation step, poll, validate, store.
 * Returns the login, granted scopes and expiry; never the tokens.
 */
export async function connectTwitch({
  clientId,
  login,
  scopes = TIMELINE_SCOPES,
  store,
  fetchImpl = globalThis.fetch,
  sleep,
  clock = Date.now,
  print = (line) => console.log(line),
}) {
  if (typeof store !== "function") throw new ConnectError("store_missing", "no token store (no secrets manager configured)");
  const device = await startDeviceAuthorization({ clientId, scopes, fetchImpl });
  print(`Open ${device.verificationUri}`);
  print(`and confirm the code ${device.userCode} while signed in to Twitch as ${login}.`);
  print(`Waiting for approval (the code expires in ${Math.round(device.expiresIn / 60)} minutes)...`);

  const tokens = await pollDeviceToken({ clientId, scopes, deviceCode: device.deviceCode, interval: device.interval, expiresIn: device.expiresIn, fetchImpl, sleep, clock });
  let validation;
  try {
    validation = await validateTwitchUserToken({ accessToken: tokens.accessToken, login, fetchImpl, clock });
  } catch (error) {
    throw new ConnectError(error.code ?? "twitch_validate_failed", `The approved token was refused: ${error.code ?? error.message}. Nothing was stored.`);
  }
  const missing = scopes.filter((scope) => !validation.scopes.includes(scope));
  if (missing.length > 0) {
    throw new ConnectError("twitch_scope_missing", `The approved token lacks ${missing.join(", ")}. Nothing was stored.`);
  }
  await store({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  return Object.freeze({ login: validation.login, scopes: validation.scopes, expires_at: validation.expires_at });
}

export async function main(env = process.env, { print = (line) => console.log(line), ...options } = {}) {
  try {
    const result = await connectTwitch({
      clientId: env.TWITCH_CLIENT_ID,
      login: env.TWITCH_IRC_LOGIN ?? "radiolanlive",
      store: options.store ?? null,
      print,
      ...options,
    });
    print(`Connected ${result.login}: ${result.scopes.length} scopes stored in the secrets manager.`);
    return 0;
  } catch (error) {
    print(`Not connected: ${error.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
