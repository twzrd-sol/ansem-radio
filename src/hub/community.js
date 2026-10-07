/**
 * Community membership → season-points eligibility.
 * Provider-neutral contract: a verified member may become eligible for one published
 * season-policy credit. Native settlement actions stay question / poll_response /
 * accepted_work. This credit is not $ICELAN, not $RLAN, and not an engagement farm.
 */
import { createHash } from "node:crypto";

export const COMMUNITY_PROVIDERS = Object.freeze(["discord", "x"]);
export const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
export const X_AUTHORIZE = "https://x.com/i/oauth2/authorize";
export const DEFAULT_MIN_MEMBERSHIP_SECONDS = 72 * 60 * 60;
export const COMMUNITY_REDIRECT = Object.freeze({ discord: "/hub/discord", x: "/hub/x" });
export const FARM_FIELDS = Object.freeze(["likes", "follows", "messages", "viewers", "minutes", "retweets"]);

export const COMMUNITY_REFUSE = Object.freeze({
  needs_credentials: "needs_credentials",
  self_attested: "self_attested",
  engagement_farm: "engagement_farm",
  invite_without_membership: "invite_without_membership",
  invite_reused: "invite_reused",
  subject_already_linked: "subject_already_linked",
  fresh_join: "fresh_join",
  churn: "churn",
  unverified: "unverified",
  season_closed: "season_closed",
  weight_unpublished: "weight_unpublished",
  not_joined_season: "not_joined_season",
  caps_reached: "caps_reached",
  already_credited: "already_credited",
  oauth_not_wired: "oauth_not_wired",
});

const SUBJECT = /^[A-Za-z0-9_-]{1,64}$/;

export function hashInviteToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function readProvider(env, name) {
  const clientId = String(env[`RADIOLAN_HUB_${name}_CLIENT_ID`] ?? "").trim();
  const redirectUri = String(env[`RADIOLAN_HUB_${name}_REDIRECT_URI`] ?? "").trim();
  const communityId = String(env[`RADIOLAN_HUB_${name}_COMMUNITY_ID`] ?? "").trim();
  if (!clientId && !redirectUri && !communityId) return { enabled: false };
  if (!clientId || !redirectUri || !communityId) {
    throw new TypeError(`hub ${name} community needs client id, redirect URI, and community id`);
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(clientId) || !SUBJECT.test(communityId)) {
    throw new TypeError(`hub ${name} community ids are malformed`);
  }
  return { enabled: true, clientId, redirectUri, communityId };
}

function readPolicy(env) {
  const weight = Number(env.RADIOLAN_HUB_COMMUNITY_WEIGHT ?? 0);
  const minMembershipSeconds = Number(env.RADIOLAN_HUB_COMMUNITY_MIN_AGE ?? DEFAULT_MIN_MEMBERSHIP_SECONDS);
  return {
    weight: Number.isInteger(weight) && weight >= 0 ? weight : 0,
    minMembershipSeconds: Number.isInteger(minMembershipSeconds) && minMembershipSeconds >= 0
      ? minMembershipSeconds
      : DEFAULT_MIN_MEMBERSHIP_SECONDS,
  };
}

/** Missing provider vars stay gated. A partial set fails closed so a half-wired app is not treated as live. */
export function communityConfig(env = process.env) {
  return {
    discord: readProvider(env, "DISCORD"),
    x: readProvider(env, "X"),
    policy: readPolicy(env),
  };
}

export function buildAuthorizeUrl(provider, { clientId, redirectUri, state, codeChallenge }) {
  if (provider === "discord") {
    const url = new URL(DISCORD_AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds",
      state,
    }).toString();
    if (url.origin !== "https://discord.com" || url.pathname !== "/oauth2/authorize") throw new TypeError("discord authorize url refused");
    return url.href;
  }
  if (provider === "x") {
    if (typeof codeChallenge !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) throw new TypeError("x code challenge required");
    const url = new URL(X_AUTHORIZE);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "users.read tweet.read",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    if (url.origin !== "https://x.com" || url.pathname !== "/i/oauth2/authorize") throw new TypeError("x authorize url refused");
    return url.href;
  }
  throw new TypeError("unknown community provider");
}

export function hasCommunityChurn(events, seasonStartsAt, now) {
  const rows = (events ?? []).filter((e) => e.at >= seasonStartsAt && e.at <= now).sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));
  if (rows.filter((e) => e.kind === "join").length > 1) return true;
  let joined = false;
  for (const e of rows) {
    if (e.kind === "leave" && joined) return true;
    joined = e.kind === "join";
  }
  return false;
}

function farmSignal(proof) {
  return FARM_FIELDS.some((field) => proof[field] != null);
}

function refused(reason) {
  return { membership: null, eligibility: { eligible: false, reason }, award: 0 };
}

function withMembership(membership, reason, award = 0) {
  return { membership, eligibility: { eligible: false, reason }, award };
}

/**
 * Decide attribution and a once-per-season points award from a membership proof.
 * Live HTTP still has to refuse missing credentials and unwired OAuth separately.
 */
export function evaluateCommunity({
  proof,
  accountId,
  existing = {},
  season,
  joinedSeason = false,
  policy,
  standing = { today: 0, points: 0 },
  now,
}) {
  if (!proof || !COMMUNITY_PROVIDERS.includes(proof.provider) || !SUBJECT.test(String(proof.communityId ?? ""))) {
    return refused(COMMUNITY_REFUSE.unverified);
  }
  if (farmSignal(proof)) return refused(COMMUNITY_REFUSE.engagement_farm);
  if (proof.method === "self_attested" || proof.method == null) return refused(COMMUNITY_REFUSE.self_attested);
  if (typeof proof.subject !== "string" || !SUBJECT.test(proof.subject)) return refused(COMMUNITY_REFUSE.self_attested);
  if (proof.inviteReused) return refused(COMMUNITY_REFUSE.invite_reused);
  if (existing.subjectAccountId && existing.subjectAccountId !== accountId) return refused(COMMUNITY_REFUSE.subject_already_linked);
  if (hasCommunityChurn(existing.churnEvents, season?.startsAt ?? 0, now)) return refused(COMMUNITY_REFUSE.churn);

  if (proof.method === "invite" && proof.oauthMember !== true) {
    const noted = {
      provider: proof.provider,
      communityId: proof.communityId,
      subject: proof.subject,
      method: "invite",
      evidenceStrength: "invite_claimed",
      verifiedAt: now,
    };
    return withMembership(noted, COMMUNITY_REFUSE.invite_without_membership);
  }

  if (proof.method !== "oauth" || proof.oauthMember !== true) return refused(COMMUNITY_REFUSE.unverified);
  const minAge = policy?.minMembershipSeconds ?? DEFAULT_MIN_MEMBERSHIP_SECONDS;
  if (!Number.isSafeInteger(proof.memberSince) || now - proof.memberSince < minAge) {
    return refused(COMMUNITY_REFUSE.fresh_join);
  }

  const membership = {
    provider: proof.provider,
    communityId: proof.communityId,
    subject: proof.subject,
    method: "oauth",
    evidenceStrength: "oauth_member",
    verifiedAt: now,
    memberSince: proof.memberSince,
    ...(typeof proof.displayName === "string" && proof.displayName.length <= 32 ? { displayName: proof.displayName } : {}),
  };

  if (!season?.open) return withMembership(membership, COMMUNITY_REFUSE.season_closed);
  if (!joinedSeason) return withMembership(membership, COMMUNITY_REFUSE.not_joined_season);
  const weight = policy?.weight;
  if (!Number.isInteger(weight) || weight <= 0) return withMembership(membership, COMMUNITY_REFUSE.weight_unpublished);
  if (existing.credited) return withMembership(membership, COMMUNITY_REFUSE.already_credited, 0);
  const today = Number(standing.today ?? 0);
  const points = Number(standing.points ?? 0);
  const dailyCap = policy.dailyCap;
  const weeklyCap = policy.weeklyCap;
  if (!Number.isInteger(dailyCap) || !Number.isInteger(weeklyCap) || dailyCap < 0 || weeklyCap < 0) {
    return withMembership(membership, COMMUNITY_REFUSE.caps_reached);
  }
  const award = Math.max(0, Math.min(weight, dailyCap - today, weeklyCap - points));
  if (award <= 0) return withMembership(membership, COMMUNITY_REFUSE.caps_reached);
  return { membership, eligibility: { eligible: true, reason: "ready" }, award };
}

export function communityCatalog({ config, memberships = [], sample = false, oauthWired = false }) {
  return {
    sample,
    oauthWired,
    policy: { weight: config.policy.weight, minMembershipSeconds: config.policy.minMembershipSeconds },
    providers: COMMUNITY_PROVIDERS.map((provider) => {
      const creds = config[provider];
      const membership = memberships.find((row) => row.provider === provider) ?? null;
      return {
        provider,
        label: provider === "discord" ? "Discord" : "X",
        credentials: Boolean(creds?.enabled),
        communityId: creds?.enabled ? creds.communityId : null,
        membership,
        eligibility: membership
          ? { eligible: membership.evidenceStrength === "oauth_member" && config.policy.weight > 0, reason: membership.evidenceStrength === "oauth_member" ? (config.policy.weight > 0 ? "ready" : "weight_unpublished") : "invite_without_membership" }
          : { eligible: false, reason: creds?.enabled ? (oauthWired ? "unverified" : "oauth_not_wired") : "needs_credentials" },
        award: 0,
      };
    }),
  };
}
