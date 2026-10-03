import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { encodeBase58 } from "../src/core/base58.js";
import { createHubApi } from "../src/hub/api.js";
import { createHubIdentityStore } from "../src/hub/identity-store.js";
import { createTwitchVerifier, TWITCH_ISSUER, TWITCH_KEYS, twitchConfig } from "../src/hub/twitch-identity.js";
import { createHubStore } from "../src/hub/store.js";

const ORIGIN = "https://hub.example";
const NOW = 1_791_025_000;
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "twitch-test", use: "sig", alg: "RS256" };
const claims = (patch = {}) => ({ iss: TWITCH_ISSUER, aud: "public-client", azp: "public-client", sub: "123456", preferred_username: "LAN fan", iat: NOW - 10, exp: NOW + 600, nonce: "nonce", ...patch });
const token = (payload = claims(), header = { alg: "RS256", kid: jwk.kid }) => {
  const text = [header, payload].map((v) => Buffer.from(JSON.stringify(v)).toString("base64url")).join(".");
  return `${text}.${sign("RSA-SHA256", Buffer.from(text), rsa.privateKey).toString("base64url")}`;
};
const keysFetch = async (url, options) => {
  assert.equal(url, TWITCH_KEYS);
  assert.equal(options.redirect, "error");
  return new Response(JSON.stringify({ keys: [jwk] }));
};

describe("Twitch signed identity", () => {
  it("uses a registered public client and an exact hub callback on an allowed origin", () => {
    assert.equal(twitchConfig({}), null);
    assert.throws(() => twitchConfig({ RADIOLAN_HUB_TWITCH_CLIENT_ID: "public-client" }), /redirect/);
    const configured = twitchConfig({ RADIOLAN_HUB_TWITCH_CLIENT_ID: "public-client", RADIOLAN_HUB_TWITCH_REDIRECT_URI: `${ORIGIN}/hub/twitch` });
    assert.deepEqual(configured, { clientId: "public-client", redirectUri: `${ORIGIN}/hub/twitch` });
  });
  it("verifies the signature and returns only identity fields", async () => {
    const verify = createTwitchVerifier({ clientId: "public-client", fetchImpl: keysFetch, now: () => NOW });
    assert.deepEqual(await verify(token(), "nonce"), { subject: "123456", displayName: "LAN fan" });
  });
  it("rejects altered, expired, wrong audience, wrong issuer, future and nonce-mismatched tokens", async () => {
    const verify = createTwitchVerifier({ clientId: "public-client", fetchImpl: keysFetch, now: () => NOW });
    for (const patch of [{ exp: NOW }, { aud: "someone-else" }, { iss: "https://fake.example" }, { iat: NOW + 60 }, { nonce: "replayed" }, { azp: "else" }, { sub: {} }, { aud: ["public-client", "other"], azp: undefined }]) {
      await assert.rejects(verify(token(claims(patch)), "nonce"), { code: "twitch_identity_rejected" });
    }
    const valid = token().split(".");
    valid[1] = Buffer.from(JSON.stringify(claims({ sub: "654321" }))).toString("base64url");
    await assert.rejects(verify(valid.join("."), "nonce"), { code: "twitch_identity_rejected" });
    for (const bad of ["x", "a".repeat(9000), token(claims(), { alg: "none", kid: jwk.kid }), token(claims(), { alg: "HS256", kid: jwk.kid })]) await assert.rejects(verify(bad, "nonce"));
  });
  it("shares a bounded key cache, refreshes rotation, and fails closed on key-service failure", async () => {
    let calls = 0; let clock = NOW; let fail = false;
    const verify = createTwitchVerifier({ clientId: "public-client", now: () => clock, fetchImpl: async (...args) => { calls++; if (fail) throw new Error("network"); return keysFetch(...args); } });
    await Promise.all(Array.from({ length: 20 }, () => verify(token(), "nonce")));
    assert.equal(calls, 1);
    clock += 61;
    await assert.rejects(verify(token(claims({ exp: clock + 600 })), "wrong"));
    await assert.rejects(verify(token(claims({ exp: clock + 600 }), { alg: "RS256", kid: "unknown" }), "nonce"));
    assert.equal(calls, 2);
    await assert.rejects(verify(token(claims({ exp: clock + 600 }), { alg: "RS256", kid: "unknown-again" }), "nonce"));
    assert.equal(calls, 2, "unknown keys cannot force an unbounded fetch loop");
    clock += 3601; fail = true;
    await assert.rejects(verify(token(claims({ iat: clock - 10, exp: clock + 600 })), "nonce"), { code: "twitch_keys_unavailable" });
  });
});

async function harness(t, { twitch = true, fetchImpl = keysFetch } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hub-identity-"));
  const store = createHubStore({ dir });
  const sessions = ["a", "b"].map((letter) => {
    const accountId = letter.repeat(64);
    store.createAccount({ id: accountId, credentials: [], joined: {}, createdAt: NOW });
    return store.createSession({ id: randomBytes(32).toString("base64url"), accountId, csrf: randomBytes(32).toString("base64url"), expiresAt: NOW + 1000 });
  });
  let clock = NOW;
  const season = { network: "devnet", arena: "GwYjjFYcc4DV8hLE6bCAQiM3rjstGWNZ6p3icjR7ZnxU", creator: "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb", season: "1", arenaSeasonStart: 1_790_553_600, arenaSeasonSeconds: 604_800, startsAt: 1_790_553_600, endsAt: 1_791_158_400, claimDeadline: 1_791_763_200, asset: "SOL", budgetBaseUnits: "1000000000", policy: { dailyCap: 25, weeklyCap: 100, weights: { question: 10, poll_response: 5, accepted_work: 20 } } };
  const api = createHubApi({ origins: ORIGIN, store, season, now: () => clock, identity: { twitch: twitch ? { clientId: "public-client", redirectUri: `${ORIGIN}/hub/twitch` } : null, fetchImpl }, limits: { read: 200, write: 200, auth: 200 } });
  const server = createServer(api);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path, { session = sessions[0], method = "POST", body = {}, origin = ORIGIN, csrf = session?.csrf } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/hub/api${path}`, { method, headers: { origin, ...(session ? { cookie: `hub_session=${session.id}` } : {}), ...(csrf ? { "x-hub-csrf": csrf } : {}), "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  return { dir, store, sessions, call, advance: (seconds) => { clock += seconds; } };
}

describe("hub identity API", () => {
  it("keeps optional linking separate from points and requires origin, session and CSRF", async (t) => {
    const h = await harness(t, { twitch: false });
    assert.deepEqual((await h.call("/identity", { method: "GET" })).json, { twitchEnabled: false, twitch: null, wallet: null });
    assert.equal((await h.call("/identity/twitch/start")).status, 409);
    for (const path of ["/identity/twitch/start", "/identity/twitch/finish", "/identity/twitch/unlink", "/identity/wallet/start", "/identity/wallet/finish", "/identity/wallet/unlink"]) {
      assert.equal((await h.call(path, { origin: "https://else.example" })).status, 403);
      assert.equal((await h.call(path, { session: null })).status, 401);
      assert.equal((await h.call(path, { csrf: "wrong" })).status, 403);
    }
    assert.deepEqual(h.store.submissions(), []);
  });
  it("links a verified Twitch identity once, bound to its initiating session; persists only safe fields", async (t) => {
    const h = await harness(t);
    assert.equal((await h.call("/join")).status, 200);
    assert.equal((await h.call("/activities", { body: { action: "question", text: "What is today's creator theme?" } })).json.points, "10");
    const standing = (await h.call("/state", { method: "GET" })).json.me;
    const start = (await h.call("/identity/twitch/start")).json;
    const url = new URL(start.url);
    assert.equal(url.origin, "https://id.twitch.tv");
    assert.equal(url.searchParams.get("response_type"), "id_token");
    assert.equal(url.searchParams.get("scope"), "openid");
    assert.equal(url.searchParams.get("redirect_uri"), `${ORIGIN}/hub/twitch`);
    const idToken = token(claims({ nonce: url.searchParams.get("nonce") }));
    const body = { state: start.state, idToken };
    assert.equal((await h.call("/identity/twitch/finish", { session: h.sessions[1], body })).status, 400);
    assert.equal((await h.call("/identity/twitch/finish", { body })).status, 200);
    assert.equal((await h.call("/identity/twitch/finish", { body })).status, 400, "replay rejected");
    const linked = (await h.call("/identity", { method: "GET" })).json.twitch;
    assert.deepEqual(linked, { subject: "123456", displayName: "LAN fan", verifiedAt: NOW });
    assert.deepEqual(createHubIdentityStore({ dir: h.dir }).get(h.sessions[0].accountId).twitch, linked, "survives restart");
    const disk = readFileSync(join(h.dir, "identities.json"), "utf8");
    assert.ok(!disk.includes(idToken) && !disk.includes(start.state) && !disk.includes("nonce"));
    assert.deepEqual((await h.call("/state", { method: "GET" })).json.me, standing, "identity cannot change native points or activity history");
    const other = (await h.call("/identity/twitch/start", { session: h.sessions[1] })).json;
    const otherToken = token(claims({ nonce: new URL(other.url).searchParams.get("nonce") }));
    assert.equal((await h.call("/identity/twitch/finish", { session: h.sessions[1], body: { state: other.state, idToken: otherToken } })).status, 409);
    assert.equal((await h.call("/identity/twitch/unlink")).status, 200);
    assert.equal((await h.call("/identity", { method: "GET" })).json.twitch, null);
    assert.deepEqual((await h.call("/state", { method: "GET" })).json.me, standing, "unlinking leaves points intact too");
  });
  it("invalidates a replaced or expired challenge and burns a rejected token challenge", async (t) => {
    const h = await harness(t);
    const first = (await h.call("/identity/twitch/start")).json;
    const second = (await h.call("/identity/twitch/start")).json;
    assert.equal((await h.call("/identity/twitch/finish", { body: { state: first.state, idToken: token() } })).status, 400);
    assert.equal((await h.call("/identity/twitch/finish", { body: { state: second.state, idToken: token() } })).status, 400);
    assert.equal((await h.call("/identity/twitch/finish", { body: { state: second.state, idToken: token(claims({ nonce: new URL(second.url).searchParams.get("nonce") })) } })).status, 400);
    const expired = (await h.call("/identity/twitch/start")).json;
    h.advance(301);
    assert.equal((await h.call("/identity/twitch/finish", { body: { state: expired.state, idToken: token() } })).status, 400);
  });
  it("requires an Ed25519 proof for the exact wallet, limits each wallet to one account, and never changes points", async (t) => {
    const h = await harness(t);
    const pair = generateKeyPairSync("ed25519");
    const address = encodeBase58(Buffer.from(pair.publicKey.export({ format: "jwk" }).x, "base64url"));
    const start = (await h.call("/identity/wallet/start", { body: { address } })).json;
    assert.ok(start.message.includes(ORIGIN) && start.message.includes(h.sessions[0].accountId) && start.message.includes(address));
    const signature = sign(null, Buffer.from(start.message), pair.privateKey).toString("base64url");
    const body = { challenge: start.challenge, signature };
    assert.equal((await h.call("/identity/wallet/finish", { session: h.sessions[1], body })).status, 400);
    assert.equal((await h.call("/identity/wallet/finish", { body })).status, 200);
    assert.equal((await h.call("/identity/wallet/finish", { body })).status, 400);
    const other = (await h.call("/identity/wallet/start", { session: h.sessions[1], body: { address } })).json;
    assert.equal((await h.call("/identity/wallet/finish", { session: h.sessions[1], body: { challenge: other.challenge, signature: sign(null, Buffer.from(other.message), pair.privateKey).toString("base64url") } })).status, 409);
    assert.deepEqual(h.store.submissions(), []);
    assert.equal(createHubIdentityStore({ dir: h.dir }).get(h.sessions[0].accountId).wallet.address, address);
    assert.equal((await h.call("/identity/wallet/unlink")).status, 200);
    assert.equal((await h.call("/identity", { method: "GET" })).json.wallet, null);
    const bad = (await h.call("/identity/wallet/start", { body: { address } })).json;
    assert.equal((await h.call("/identity/wallet/finish", { body: { challenge: bad.challenge, signature } })).status, 400, "signature for an old message is rejected");
    assert.equal((await h.call("/identity/wallet/start", { body: { address: "x" } })).status, 400);
  });

  it("does not finish an in-flight Twitch link after logout or unlink", async (t) => {
    for (const cancel of ["logout", "unlink"]) {
      let release; let entered;
      const started = new Promise((resolve) => { entered = resolve; });
      const waiting = new Promise((resolve) => { release = resolve; });
      const h = await harness(t, { fetchImpl: async (...args) => { entered(); await waiting; return keysFetch(...args); } });
      const start = (await h.call("/identity/twitch/start")).json;
      const finish = h.call("/identity/twitch/finish", { body: { state: start.state, idToken: token(claims({ nonce: new URL(start.url).searchParams.get("nonce") })) } });
      await started;
      if (cancel === "logout") h.store.deleteSession(h.sessions[0].id);
      else assert.equal((await h.call("/identity/twitch/unlink")).status, 200);
      release();
      assert.equal((await finish).status, cancel === "logout" ? 401 : 400);
      assert.equal(createHubIdentityStore({ dir: h.dir }).get(h.sessions[0].accountId).twitch, null);
    }
  });
});
