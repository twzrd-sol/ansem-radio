import type { CommunityCatalog, CommunityProvider } from "./community";

export function communityApi(call: <T>(method: "GET" | "POST", path: string, body?: unknown) => Promise<T>) {
  return {
    communities: () => call<CommunityCatalog>("GET", "/communities"),
    beginCommunityLink: (provider: CommunityProvider) => call<{ url: string; state: string; expiresAt: number }>("POST", `/communities/${provider}/start`, {}),
    redeemCommunityInvite: (token: string) => call<CommunityCatalog>("POST", "/communities/invite", { token }),
  };
}
