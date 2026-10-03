export interface LinkedIdentities {
  twitchEnabled: boolean;
  twitch: { subject: string; displayName: string; verifiedAt: number } | null;
  wallet: { address: string; verifiedAt: number } | null;
}
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
    unlinkWallet: () => call<LinkedIdentities>("POST", "/identity/wallet/unlink", {}),
  };
}
