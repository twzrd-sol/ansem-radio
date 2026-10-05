// The hub API over real HTTP through the station, with a virtual authenticator built from node:crypto keys.
// No browser or external service: origins, season and store are test values.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { COOKIE, createHubApi, CSRF_HEADER, parseOrigins } from "../src/hub/api.js";
import { createHubStore } from "../src/hub/store.js";
import { base64url, encodeCbor } from "../src/hub/webauthn.js";
import { createLiveServer } from "../src/live/server.js";

const ORIGIN = "https://hub.example";
const RP_ID = "hub.example";
const ARENA = "GwYjjFYcc4DV8hLE6bCAQiM3rjstGWNZ6p3icjR7ZnxU";
const CREATOR = "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb";
const SEASON_START = 1_790_553_600; // Mon 2026-09-28 00:00 UTC
const WEEK = 604_800;
export const SEASON = {
  network: "devnet", arena: ARENA, creator: CREATOR, season: "2",
  arenaSeasonStart: SEASON_START, arenaSeasonSeconds: WEEK,
  startsAt: SEASON_START + WEEK, endsAt: SEASON_START + 2 * WEEK, claimDeadline: SEASON_START + 3 * WEEK,
  asset: "SOL", budgetBaseUnits: "1000000000",
  policy: { dailyCap: 25, weeklyCap: 100, weights: { question: 10, poll_response: 5, accepted_work: 20 } },
};
const OPEN_AT = SEASON.startsAt + 3 * 86_400 + 60; // Thursday of season 2
const dayOf = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);
const POLLS = [
  { id: "thu-1", day: dayOf(OPEN_AT), question: "Which sound opens Thursday's show?", options: ["Boom bap", "Drill", "Jersey club", "Lo-fi"] },
  { id: "fri-1", day: dayOf(OPEN_AT + 86_400), question: "Best length for a live set?", options: ["15 minutes", "30 minutes"], placeholder: true },
  { id: "sat-1", day: dayOf(OPEN_AT + 2 * 86_400), question: "Which city should Radio LAN spotlight next?", options: ["Atlanta", "Chicago"] },
];

const sha256 = (b) => createHash("sha256").update(b).digest();
const logs = () => ({ info() {}, warn() {}, error() {} });

/** A software authenticator: P-256 or Ed25519 key, one credential, a sign counter. */
export function authenticator({ alg = -7, rpId = RP_ID, origin = ORIGIN, counter = 1 } = {}) {
  const pair = alg === -7 ? generateKeyPairSync("ec", { namedCurve: "prime256v1" }) : generateKeyPairSync("ed25519");
  const jwk = pair.publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(16);
  const cose = alg === -7
    ? new Map([[1, 2], [3, -7], [-1, 1], [-2, base64url.decode(jwk.x)], [-3, base64url.decode(jwk.y)]])
    : new Map([[1, 1], [3, -8], [-1, 6], [-2, base64url.decode(jwk.x)]]);
  const authData = (flags, count, attested) => {
    const head = Buffer.alloc(37);
    sha256(Buffer.from(rpId)).copy(head, 0);
    head[32] = flags;
    head.writeUInt32BE(count, 33);
    if (!attested) return head;
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(credentialId.length);
    return Buffer.concat([head, Buffer.alloc(16), idLen, credentialId, encodeCbor(cose)]);
  };
  const clientData = (type, challenge) => base64url.encode(Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })));
  return {
    id: base64url.encode(credentialId),
    create: (options, { fmt = "none" } = {}) => ({
      id: base64url.encode(credentialId),
      response: {
        clientDataJSON: clientData("webauthn.create", options.challenge),
        attestationObject: base64url.encode(encodeCbor(new Map([["fmt", fmt], ["attStmt", new Map()], ["authData", new Uint8Array(authData(0x41, counter, true))]]))),
      },
    }),
    get: (options, { bump = 1, flags = 0x01, count } = {}) => {
      counter += bump;
      const cd = clientData("webauthn.get", options.challenge);
      const auth = authData(flags, count ?? counter, false);
      const signature = sign(alg === -7 ? "sha256" : null, Buffer.concat([auth, sha256(Buffer.from(base64url.decode(cd)))]), pair.privateKey);
      return { id: base64url.encode(credentialId), response: { clientDataJSON: cd, authenticatorData: base64url.encode(auth), signature: base64url.encode(signature), userHandle: null } };
    },
  };
}

/** A fetch with a cookie jar and the CSRF token, like the page. */
let nextIp = 1;
function client(base, { origin = ORIGIN, edgeIp = `203.0.113.${nextIp++}` } = {}) {
  let cookie = "";
  let csrf = "";
  const call = async (method, path, body, { headers = {}, noCsrf = false } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...(csrf && !noCsrf ? { [CSRF_HEADER]: csrf } : {}), "cf-connecting-ip": edgeIp, ...headers },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const json = await response.json();
    if (json.csrf) csrf = json.csrf;
    return { status: response.status, json, setCookie: set };
  };
  return { call, get: (path, o) => call("GET", path, undefined, o), post: (path, body = {}, o) => call("POST", path, body, o), get cookie() { return cookie; } };
}

describe("hub API: passkeys, sessions, the season and the free activities", () => {
  let dir;
  let live;
  let base;
  let clock = OPEN_AT;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "hub-api-"));
    live = createLiveServer({ oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, hubOrigins: `${ORIGIN},http://localhost:4173`, hubStore: createHubStore({ dir }), hubSeason: SEASON, hubPolls: POLLS, hubClock: () => clock, log: logs() });
    const { port } = await live.listen({ port: 0 });
    base = `http://127.0.0.1:${port}`;
  });
  after(async () => {
    await live.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers 400 on a malformed request target instead of crashing the station", async () => {
    const port = Number(new URL(base).port);
    const first = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => socket.write(`GET http://[ HTTP/1.1\r\nHost: x\r\n\r\n`));
      let out = ""; socket.on("data", (d) => (out += d)); socket.setTimeout(1500, () => socket.destroy());
      socket.on("close", () => resolve(out.split("\r\n")[0] || "(no response)"));
    });
    assert.equal(first, "HTTP/1.1 400 Bad Request");
    assert.equal((await fetch(`${base}/hub/api/state`)).status, 200, "the station is still serving valid requests");
  });

  const register = async (c, auth) => {
    const options = await c.post("/hub/api/register/options");
    assert.equal(options.status, 200);
    assert.equal(options.json.publicKey.rp.id, RP_ID);
    assert.equal(options.json.publicKey.attestation, "none");
    const done = await c.post("/hub/api/register", auth.create(options.json.publicKey));
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.match(done.setCookie, new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43}; Path=/hub; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$`));
    return done.json;
  };

  it("refuses origins that cannot be passkey RP ids, and non-origins", () => {
    assert.throws(() => parseOrigins("http://127.0.0.1:4173"), /IP literal/);
    assert.throws(() => parseOrigins("http://hub.example"), /http only for localhost/);
    assert.throws(() => parseOrigins("https://hub.example/hub"), /bare origin/);
    assert.throws(() => parseOrigins(""), /at least one/);
    assert.deepEqual(parseOrigins("https://hub.example, http://localhost:4173"), { origins: ["https://hub.example", "http://localhost:4173"], rpIds: ["hub.example", "localhost"] });
  });

  it("serves the season state to anyone through the edge, and refuses a direct peer that is not loopback-fronted", async () => {
    const c = client(base);
    const state = await c.get("/hub/api/state");
    assert.equal(state.status, 200);
    assert.deepEqual(state.json.me, null);
    assert.equal(state.json.season.number, "2");
    assert.equal(state.json.season.open, true);
    assert.deepEqual(state.json.season.policy, SEASON.policy);
    assert.equal(state.json.season.players, 0);
    assert.equal((await c.get("/hub/api/nope")).status, 404);
    assert.equal((await c.post("/hub/api/state")).status, 405);
  });

  it("registers a P-256 passkey, signs the session in, and reads the account back", async () => {
    const c = client(base);
    const auth = authenticator({ alg: -7 });
    const registered = await register(c, auth);
    assert.match(registered.accountId, /^[0-9a-f]{64}$/);
    const me = await c.get("/hub/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.accountId, registered.accountId);
    assert.equal(me.json.credentials, 1);
    assert.equal(me.json.csrf, registered.csrf);
    assert.equal(me.json.standing.joined, false);
    const state = await c.get("/hub/api/state");
    assert.equal(state.json.me.accountId, registered.accountId);
  });

  it("refuses a registration with a reused challenge, a foreign origin, a wrong RP id, or no Origin header", async () => {
    const c = client(base);
    const auth = authenticator();
    const options = await c.post("/hub/api/register/options");
    const first = await c.post("/hub/api/register", auth.create(options.json.publicKey));
    assert.equal(first.status, 200);
    const replay = await c.post("/hub/api/register", authenticator().create(options.json.publicKey));
    assert.equal(replay.status, 400);
    assert.equal(replay.json.error, "unknown_or_expired_challenge");
    const foreign = client(base, { origin: "https://evil.example" });
    assert.equal((await foreign.post("/hub/api/register/options")).status, 403);
    const options2 = await c.post("/hub/api/register/options");
    const wrongOrigin = await c.post("/hub/api/register", authenticator({ origin: "https://evil.example" }).create(options2.json.publicKey));
    assert.equal(wrongOrigin.status, 400);
    assert.equal(wrongOrigin.json.error, "registration_rejected");
    assert.match(wrongOrigin.json.detail, /origin not allowed/);
    const options3 = await c.post("/hub/api/register/options");
    const wrongRp = await c.post("/hub/api/register", authenticator({ rpId: "evil.example" }).create(options3.json.publicKey));
    assert.equal(wrongRp.status, 400);
    assert.match(wrongRp.json.detail, /RP id mismatch/);
    const noOrigin = client(base, { origin: null });
    assert.equal((await noOrigin.post("/hub/api/register/options")).status, 403);
  });

  it("caps pending challenges per client: the eleventh evicts that client's oldest, and nobody else's", async () => {
    // Straight at the handler with a high auth limit, so the per-client eviction is what is measured.
    const api = createHubApi({ origins: ORIGIN, store: createHubStore({ dir: mkdtempSync(join(tmpdir(), "hub-api-flood-")) }), log: logs(), limits: { read: 1000, write: 1000, auth: 1000 } });
    const direct = async (ip, path, body = {}) => {
      const raw = Buffer.from(JSON.stringify(body));
      const answered = {};
      const response = { writeHead: (status, headers) => (Object.assign(answered, { status, headers }), response), end: (text) => Object.assign(answered, { json: JSON.parse(text) }) };
      const request = { method: "POST", url: path, headers: { origin: ORIGIN, "content-type": "application/json", "content-length": String(raw.length), "cf-connecting-ip": ip }, socket: { remoteAddress: "127.0.0.1" }, async *[Symbol.asyncIterator]() { yield raw; } };
      await api(request, response);
      return answered;
    };
    const options = async (ip) => (await direct(ip, "/hub/api/register/options")).json.publicKey;
    const theirs = await options("198.51.100.2");
    const oldest = await options("198.51.100.1");
    for (let i = 0; i < 9; i += 1) await options("198.51.100.1");
    assert.equal((await direct("198.51.100.1", "/hub/api/register", authenticator().create(oldest))).status, 200, "ten pending: the oldest still works");
    const second = await options("198.51.100.1");
    for (let i = 0; i < 10; i += 1) await options("198.51.100.1");
    assert.equal((await direct("198.51.100.1", "/hub/api/register", authenticator().create(second))).json.error, "unknown_or_expired_challenge", "ten newer challenges evicted it");
    assert.equal((await direct("198.51.100.2", "/hub/api/register", authenticator().create(theirs))).status, 200, "another client's challenge survives the flood");
  });

  it("signs in again with the passkey (Ed25519 too), refuses a bad signature, a stale counter and an unknown credential", async () => {
    const c = client(base);
    const auth = authenticator({ alg: -8 });
    const registered = await register(c, auth);
    const fresh = client(base);
    const options = await fresh.post("/hub/api/login/options");
    assert.equal(options.json.publicKey.rpId, RP_ID);
    const login = await fresh.post("/hub/api/login", auth.get(options.json.publicKey));
    assert.equal(login.status, 200, JSON.stringify(login.json));
    assert.equal(login.json.accountId, registered.accountId);
    assert.equal((await fresh.get("/hub/api/me")).json.accountId, registered.accountId);
    // A stale counter (a cloned authenticator) is refused, and so is a 0 once the credential has counted.
    const stale = await fresh.post("/hub/api/login", auth.get((await fresh.post("/hub/api/login/options")).json.publicKey, { bump: -1 }));
    assert.equal(stale.status, 400);
    assert.match(stale.json.detail, /sign count/);
    const zeroed = auth.get((await fresh.post("/hub/api/login/options")).json.publicKey, { bump: 5, count: 0 });
    assert.match((await fresh.post("/hub/api/login", zeroed)).json.detail, /sign count/);
    // A tampered signature is refused. (A second client: ten sign-in attempts a minute is the limit per client.)
    const probe = client(base);
    const tampered = auth.get((await probe.post("/hub/api/login/options")).json.publicKey, { bump: 5 });
    tampered.response.signature = base64url.encode(Buffer.from(base64url.decode(tampered.response.signature)).map((b, i) => (i === 10 ? b ^ 1 : b)));
    const bad = await probe.post("/hub/api/login", tampered);
    assert.equal(bad.status, 400);
    assert.match(bad.json.detail, /does not verify/);
    // No user presence: refused.
    const absent = await probe.post("/hub/api/login", auth.get((await probe.post("/hub/api/login/options")).json.publicKey, { bump: 5, flags: 0x00 }));
    assert.match(absent.json.detail, /presence/);
    const unknown = await probe.post("/hub/api/login", authenticator({ alg: -8 }).get((await probe.post("/hub/api/login/options")).json.publicKey));
    assert.equal(unknown.json.error, "unknown_credential");
  });

  it("joins the season and credits a question, a poll answer, and queues accepted work, with the caps of the season policy", async () => {
    const c = client(base);
    await register(c, authenticator());
    const early = await c.post("/hub/api/activities", { action: "question", text: "Who is on next week?" });
    assert.equal(early.status, 409);
    assert.equal(early.json.error, "join_first");
    const joined = await c.post("/hub/api/join");
    assert.equal(joined.status, 200);
    assert.equal(joined.json.joined, true);
    assert.equal((await c.get("/hub/api/state")).json.season.players, 1);
    const q = await c.post("/hub/api/activities", { action: "question", text: "Who is on next week?" });
    assert.equal(q.status, 200, JSON.stringify(q.json));
    assert.equal(q.json.submission.status, "credited");
    assert.equal(q.json.points, "10");
    assert.equal(q.json.today, "10");
    const again = await c.post("/hub/api/activities", { action: "question", text: " Who is on next week? " });
    assert.equal(again.status, 409);
    assert.equal(again.json.error, "already_submitted");
    const poll = await c.post("/hub/api/activities", { action: "poll_response", pollId: "thu-1", choice: 2 });
    assert.equal(poll.json.points, "15");
    assert.equal((await c.post("/hub/api/activities", { action: "poll_response", pollId: "thu-1", choice: 0 })).status, 409);
    const work = await c.post("/hub/api/activities", { action: "accepted_work", text: "A clip of the opening" });
    assert.equal(work.json.submission.status, "pending");
    assert.equal(work.json.points, "15", "pending work credits nothing");
    assert.equal(work.json.pending, 1);
    // Daily cap: 25 a day across actions, so a second question today awards the remaining 10.
    const q2 = await c.post("/hub/api/activities", { action: "question", text: "Second question" });
    assert.equal(q2.json.points, "25");
    const q3 = await c.post("/hub/api/activities", { action: "question", text: "Third question" });
    assert.equal(q3.json.points, "25", "capped for today");
    clock += 86_400;
    const q4 = await c.post("/hub/api/activities", { action: "question", text: "Tomorrow's question" });
    assert.equal(q4.json.points, "35");
    assert.equal(q4.json.today, "10");
    clock = OPEN_AT;
    assert.equal((await c.post("/hub/api/activities", { action: "question", text: "" })).json.error, "text_length");
    // Nothing derived from Twitch is an activity (AGENTS.md hard boundary): every Twitch-shaped kind is refused by
    // name, and a source field cannot smuggle one in under a native name.
    for (const action of ["raid", "subscription", "sub", "bits", "cheer", "channel_points", "prediction", "chat", "follow", "watch_time", "clip_view"]) {
      const refused = await c.post("/hub/api/activities", { action, text: "x", pollId: "p", choice: 0 });
      assert.equal(refused.status, 400, action);
      assert.equal(refused.json.error, "unknown_action", action);
    }
    const smuggled = await c.post("/hub/api/activities", { action: "question", source: "twitch", text: "From chat" });
    assert.equal(smuggled.status, 400);
    assert.equal(smuggled.json.error, "unknown_field");
    assert.equal((await c.post("/hub/api/activities", { action: "poll_response", pollId: "thu-1", choice: 4 })).json.error, "choice_required");
    assert.equal((await c.post("/hub/api/activities", { action: "poll_response", pollId: "invented", choice: 0 })).json.error, "poll_not_open");
  });

  it("requires the session cookie and the CSRF token on writes, and nothing but Origin on sign-up", async () => {
    const c = client(base);
    assert.equal((await c.post("/hub/api/join")).status, 401);
    await register(c, authenticator());
    const noCsrf = await c.post("/hub/api/join", {}, { noCsrf: true });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json.error, "csrf_token_mismatch");
    const wrongCsrf = await c.post("/hub/api/join", {}, { headers: { [CSRF_HEADER]: "nope" } });
    assert.equal(wrongCsrf.status, 403);
    const crossSite = await c.post("/hub/api/join", {}, { headers: { origin: "https://evil.example" } });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.json.error, "origin_not_allowed");
    assert.equal((await c.post("/hub/api/join")).status, 200);
    const out = await c.post("/hub/api/logout");
    assert.equal(out.status, 200);
    assert.match(out.setCookie, /Max-Age=0/);
    assert.equal((await c.get("/hub/api/me")).status, 401);
  });

  it("refuses a socket peer that is not loopback, serves a loopback peer with no edge header from the shared bucket, and persists across a restart", async () => {
    const api = createHubApi({ origins: ORIGIN, store: createHubStore({ dir: mkdtempSync(join(tmpdir(), "hub-api-peer-")) }), log: logs() });
    const answered = [];
    const fakeResponse = { writeHead: (status, headers) => (answered.push({ status, headers }), fakeResponse), end: (body) => answered.push({ body: JSON.parse(body) }) };
    await api({ method: "GET", url: "/hub/api/state", headers: { origin: ORIGIN, "cf-connecting-ip": "203.0.113.9" }, socket: { remoteAddress: "203.0.113.5" } }, fakeResponse);
    assert.equal(answered[0].status, 403);
    assert.equal(answered[1].body.error, "not_through_the_edge");
    const direct = await fetch(`${base}/hub/api/state`, { headers: { origin: ORIGIN } });
    assert.equal(direct.status, 200, "loopback peer without CF-Connecting-IP shares one bucket, still served");
    const store = createHubStore({ dir });
    const counts = store.counts();
    assert.ok(counts.accounts >= 4, `accounts persisted: ${counts.accounts}`);
    assert.ok(counts.submissions >= 5, `submissions persisted: ${counts.submissions}`);
    const reopened = createLiveServer({ oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, hubOrigins: ORIGIN, hubStore: store, hubSeason: SEASON, hubClock: () => clock, log: logs() });
    const { port } = await reopened.listen({ port: 0 });
    try {
      const state = await client(`http://127.0.0.1:${port}`).get("/hub/api/state");
      assert.equal(state.json.season.players, 2);
      assert.equal(state.json.season.credited, 5);
    } finally {
      await reopened.close?.();
    }
  });

  it("without a season: state says so and join is refused; without an origin the station has no hub API", async () => {
    const plain = createLiveServer({ oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, hubOrigins: ORIGIN, hubStore: createHubStore({ dir: mkdtempSync(join(tmpdir(), "hub-api-none-")) }), hubSeason: null, log: logs() });
    const { port } = await plain.listen({ port: 0 });
    try {
      const c = client(`http://127.0.0.1:${port}`);
      assert.equal((await c.get("/hub/api/state")).json.season, null);
      await register(c, authenticator());
      assert.equal((await c.post("/hub/api/join")).json.error, "no_season");
    } finally {
      await plain.close?.();
    }
    const none = createLiveServer({ oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, hubOrigins: "", log: logs() });
    const other = await none.listen({ port: 0 });
    try {
      assert.equal((await fetch(`http://127.0.0.1:${other.port}/hub/api/state`)).status, 404, "no hub API: the station's own routes answer");
    } finally {
      await none.close?.();
    }
    assert.throws(() => createLiveServer({ oauthToken: "", hubOrigins: "http://10.0.0.1", log: logs() }), /IP literal/);
  });
});

describe("hub API: published polls, the provisional board, ranks and badges", () => {
  let dir;
  let live;
  let base;
  let testClock = OPEN_AT;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "hub-board-"));
    live = createLiveServer({ oauthToken: "", createIrcSession: () => { throw new Error("must not start"); }, hubOrigins: ORIGIN, hubStore: createHubStore({ dir }), hubSeason: SEASON, hubPolls: POLLS, hubClock: () => testClock, log: logs() });
    const { port } = await live.listen({ port: 0 });
    base = `http://127.0.0.1:${port}`;
  });
  after(async () => {
    await live.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  const fan = async () => {
    const c = client(base);
    const options = await c.post("/hub/api/register/options");
    const account = await c.post("/hub/api/register", authenticator().create(options.json.publicKey));
    assert.equal(account.status, 200);
    assert.equal((await c.post("/hub/api/join")).status, 200);
    return { c, accountId: account.json.accountId };
  };

  it("serves only the poll for today's UTC date and shows when a poll is a placeholder", async () => {
    const c = client(base);
    assert.deepEqual((await c.get("/hub/api/state")).json.season.poll, { id: "thu-1", question: "Which sound opens Thursday's show?", options: ["Boom bap", "Drill", "Jersey club", "Lo-fi"], placeholder: false });
    testClock = OPEN_AT + 86_400;
    assert.deepEqual((await c.get("/hub/api/state")).json.season.poll, { id: "fri-1", question: "Best length for a live set?", options: ["15 minutes", "30 minutes"], placeholder: true });
    testClock = OPEN_AT + 2 * 86_400;
    assert.equal((await c.get("/hub/api/state")).json.season.poll.id, "sat-1");
    testClock = OPEN_AT + 3 * 86_400;
    assert.equal((await c.get("/hub/api/state")).json.season.poll, null);
    testClock = OPEN_AT;
  });

  it("allows one answer per real poll across UTC days and reports the current poll separately", async () => {
    const { c } = await fan();
    assert.equal((await c.post("/hub/api/activities", { action: "poll_response", pollId: "thu-1", choice: 0 })).status, 200);
    testClock = OPEN_AT + 2 * 86_400;
    assert.equal((await c.get("/hub/api/state")).json.season.poll.id, "sat-1");
    const next = await c.post("/hub/api/activities", { action: "poll_response", pollId: "sat-1", choice: 1 });
    assert.equal(next.status, 200);
    assert.equal(next.json.points, "10");
    assert.deepEqual(next.json.submissions.filter((s) => s.action === "poll_response").map((s) => s.pollId), ["thu-1", "sat-1"]);
    testClock = OPEN_AT;
  });

  it("never awards points for a placeholder poll, even if the client submits it directly", async () => {
    const { c } = await fan();
    testClock = OPEN_AT + 86_400;
    const response = await c.post("/hub/api/activities", { action: "poll_response", pollId: "fri-1", choice: 0 });
    assert.equal(response.status, 409);
    assert.equal(response.json.error, "poll_not_creditable");
    assert.equal((await c.get("/hub/api/state")).json.me.points, "0");
    testClock = OPEN_AT;
  });

  it("ranks credited points, exposes short handles only, and reports activity badges", async () => {
    const a = await fan();
    const b = await fan();
    const idle = await fan();
    await a.c.post("/hub/api/activities", { action: "question", text: "A's first" });
    await b.c.post("/hub/api/activities", { action: "poll_response", pollId: "thu-1", choice: 1 });
    await a.c.post("/hub/api/activities", { action: "poll_response", pollId: "thu-1", choice: 0 });
    const state = (await a.c.get("/hub/api/state")).json;
    assert.deepEqual(state.season.board.find(([handle]) => handle === `fan-${a.accountId.slice(0, 8)}`), [`fan-${a.accountId.slice(0, 8)}`, "15"]);
    assert.deepEqual(state.season.board.find(([handle]) => handle === `fan-${b.accountId.slice(0, 8)}`), [`fan-${b.accountId.slice(0, 8)}`, "5"]);
    assert.equal(JSON.stringify(state.season.board).includes(a.accountId), false);
    assert.equal(state.me.rank, 1);
    const bRank = (await b.c.get("/hub/api/state")).json.me.rank;
    const idleRank = (await idle.c.get("/hub/api/state")).json.me.rank;
    assert.ok(Number.isInteger(bRank) && bRank > state.me.rank);
    assert.ok(idleRank === null || (Number.isInteger(idleRank) && idleRank > bRank));
    assert.deepEqual(state.me.badges.map(({ id }) => id), ["first_play"]);
    testClock = OPEN_AT + 86_400;
    await a.c.post("/hub/api/activities", { action: "question", text: "A on day two" });
    testClock = OPEN_AT + 2 * 86_400;
    const thirdDay = await a.c.post("/hub/api/activities", { action: "question", text: "A on day three" });
    assert.deepEqual(thirdDay.json.badges.map(({ id }) => id), ["first_play", "three_days"]);
    testClock = OPEN_AT;
  });

  it("credits one of twenty identical submissions sent concurrently", async () => {
    const { c } = await fan();
    const responses = await Promise.all(Array.from({ length: 20 }, () => c.post("/hub/api/activities", { action: "question", text: "One identical action" })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, ...Array(19).fill(409)]);
    assert.ok(responses.filter((r) => r.status === 409).every((r) => r.json.error === "already_submitted"));
  });
});
