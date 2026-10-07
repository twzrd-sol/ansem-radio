// SPDX-License-Identifier: MIT
// Gated X / Discord community routes. Start can issue a real authorize URL when
// credentials exist. Finish is not wired: membership is never invented from a callback.
import { createHash, randomBytes } from "node:crypto";
import { HttpError, readJson } from "../platform/guard.js";
import {
  COMMUNITY_PROVIDERS,
  COMMUNITY_REDIRECT,
  COMMUNITY_REFUSE,
  buildAuthorizeUrl,
  communityCatalog,
  communityConfig,
  evaluateCommunity,
} from "./community.js";
import { createCommunityStore } from "./community-store.js";

const TTL = 300;
const random = () => randomBytes(32).toString("base64url");

function challengeDigest() {
  return createHash("sha256").update(randomBytes(32)).digest("base64url");
}

export function createCommunityRoutes({
  origins,
  requireOrigin,
  requireSession,
  sessionOf,
  authLimit,
  now,
  community = communityConfig(),
  store = null,
  hubDir,
  season,
  standingOf,
}) {
  const communityStore = store ?? createCommunityStore({ dir: hubDir });
  const challenges = new Map();
  for (const provider of COMMUNITY_PROVIDERS) {
    const creds = community[provider];
    if (!creds?.enabled) continue;
    const redirect = new URL(creds.redirectUri);
    if (!origins.includes(redirect.origin) || redirect.pathname !== COMMUNITY_REDIRECT[provider] || redirect.search || redirect.hash || redirect.username || redirect.password) {
      throw new TypeError(`hub ${provider} redirect must be ${COMMUNITY_REDIRECT[provider]} on an allowed origin`);
    }
  }
  const writeSession = (request, key) => {
    requireOrigin(request);
    const session = requireSession(request, { csrf: true });
    if (!authLimit(key)) throw new HttpError(429, "slow_down");
    return session;
  };
  const snapshot = (accountId) => communityCatalog({
    config: community,
    memberships: accountId ? communityStore.membershipsOf(accountId) : [],
    sample: false,
    oauthWired: false,
  });
  const issue = (session, provider, record) => {
    for (const [key, row] of challenges) if (row.expiresAt <= now()) challenges.delete(key);
    const key = `${session.id}:${provider}`;
    if (challenges.size >= 4096 && !challenges.has(key)) throw new HttpError(429, "slow_down");
    const challenge = random();
    challenges.set(key, { ...record, challenge, expiresAt: now() + TTL });
    return challenge;
  };
  const routes = {
    "GET /hub/api/communities": (request) => snapshot(sessionOf(request)?.accountId ?? null),
  };
  for (const provider of COMMUNITY_PROVIDERS) {
    routes[`POST /hub/api/communities/${provider}/start`] = async (request, key) => {
      const session = writeSession(request, key);
      await readJson(request, 64);
      const creds = community[provider];
      if (!creds?.enabled) throw new HttpError(409, "community_credentials_required");
      if (new URL(creds.redirectUri).origin !== request.headers.origin) throw new HttpError(409, "community_credentials_required");
      const codeChallenge = provider === "x" ? challengeDigest() : undefined;
      const state = issue(session, provider, { origin: request.headers.origin, codeChallenge });
      return {
        url: buildAuthorizeUrl(provider, { clientId: creds.clientId, redirectUri: creds.redirectUri, state, codeChallenge }),
        state,
        expiresAt: now() + TTL,
      };
    };
    routes[`POST /hub/api/communities/${provider}/finish`] = async (request, key) => {
      writeSession(request, key);
      await readJson(request, 4096);
      const creds = community[provider];
      if (!creds?.enabled) throw new HttpError(409, "community_credentials_required");
      throw new HttpError(409, COMMUNITY_REFUSE.oauth_not_wired);
    };
  }
  routes["POST /hub/api/communities/invite"] = async (request, key) => {
    const session = writeSession(request, key);
    const body = await readJson(request, 1024);
    if (Object.keys(body).some((field) => field !== "token")) throw new HttpError(400, "unknown_field");
    if (!community.discord.enabled && !community.x.enabled) throw new HttpError(409, "community_credentials_required");
    if (typeof body.token !== "string" || body.token.length < 32 || body.token.length > 256) throw new HttpError(400, "community_invite_invalid");
    const redeemed = communityStore.redeemInvite({ token: body.token, accountId: session.accountId, now: now() });
    const provider = community.discord.enabled && community.discord.communityId === redeemed.communityId
      ? "discord"
      : community.x.enabled && community.x.communityId === redeemed.communityId
        ? "x"
        : null;
    if (!provider) throw new HttpError(400, "community_invite_invalid");
    const decision = evaluateCommunity({
      proof: { provider, communityId: redeemed.communityId, subject: `invite-${session.accountId.slice(0, 12)}`, method: "invite", oauthMember: false },
      accountId: session.accountId,
      existing: { subjectAccountId: communityStore.subjectOwner(provider, `invite-${session.accountId.slice(0, 12)}`) },
      season: season(),
      joinedSeason: Boolean(standingOf(session.accountId).joined),
      policy: { ...community.policy, dailyCap: season()?.policy?.dailyCap, weeklyCap: season()?.policy?.weeklyCap },
      standing: { today: Number(standingOf(session.accountId).today), points: Number(standingOf(session.accountId).points) },
      now: now(),
    });
    if (decision.membership) communityStore.recordMembership(session.accountId, decision.membership);
    return snapshot(session.accountId);
  };
  routes["POST /hub/api/communities/credit"] = async (request, key) => {
    const session = writeSession(request, key);
    const body = await readJson(request, 1024);
    if (Object.keys(body).some((field) => field !== "provider")) throw new HttpError(400, "unknown_field");
    if (!COMMUNITY_PROVIDERS.includes(body.provider)) throw new HttpError(400, "unknown_field");
    const creds = community[body.provider];
    if (!creds?.enabled) throw new HttpError(409, "community_credentials_required");
    const current = season();
    if (!current) throw new HttpError(409, "no_season");
    const membership = communityStore.membershipsOf(session.accountId).find((row) => row.provider === body.provider);
    if (!membership) throw new HttpError(409, COMMUNITY_REFUSE.unverified);
    const mine = standingOf(session.accountId);
    const decision = evaluateCommunity({
      proof: {
        provider: membership.provider,
        communityId: membership.communityId,
        subject: membership.subject,
        method: membership.method,
        oauthMember: membership.evidenceStrength === "oauth_member",
        memberSince: membership.memberSince,
        displayName: membership.displayName,
      },
      accountId: session.accountId,
      existing: {
        subjectAccountId: communityStore.subjectOwner(membership.provider, membership.subject),
        churnEvents: communityStore.churnOf(membership.provider, membership.subject, membership.communityId),
        credited: Boolean(communityStore.creditOf(current.season, session.accountId, membership.communityId)),
      },
      season: { open: now() >= current.startsAt && now() < current.endsAt, startsAt: current.startsAt, number: current.season },
      joinedSeason: Boolean(mine.joined),
      policy: { ...community.policy, dailyCap: current.policy.dailyCap, weeklyCap: current.policy.weeklyCap },
      standing: { today: Number(mine.today), points: Number(mine.points) },
      now: now(),
    });
    if (!decision.eligibility.eligible || decision.award <= 0) throw new HttpError(409, decision.eligibility.reason);
    communityStore.recordCredit({
      season: current.season,
      accountId: session.accountId,
      communityId: membership.communityId,
      award: decision.award,
      at: now(),
    });
    return { ...snapshot(session.accountId), credited: { award: decision.award, reason: "credited" } };
  };
  return routes;
}
