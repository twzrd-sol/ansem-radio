import { HubApiError, type HubApi } from "./api";
import type { CommunityProvider } from "./community";
import { COMMUNITY_COPY } from "./community";

export function explainCommunityError(error: unknown): string {
  if (!(error instanceof HubApiError)) return error instanceof Error ? error.message : "Couldn't verify community membership. Try again.";
  switch (error.code) {
    case "sign_in_required": return COMMUNITY_COPY.signInFirst;
    case "community_credentials_required": return COMMUNITY_COPY.needsCredentials;
    case "oauth_not_wired": return COMMUNITY_COPY.oauthLater;
    case "community_invite_invalid": return "That invite is not valid.";
    case "invite_reused": return "That invite was already used.";
    case "subject_already_linked": return COMMUNITY_COPY.oneSubject;
    case "self_attested": return COMMUNITY_COPY.joinClick;
    case "engagement_farm": return COMMUNITY_COPY.noFarm;
    case "invite_without_membership": return COMMUNITY_COPY.inviteWeak;
    case "fresh_join": return COMMUNITY_COPY.freshJoin;
    case "churn": return COMMUNITY_COPY.churn;
    case "unverified": return "Membership is not verified.";
    case "weight_unpublished": return COMMUNITY_COPY.unpublished;
    case "not_joined_season": return "Join this season first. It is free.";
    case "already_credited": return COMMUNITY_COPY.credited;
    case "slow_down": return "Too fast. Try again in a minute.";
    default: return "Couldn't verify community membership. Try again.";
  }
}

export async function startCommunityLink(api: HubApi, provider: CommunityProvider, { navigate = (url: string) => window.location.assign(url), now = () => Math.floor(Date.now() / 1000) }: { navigate?: (url: string) => void; now?: () => number } = {}) {
  const me = await api.me();
  if (!me) throw new HubApiError(401, "sign_in_required");
  const start = await api.beginCommunityLink(provider);
  const url = new URL(start.url);
  const expected = provider === "discord"
    ? { origin: "https://discord.com", path: "/oauth2/authorize" }
    : { origin: "https://x.com", path: "/i/oauth2/authorize" };
  if (url.origin !== expected.origin || url.pathname !== expected.path || url.username || url.password || url.hash || url.searchParams.get("state") !== start.state || !Number.isSafeInteger(start.expiresAt) || start.expiresAt <= now() || start.expiresAt > now() + 600) {
    throw new Error("This community link expired. Start again from Communities.");
  }
  navigate(url.href);
}
