export interface LinkedIdentities {
  twitchEnabled: boolean;
  twitch: { subject: string; displayName: string; verifiedAt: number } | null;
  wallet: { address: string; verifiedAt: number } | null;
}
/** One listing the signed-in streamer holds and whether it is ready to be backed (a wallet linked, a mint to use). */
export interface MyClaim { slug: string; wallet: string | null; /** The pair fixed once the arena was asked for; it no longer follows the linked wallet. */ pinned?: { streamer: string; mint: string } | null; ready: boolean; reason: string | null }
export interface WalletLinkReview { challenge: string; address: string; message: string; expiresAt: number }
export type IdentityCall = <T>(method: "GET" | "POST", path: string, body?: unknown) => Promise<T>;
export function identityApi(call: IdentityCall) {
  return {
    identity: () => call<LinkedIdentities>("GET", "/identity"),
    beginTwitchLink: () => call<{ url: string; state: string; expiresAt: number }>("POST", "/identity/twitch/start", {}),
    finishTwitchLink: (state: string, idToken: string) => call<LinkedIdentities>("POST", "/identity/twitch/finish", { state, idToken }),
    unlinkTwitch: () => call<LinkedIdentities>("POST", "/identity/twitch/unlink", {}),
    beginWalletLink: (address: string) => call<WalletLinkReview>("POST", "/identity/wallet/start", { address }),
    finishWalletLink: (challenge: string, signature: Uint8Array) => call<LinkedIdentities>("POST", "/identity/wallet/finish", { challenge, signature: btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") }),
    myClaims: () => call<{ claims: MyClaim[]; generatedAt: number }>("GET", "/claims/mine"),
    claimSetup: (slug: string) => call<{ slug: string; streamer: string; mint: string }>("POST", "/claims/setup", { slug }),
    claimListing: (slug: string) => call<{ slug: string; claimed: boolean; claimedAt: number }>("POST", "/claims", { slug }),
    releaseListing: (slug: string) => call<{ slug: string; claimed: boolean }>("POST", "/claims/release", { slug }),
    unlinkWallet: () => call<LinkedIdentities>("POST", "/identity/wallet/unlink", {}),
  };
}
