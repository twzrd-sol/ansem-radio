import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createHubApi } from "../src/hub/api.js";
import { createClaimStore } from "../src/hub/claims.js";
import { registry } from "../src/hub/registry.js";
import { createHubStore } from "../src/hub/store.js";
import { TWITCH_ISSUER, TWITCH_KEYS } from "../src/hub/twitch-identity.js";

const ORIGIN = "https://hub.example";
const NOW = 1_791_025_000;
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "twitch-test", use: "sig", alg: "RS256" };
const token = (payload) => {
  const text = [{ alg: "RS256", kid: jwk.kid }, payload].map((v) => Buffer.from(JSON.stringify(v)).toString("base64url")).join(".");
  return `${text}.${sign("RSA-SHA256", Buffer.from(text), rsa.privateKey).toString("base64url")}`;
};
const keysFetch = async (url) => { assert.equal(url, TWITCH_KEYS); return new Response(JSON.stringify({ keys: [jwk] })); };
const LISTINGS = registry([
  { slug: "alpha", name: "Alpha", kind: "tracked", twitch: "alpha_live", streamer: null, mint: null },
  { slug: "beta", name: "Beta", kind: "tracked", twitch: "beta_live", streamer: null, mint: null },
  { slug: "nochan", name: "No channel", kind: "demo", twitch: null, streamer: null, mint: null },
]);

async function harness(t) {
  const dir = mkdtempSync(join(tmpdir(), "hub-claims-"));
  const store = createHubStore({ dir });
  const sessions = ["a", "b", "c"].map((letter) => {
    const accountId = letter.repeat(64);
    store.createAccount({ id: accountId, credentials: [], joined: {}, createdAt: NOW });
    return store.createSession({ id: randomBytes(32).toString("base64url"), accountId, csrf: randomBytes(32).toString("base64url"), expiresAt: NOW + 1000 });
  });
  const api = createHubApi({ origins: ORIGIN, store, now: () => NOW, registry: LISTINGS, identity: { twitch: { clientId: "public-client", redirectUri: `${ORIGIN}/hub/twitch` }, fetchImpl: keysFetch }, limits: { read: 200, write: 200, auth: 200 } });
  const server = createServer(api);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path, { session = sessions[0], method = "POST", body = {}, origin = ORIGIN, csrf = session?.csrf } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/hub/api${path}`, { method, headers: { origin, ...(session ? { cookie: `hub_session=${session.id}` } : {}), ...(csrf ? { "x-hub-csrf": csrf } : {}), "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  // Link a Twitch identity (sub, username) to a session through the real start/finish routes.
  const link = async (session, sub, username) => {
    const start = (await call("/identity/twitch/start", { session })).json;
    const nonce = new URL(start.url).searchParams.get("nonce");
    const idToken = token({ iss: TWITCH_ISSUER, aud: "public-client", azp: "public-client", sub, preferred_username: username, iat: NOW - 10, exp: NOW + 600, nonce });
    return call("/identity/twitch/finish", { session, body: { state: start.state, idToken } });
  };
  return { dir, sessions, call, link };
}

describe("streamer claims", () => {
  it("lets the verified owner of a channel claim its listing, and exposes only the mark", async (t) => {
    const h = await harness(t);
    assert.equal((await h.call("/claims", { body: { slug: "alpha" } })).status, 409, "needs a Twitch link first");
    assert.equal((await h.link(h.sessions[0], "1001", "Alpha_Live")).status, 200);
    const claimed = await h.call("/claims", { body: { slug: "alpha" } });
    assert.deepEqual(claimed.json, { slug: "alpha", claimed: true, claimedAt: NOW });
    assert.equal((await h.call("/claims", { body: { slug: "alpha" } })).status, 200, "idempotent for the same Twitch user");
    const listed = await h.call("/claims", { method: "GET", session: null });
    assert.deepEqual(listed.json.claimed, [{ slug: "alpha", claimedAt: NOW }]);
    const disk = readFileSync(join(h.dir, "claims.json"), "utf8");
    assert.ok(!listed.json.claimed[0].subject && JSON.stringify(listed.json).indexOf("1001") === -1, "no Twitch id in the public read");
    assert.ok(disk.includes("1001") && !disk.includes("idToken"));
    assert.equal(createClaimStore({ dir: h.dir }).has("alpha"), true, "survives restart");
  });
  it("refuses another person's channel, a channel-less listing, an unknown slug and a second claimer", async (t) => {
    const h = await harness(t);
    await h.link(h.sessions[0], "1001", "alpha_live");
    await h.link(h.sessions[1], "2002", "someone_else");
    assert.equal((await h.call("/claims", { session: h.sessions[1], body: { slug: "alpha" } })).status, 403);
    assert.equal((await h.call("/claims", { body: { slug: "nochan" } })).status, 409);
    assert.equal((await h.call("/claims", { body: { slug: "ghost" } })).status, 404);
    assert.equal((await h.call("/claims", { body: { slug: "BAD SLUG" } })).status, 400);
    assert.equal((await h.call("/claims", { body: { slug: "alpha", extra: 1 } })).status, 400);
    assert.equal((await h.call("/claims", { body: { slug: "alpha" } })).status, 200);
    // A login later reassigned to a different Twitch user cannot take over an existing claim.
    await h.link(h.sessions[2], "3003", "alpha_live");
    const taken = await h.call("/claims", { session: h.sessions[2], body: { slug: "alpha" } });
    assert.equal(taken.status, 409);
    assert.equal(taken.json.error ?? taken.json.code, "already_claimed");
  });
  it("requires origin, session and CSRF to write, and only the claimer can release", async (t) => {
    const h = await harness(t);
    await h.link(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    for (const path of ["/claims", "/claims/release"]) {
      assert.equal((await h.call(path, { origin: "https://else.example", body: { slug: "alpha" } })).status, 403);
      assert.equal((await h.call(path, { session: null, body: { slug: "alpha" } })).status, 401);
      assert.equal((await h.call(path, { csrf: "wrong", body: { slug: "alpha" } })).status, 403);
    }
    assert.equal((await h.call("/claims/release", { session: h.sessions[1], body: { slug: "alpha" } })).status, 404);
    assert.deepEqual((await h.call("/claims/release", { body: { slug: "alpha" } })).json, { slug: "alpha", claimed: false });
    assert.deepEqual((await h.call("/claims", { method: "GET", session: null })).json.claimed, []);
  });
  it("claiming adds no points and leaves standing and the public season unchanged", async (t) => {
    const h = await harness(t);
    await h.call("/identity", { method: "GET" });
    await h.link(h.sessions[0], "1001", "alpha_live");
    const before = (await h.call("/state", { method: "GET" })).json;
    assert.equal((await h.call("/claims", { body: { slug: "alpha" } })).status, 200);
    const after = (await h.call("/state", { method: "GET" })).json;
    assert.deepEqual({ ...after, generatedAt: 0 }, { ...before, generatedAt: 0 });
  });
});
