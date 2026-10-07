import { describe, expect, it, vi } from "vitest";
import { HubApiError } from "./api";
import {
  COMMUNITY_COPY,
  DEFAULT_MIN_MEMBERSHIP_SECONDS,
  evaluateCommunity,
  gatedCommunityCatalog,
  sampleCommunityCatalog,
} from "./community";
import { explainCommunityError, startCommunityLink } from "./community-link";

const NOW = 1_791_025_000;
const account = "a".repeat(64);
const season = { open: true, startsAt: NOW - 86_400, number: "2" };
const policy = { weight: 15, minMembershipSeconds: DEFAULT_MIN_MEMBERSHIP_SECONDS, dailyCap: 60, weeklyCap: 300 };
const oauthProof = {
  provider: "discord" as const,
  communityId: "123456789012345678",
  subject: "member-1",
  method: "oauth" as const,
  oauthMember: true,
  memberSince: NOW - DEFAULT_MIN_MEMBERSHIP_SECONDS - 1,
};

describe("community membership eligibility", () => {
  it("refuses wash, farms, and fake joins before any points award", () => {
    expect(evaluateCommunity({ proof: { ...oauthProof, likes: 4 }, accountId: account, season, joinedSeason: true, policy, now: NOW }).eligibility.reason).toBe("engagement_farm");
    expect(evaluateCommunity({ proof: { ...oauthProof, method: "self_attested" }, accountId: account, season, joinedSeason: true, policy, now: NOW }).eligibility.reason).toBe("self_attested");
    expect(evaluateCommunity({ proof: { provider: "discord", communityId: "123", method: "invite", subject: "member-1" }, accountId: account, season, joinedSeason: true, policy, now: NOW }).eligibility.reason).toBe("invite_without_membership");
    expect(evaluateCommunity({ proof: { ...oauthProof, inviteReused: true }, accountId: account, season, joinedSeason: true, policy, now: NOW }).eligibility.reason).toBe("invite_reused");
    expect(evaluateCommunity({ proof: oauthProof, accountId: account, existing: { subjectAccountId: "b".repeat(64) }, season, joinedSeason: true, policy, now: NOW }).eligibility.reason).toBe("subject_already_linked");
    expect(evaluateCommunity({ proof: { ...oauthProof, memberSince: NOW - 60 }, accountId: account, season, joinedSeason: true, policy, now: NOW }).eligibility.reason).toBe("fresh_join");
    expect(evaluateCommunity({
      proof: oauthProof, accountId: account, season, joinedSeason: true, policy, now: NOW,
      existing: { churnEvents: [{ kind: "join", at: NOW - 10_000 }, { kind: "leave", at: NOW - 5_000 }, { kind: "join", at: NOW - 100 }] },
    }).eligibility.reason).toBe("churn");
  });

  it("attributes a verified member and awards one published credit under caps", () => {
    const ready = evaluateCommunity({ proof: oauthProof, accountId: account, season, joinedSeason: true, policy, standing: { today: 10, points: 40 }, now: NOW });
    expect(ready.membership?.evidenceStrength).toBe("oauth_member");
    expect(ready.eligibility).toEqual({ eligible: true, reason: "ready" });
    expect(ready.award).toBe(15);
    const capped = evaluateCommunity({ proof: oauthProof, accountId: account, season, joinedSeason: true, policy, standing: { today: 60, points: 40 }, now: NOW });
    expect(capped.eligibility.reason).toBe("caps_reached");
    expect(capped.award).toBe(0);
    expect(evaluateCommunity({ proof: oauthProof, accountId: account, season: { ...season, open: false }, joinedSeason: true, policy, now: NOW }).eligibility.reason).toBe("season_closed");
    expect(evaluateCommunity({ proof: oauthProof, accountId: account, season, joinedSeason: false, policy, now: NOW }).eligibility.reason).toBe("not_joined_season");
    expect(evaluateCommunity({ proof: oauthProof, accountId: account, season, joinedSeason: true, policy: { ...policy, weight: 0 }, now: NOW }).eligibility.reason).toBe("weight_unpublished");
    expect(evaluateCommunity({ proof: oauthProof, accountId: account, existing: { credited: true }, season, joinedSeason: true, policy, now: NOW }).eligibility.reason).toBe("already_credited");
  });

  it("keeps the live catalog gated and the sample catalog marked fictional", () => {
    const live = gatedCommunityCatalog();
    expect(live.sample).toBe(false);
    expect(live.oauthWired).toBe(false);
    expect(live.policy.weight).toBe(0);
    expect(live.providers.every((row) => row.credentials === false && row.eligibility.reason === "needs_credentials")).toBe(true);
    const preview = sampleCommunityCatalog();
    expect(preview.sample).toBe(true);
    expect(preview.providers[0]?.membership?.displayName).toBe("sample_lan");
    expect(preview.providers[0]?.award).toBe(15);
    expect(preview.providers[1]?.eligibility.reason).toBe("needs_credentials");
  });

  it("explains refusals without promising tokens, and only navigates to fixed authorize hosts", async () => {
    expect(explainCommunityError(new HubApiError(409, "community_credentials_required"))).toBe(COMMUNITY_COPY.needsCredentials);
    expect(explainCommunityError(new HubApiError(409, "oauth_not_wired"))).toBe(COMMUNITY_COPY.oauthLater);
    expect(COMMUNITY_COPY.notTokens).toContain("not tokens");
    const navigate = vi.fn();
    const api = {
      me: async () => ({ accountId: account, csrf: "csrf" }),
      beginCommunityLink: async () => ({ url: "https://evil.example/oauth2/authorize?state=pending", state: "pending", expiresAt: NOW + 300 }),
    };
    await expect(startCommunityLink(api as never, "discord", { navigate, now: () => NOW })).rejects.toThrow(/expired/);
    expect(navigate).not.toHaveBeenCalled();
    const good = {
      me: async () => ({ accountId: account, csrf: "csrf" }),
      beginCommunityLink: async () => ({ url: "https://discord.com/oauth2/authorize?state=pending&client_id=app", state: "pending", expiresAt: NOW + 300 }),
    };
    await startCommunityLink(good as never, "discord", { navigate, now: () => NOW });
    expect(navigate).toHaveBeenCalledWith("https://discord.com/oauth2/authorize?state=pending&client_id=app");
  });
});
