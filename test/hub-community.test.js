import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { ACTIONS } from "../src/hub/points.js";
import { createHubApi } from "../src/hub/api.js";
import { createHubStore } from "../src/hub/store.js";
import { createCommunityStore } from "../src/hub/community-store.js";
import {
  COMMUNITY_REFUSE,
  buildAuthorizeUrl,
  communityConfig,
  evaluateCommunity,
  hashInviteToken,
} from "../src/hub/community.js";

const ORIGIN = "https://hub.example";
const NOW = 1_791_025_000;
const MIN_AGE = 72 * 60 * 60;
const season = {
  network: "devnet",
  arena: "GwYjjFYcc4DV8hLE6bCAQiM3rjstGWNZ6p3icjR7ZnxU",
  creator: "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb",
  season: "1",
  arenaSeasonStart: 1_790_553_600,
  arenaSeasonSeconds: 604_800,
  startsAt: 1_790_553_600,
  endsAt: 1_791_158_400,
  claimDeadline: 1_791_763_200,
  asset: "SOL",
  budgetBaseUnits: "1000000000",
  policy: { dailyCap: 25, weeklyCap: 100, weights: { question: 10, poll_response: 5, accepted_work: 20 } },
};
const oauthProof = {
  provider: "discord",
  communityId: "123456789012345678",
  subject: "member-1",
  method: "oauth",
  oauthMember: true,
  memberSince: NOW - MIN_AGE - 10,
};

describe("community evaluation", () => {
  it("refuses farms, fake joins, churn, and unpublished weights", () => {
    const base = {
      proof: oauthProof,
      accountId: "a".repeat(64),
      season: { open: true, startsAt: season.startsAt },
      joinedSeason: true,
      policy: { weight: 15, minMembershipSeconds: MIN_AGE, dailyCap: 25, weeklyCap: 100 },
      standing: { today: 0, points: 0 },
      now: NOW,
    };
    assert.equal(evaluateCommunity({ ...base, proof: { ...oauthProof, viewers: 12 } }).eligibility.reason, COMMUNITY_REFUSE.engagement_farm);
    assert.equal(evaluateCommunity({ ...base, proof: { ...oauthProof, method: "self_attested" } }).eligibility.reason, COMMUNITY_REFUSE.self_attested);
    assert.equal(evaluateCommunity({ ...base, proof: { ...oauthProof, memberSince: NOW - 60 } }).eligibility.reason, COMMUNITY_REFUSE.fresh_join);
    assert.equal(evaluateCommunity({
      ...base,
      existing: { churnEvents: [{ kind: "join", at: NOW - 200 }, { kind: "leave", at: NOW - 100 }, { kind: "join", at: NOW - 10 }] },
    }).eligibility.reason, COMMUNITY_REFUSE.churn);
    const ready = evaluateCommunity(base);
    assert.equal(ready.eligibility.reason, "ready");
    assert.equal(ready.award, 15);
    assert.equal(evaluateCommunity({ ...base, policy: { ...base.policy, weight: 0 } }).eligibility.reason, COMMUNITY_REFUSE.weight_unpublished);
  });

  it("builds authorize URLs only for Discord and X and stays gated without credentials", () => {
    assert.deepEqual(communityConfig({}), {
      discord: { enabled: false },
      x: { enabled: false },
      policy: { weight: 0, minMembershipSeconds: MIN_AGE },
    });
    assert.throws(() => communityConfig({ RADIOLAN_HUB_DISCORD_CLIENT_ID: "only-one" }), /community needs/);
    const discord = buildAuthorizeUrl("discord", { clientId: "app", redirectUri: `${ORIGIN}/hub/discord`, state: "s1" });
    assert.equal(new URL(discord).origin, "https://discord.com");
    assert.equal(new URL(discord).searchParams.get("scope"), "identify guilds");
    const x = buildAuthorizeUrl("x", { clientId: "app", redirectUri: `${ORIGIN}/hub/x`, state: "s1", codeChallenge: "c".repeat(43) });
    assert.equal(new URL(x).origin, "https://x.com");
    assert.ok(!new URL(x).searchParams.get("scope")?.includes("tweet.write"));
  });
});

async function harness(t, { community } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hub-community-"));
  const store = createHubStore({ dir });
  const communityStore = createCommunityStore({ dir });
  const accountId = "a".repeat(64);
  store.createAccount({ id: accountId, credentials: [], joined: {}, createdAt: NOW });
  const session = store.createSession({ id: randomBytes(32).toString("base64url"), accountId, csrf: randomBytes(32).toString("base64url"), expiresAt: NOW + 1000 });
  const api = createHubApi({
    origins: ORIGIN,
    store,
    season,
    now: () => NOW,
    community: { store: communityStore, config: community ?? communityConfig({}) },
    limits: { read: 200, write: 200, auth: 200 },
  });
  const server = createServer(api);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path, { method = "POST", body = {}, csrf = session.csrf } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/hub/api${path}`, {
      method,
      headers: { origin: ORIGIN, cookie: `hub_session=${session.id}`, ...(csrf ? { "x-hub-csrf": csrf } : {}), "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };
  return { dir, store, communityStore, session, call };
}

const liveCommunity = {
  discord: { enabled: true, clientId: "discord-app", redirectUri: `${ORIGIN}/hub/discord`, communityId: "123456789012345678" },
  x: { enabled: true, clientId: "x-app", redirectUri: `${ORIGIN}/hub/x`, communityId: "x-community-1" },
  policy: { weight: 15, minMembershipSeconds: MIN_AGE },
};

describe("community hub API", () => {
  it("keeps native actions unchanged and gates live connections without credentials", async (t) => {
    assert.deepEqual([...ACTIONS], ["question", "poll_response", "accepted_work"]);
    const h = await harness(t);
    const catalog = await h.call("/communities", { method: "GET" });
    assert.equal(catalog.status, 200);
    assert.equal(catalog.json.sample, false);
    assert.equal(catalog.json.oauthWired, false);
    assert.equal(catalog.json.policy.weight, 0);
    assert.ok(catalog.json.providers.every((row) => row.credentials === false && row.eligibility.reason === "needs_credentials"));
    assert.equal((await h.call("/communities/discord/start")).status, 409);
    assert.equal((await h.call("/communities/discord/start")).json.error, "community_credentials_required");
    assert.equal((await h.call("/communities/x/finish", { body: { code: "secret-code", state: "s" } })).json.error, "community_credentials_required");
    assert.equal((await h.call("/communities/invite", { body: { token: "a".repeat(40) } })).json.error, "community_credentials_required");
    assert.deepEqual(h.store.submissions(), []);
  });

  it("issues a real authorize URL when credentials exist and still refuses to invent membership", async (t) => {
    const h = await harness(t, { community: liveCommunity });
    const start = await h.call("/communities/discord/start");
    assert.equal(start.status, 200);
    const url = new URL(start.json.url);
    assert.equal(url.origin, "https://discord.com");
    assert.equal(url.pathname, "/oauth2/authorize");
    assert.equal(url.searchParams.get("redirect_uri"), `${ORIGIN}/hub/discord`);
    const finish = await h.call("/communities/discord/finish", { body: { code: "secret-code", state: start.json.state } });
    assert.equal(finish.status, 409);
    assert.equal(finish.json.error, "oauth_not_wired");
    const path = join(h.dir, "communities.json");
    if (existsSync(path)) {
      const disk = readFileSync(path, "utf8");
      assert.ok(!disk.includes("secret-code"));
      assert.ok(!disk.includes(start.json.state));
    }
    assert.deepEqual(h.store.submissions(), []);
  });

  it("notes an invite without granting eligibility, and credits only a verified member under caps", async (t) => {
    const h = await harness(t, { community: liveCommunity });
    await h.call("/join");
    const before = (await h.call("/state", { method: "GET" })).json.me;
    const token = randomBytes(24).toString("base64url");
    h.communityStore.issueInvite({ communityId: liveCommunity.discord.communityId, token, expiresAt: NOW + 600 });
    const invite = await h.call("/communities/invite", { body: { token } });
    assert.equal(invite.status, 200);
    assert.equal(invite.json.providers.find((row) => row.provider === "discord").membership.evidenceStrength, "invite_claimed");
    assert.equal((await h.call("/communities/credit", { body: { provider: "discord" } })).json.error, "invite_without_membership");
    assert.ok(!readFileSync(join(h.dir, "communities.json"), "utf8").includes(token));
    assert.equal(hashInviteToken(token).length, 64);
    h.communityStore.recordMembership(h.session.accountId, {
      provider: "discord",
      communityId: liveCommunity.discord.communityId,
      subject: "member-1",
      method: "oauth",
      evidenceStrength: "oauth_member",
      verifiedAt: NOW,
      memberSince: NOW - MIN_AGE - 10,
    });
    const credit = await h.call("/communities/credit", { body: { provider: "discord" } });
    assert.equal(credit.status, 200);
    assert.equal(credit.json.credited.award, 15);
    assert.equal((await h.call("/communities/credit", { body: { provider: "discord" } })).json.error, "already_credited");
    const after = (await h.call("/state", { method: "GET" })).json.me;
    assert.deepEqual(after, before);
  });
});
