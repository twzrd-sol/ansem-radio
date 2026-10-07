export const COMMUNITY_PROVIDERS = ["discord", "x"] as const;
export type CommunityProvider = (typeof COMMUNITY_PROVIDERS)[number];
export type CommunityMethod = "oauth" | "invite" | "self_attested";
export type CommunityEvidence = "oauth_member" | "invite_claimed";
export type CommunityRefuseReason =
  | "needs_credentials"
  | "self_attested"
  | "engagement_farm"
  | "invite_without_membership"
  | "invite_reused"
  | "subject_already_linked"
  | "fresh_join"
  | "churn"
  | "unverified"
  | "season_closed"
  | "weight_unpublished"
  | "not_joined_season"
  | "caps_reached"
  | "already_credited"
  | "oauth_not_wired"
  | "ready";

export const DEFAULT_MIN_MEMBERSHIP_SECONDS = 72 * 60 * 60;
export const FARM_FIELDS = ["likes", "follows", "messages", "viewers", "minutes", "retweets"] as const;

export interface CommunityPointsPolicy {
  weight: number;
  minMembershipSeconds: number;
}

export interface CommunityMembership {
  provider: CommunityProvider;
  communityId: string;
  subject: string;
  displayName?: string;
  method: CommunityMethod;
  evidenceStrength: CommunityEvidence;
  verifiedAt: number;
  memberSince?: number;
}

export interface CommunityEligibility {
  eligible: boolean;
  reason: CommunityRefuseReason;
}

export interface CommunityProviderCard {
  provider: CommunityProvider;
  label: string;
  credentials: boolean;
  communityId: string | null;
  membership: CommunityMembership | null;
  eligibility: CommunityEligibility;
  award: number;
}

export interface CommunityCatalog {
  sample: boolean;
  oauthWired: boolean;
  policy: CommunityPointsPolicy;
  providers: CommunityProviderCard[];
}

export interface CommunityProof {
  provider: CommunityProvider;
  communityId: string;
  subject?: string;
  displayName?: string;
  method?: CommunityMethod;
  oauthMember?: boolean;
  memberSince?: number;
  inviteReused?: boolean;
  likes?: number;
  follows?: number;
  messages?: number;
  viewers?: number;
  minutes?: number;
  retweets?: number;
}

export const COMMUNITY_COPY = {
  title: "Communities",
  lede: "Real community membership can unlock season-points eligibility. Fake joins are refused.",
  needsCredentials: "Needs credentials",
  notLive: "Not a live connection",
  sampleNote: "Fictional membership for preview.",
  joinClick: "A join click is not membership.",
  noFarm: "Likes, posts, and chat volume never count.",
  oneSubject: "One provider identity belongs to one hub account.",
  freshJoin: "Fresh joins wait for the published membership age.",
  churn: "Repeat join churn is refused.",
  inviteWeak: "An invite note is not verified membership.",
  notTokens: "Season points are not tokens.",
  unpublished: "Season policy has not published a community membership credit.",
  verify: "Verify membership",
  eligibility: "Points eligibility",
  notEligible: "Not eligible",
  eligible: "Eligible under season policy",
  credited: "Already credited this season",
  oauthLater: "OAuth membership checks are not wired on this hub yet.",
  policyLabel: "Season policy",
  publishedCredit: "Published credit",
  membershipAge: "Membership age",
  refused: "Refused",
  discord: "Discord",
  x: "X",
  notIc: "This credit is not $ICELAN and not $RLAN.",
  underCaps: "once, under the daily and season caps",
  inviteDisabled: "Invite redeem needs a published community and credentials.",
  signInFirst: "Sign in with a passkey to connect a community.",
} as const;

export function communityReasonCopy(reason: CommunityRefuseReason): string {
  switch (reason) {
    case "needs_credentials": return COMMUNITY_COPY.needsCredentials;
    case "self_attested": return COMMUNITY_COPY.joinClick;
    case "engagement_farm": return COMMUNITY_COPY.noFarm;
    case "invite_without_membership": return COMMUNITY_COPY.inviteWeak;
    case "invite_reused": return "That invite was already used.";
    case "subject_already_linked": return COMMUNITY_COPY.oneSubject;
    case "fresh_join": return COMMUNITY_COPY.freshJoin;
    case "churn": return COMMUNITY_COPY.churn;
    case "unverified": return "Membership is not verified.";
    case "season_closed": return "This season is not open.";
    case "weight_unpublished": return COMMUNITY_COPY.unpublished;
    case "not_joined_season": return "Join this season first. It is free.";
    case "caps_reached": return "Your daily or season points cap is reached.";
    case "already_credited": return COMMUNITY_COPY.credited;
    case "oauth_not_wired": return COMMUNITY_COPY.oauthLater;
    case "ready": return COMMUNITY_COPY.eligible;
  }
}

const SUBJECT = /^[A-Za-z0-9_-]{1,64}$/;

export function hasCommunityChurn(events: Array<{ kind: string; at: number }> | undefined, seasonStartsAt: number, now: number): boolean {
  const rows = (events ?? []).filter((e) => e.at >= seasonStartsAt && e.at <= now).sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));
  if (rows.filter((e) => e.kind === "join").length > 1) return true;
  let joined = false;
  for (const e of rows) {
    if (e.kind === "leave" && joined) return true;
    joined = e.kind === "join";
  }
  return false;
}

function refused(reason: CommunityRefuseReason): { membership: CommunityMembership | null; eligibility: CommunityEligibility; award: number } {
  return { membership: null, eligibility: { eligible: false, reason }, award: 0 };
}

export function evaluateCommunity({
  proof,
  accountId,
  existing = {},
  season,
  joinedSeason = false,
  policy,
  standing = { today: 0, points: 0 },
  now,
}: {
  proof: CommunityProof;
  accountId: string;
  existing?: { subjectAccountId?: string | null; churnEvents?: Array<{ kind: string; at: number }>; credited?: boolean };
  season?: { open?: boolean; startsAt?: number; number?: string | number } | null;
  joinedSeason?: boolean;
  policy?: CommunityPointsPolicy & { dailyCap?: number; weeklyCap?: number };
  standing?: { today: number; points: number };
  now: number;
}): { membership: CommunityMembership | null; eligibility: CommunityEligibility; award: number } {
  if (!COMMUNITY_PROVIDERS.includes(proof.provider) || !SUBJECT.test(String(proof.communityId ?? ""))) return refused("unverified");
  if (FARM_FIELDS.some((field) => proof[field] != null)) return refused("engagement_farm");
  if (proof.method === "self_attested" || proof.method == null) return refused("self_attested");
  if (typeof proof.subject !== "string" || !SUBJECT.test(proof.subject)) return refused("self_attested");
  if (proof.inviteReused) return refused("invite_reused");
  if (existing.subjectAccountId && existing.subjectAccountId !== accountId) return refused("subject_already_linked");
  if (hasCommunityChurn(existing.churnEvents, season?.startsAt ?? 0, now)) return refused("churn");

  if (proof.method === "invite" && proof.oauthMember !== true) {
    const membership: CommunityMembership = {
      provider: proof.provider,
      communityId: proof.communityId,
      subject: proof.subject,
      method: "invite",
      evidenceStrength: "invite_claimed",
      verifiedAt: now,
    };
    return { membership, eligibility: { eligible: false, reason: "invite_without_membership" }, award: 0 };
  }

  if (proof.method !== "oauth" || proof.oauthMember !== true) return refused("unverified");
  const minAge = policy?.minMembershipSeconds ?? DEFAULT_MIN_MEMBERSHIP_SECONDS;
  if (!Number.isSafeInteger(proof.memberSince) || now - proof.memberSince! < minAge) return refused("fresh_join");

  const membership: CommunityMembership = {
    provider: proof.provider,
    communityId: proof.communityId,
    subject: proof.subject,
    method: "oauth",
    evidenceStrength: "oauth_member",
    verifiedAt: now,
    memberSince: proof.memberSince,
    ...(proof.displayName && proof.displayName.length <= 32 ? { displayName: proof.displayName } : {}),
  };

  if (!season?.open) return { membership, eligibility: { eligible: false, reason: "season_closed" }, award: 0 };
  if (!joinedSeason) return { membership, eligibility: { eligible: false, reason: "not_joined_season" }, award: 0 };
  const weight = policy?.weight;
  if (!Number.isInteger(weight) || (weight ?? 0) <= 0) return { membership, eligibility: { eligible: false, reason: "weight_unpublished" }, award: 0 };
  if (existing.credited) return { membership, eligibility: { eligible: false, reason: "already_credited" }, award: 0 };
  const dailyCap = policy?.dailyCap;
  const weeklyCap = policy?.weeklyCap;
  if (!Number.isInteger(dailyCap) || !Number.isInteger(weeklyCap) || (dailyCap ?? 0) < 0 || (weeklyCap ?? 0) < 0) {
    return { membership, eligibility: { eligible: false, reason: "caps_reached" }, award: 0 };
  }
  const award = Math.max(0, Math.min(weight!, dailyCap! - standing.today, weeklyCap! - standing.points));
  if (award <= 0) return { membership, eligibility: { eligible: false, reason: "caps_reached" }, award: 0 };
  return { membership, eligibility: { eligible: true, reason: "ready" }, award };
}

export function gatedCommunityCatalog(policy: CommunityPointsPolicy = { weight: 0, minMembershipSeconds: DEFAULT_MIN_MEMBERSHIP_SECONDS }): CommunityCatalog {
  return {
    sample: false,
    oauthWired: false,
    policy,
    providers: COMMUNITY_PROVIDERS.map((provider) => ({
      provider,
      label: provider === "discord" ? COMMUNITY_COPY.discord : COMMUNITY_COPY.x,
      credentials: false,
      communityId: null,
      membership: null,
      eligibility: { eligible: false, reason: "needs_credentials" },
      award: 0,
    })),
  };
}

export function sampleCommunityCatalog(now = Date.parse("2026-10-02T13:00:00Z")): CommunityCatalog {
  return {
    sample: true,
    oauthWired: false,
    policy: { weight: 15, minMembershipSeconds: DEFAULT_MIN_MEMBERSHIP_SECONDS },
    providers: [
      {
        provider: "discord",
        label: COMMUNITY_COPY.discord,
        credentials: false,
        communityId: null,
        membership: {
          provider: "discord",
          communityId: "sample-discord",
          subject: "sample-subject",
          displayName: "sample_lan",
          method: "oauth",
          evidenceStrength: "oauth_member",
          verifiedAt: now - 86_400_000,
          memberSince: now - 10 * 86_400_000,
        },
        eligibility: { eligible: true, reason: "ready" },
        award: 15,
      },
      {
        provider: "x",
        label: COMMUNITY_COPY.x,
        credentials: false,
        communityId: null,
        membership: null,
        eligibility: { eligible: false, reason: "needs_credentials" },
        award: 0,
      },
    ],
  };
}

export function hoursForMembership(seconds: number): number {
  return Math.round(seconds / 3600);
}
