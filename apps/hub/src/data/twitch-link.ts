import { HubApiError, type HubApi } from "./api";

export const TWITCH_PENDING = "radiolan-hub:twitch-link:v1";
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface CallbackLocation { pathname: string; hash: string; search: string }
export interface TwitchCallbackData { state: string; idToken?: string; error?: "cancelled" | "invalid" }
const retry = () => new Error("This Twitch link expired or belongs to another account. Start again from Me.");

/** Capture in memory and immediately remove the credentials from the address bar before React mounts. */
export function captureTwitchCallback(location: CallbackLocation, history: Pick<History, "replaceState">): TwitchCallbackData | null {
  if (location.pathname !== "/hub/twitch") return null;
  const { hash, search } = location;
  history.replaceState(null, "", "/hub/twitch");
  if (hash.length + search.length > 16_384) return { state: "", error: "invalid" };
  const fragment = new URLSearchParams(hash.slice(1));
  const query = new URLSearchParams(search);
  const fields = fragment.has("id_token") ? fragment : query;
  const state = fields.get("state") ?? "";
  if (fields.getAll("state").length !== 1 || fields.getAll("id_token").length > 1 || fragment.has("access_token")) return { state: "", error: "invalid" };
  if (fields.has("error")) return { state, error: fields.get("error") === "access_denied" ? "cancelled" : "invalid" };
  const idToken = fragment.get("id_token");
  return idToken && idToken.length <= 8192 ? { state, idToken } : { state, error: "invalid" };
}

export async function startTwitchLink(api: HubApi, { storage = window.sessionStorage, navigate = (url: string) => window.location.assign(url), now = () => Math.floor(Date.now() / 1000) }: { storage?: StoragePort; navigate?: (url: string) => void; now?: () => number } = {}) {
  const me = await api.me();
  if (!me) throw new HubApiError(401, "sign_in_required");
  const start = await api.beginTwitchLink();
  const url = new URL(start.url);
  if (url.origin !== "https://id.twitch.tv" || url.pathname !== "/oauth2/authorize" || url.username || url.password || url.hash || url.searchParams.get("state") !== start.state || !Number.isSafeInteger(start.expiresAt) || start.expiresAt <= now() || start.expiresAt > now() + 600) throw retry();
  try { storage.setItem(TWITCH_PENDING, JSON.stringify({ state: start.state, accountId: me.accountId, expiresAt: start.expiresAt })); }
  catch { throw new Error("Twitch linking needs browser storage for this tab. Allow it and try again."); }
  navigate(url.href);
}

export async function completeTwitchCallback(api: HubApi, callback: TwitchCallbackData, { storage = window.sessionStorage, now = () => Math.floor(Date.now() / 1000) }: { storage?: StoragePort; now?: () => number } = {}) {
  const idToken = callback.idToken;
  delete callback.idToken;
  let pending: { state: string; accountId: string; expiresAt: number };
  try {
    const text = storage.getItem(TWITCH_PENDING);
    storage.removeItem(TWITCH_PENDING);
    pending = text ? JSON.parse(text) : null;
  } catch { throw retry(); }
  if (!pending || pending.state !== callback.state || !Number.isSafeInteger(pending.expiresAt) || pending.expiresAt <= now()) throw retry();
  if (callback.error === "cancelled") throw new Error("Twitch linking was cancelled. Nothing changed.");
  if (callback.error || !idToken) throw retry();
  const me = await api.me();
  if (!me || me.accountId !== pending.accountId) throw retry();
  return api.finishTwitchLink(callback.state, idToken);
}

export function explainIdentityError(error: unknown): string {
  if (!(error instanceof HubApiError)) return error instanceof Error ? error.message : "Couldn't link your account. Try again.";
  switch (error.code) {
    case "sign_in_required": return "Sign in with your passkey first.";
    case "twitch_unavailable": return "Twitch linking is not available yet.";
    case "twitch_identity_rejected": return "Twitch identity could not be verified. Start again from Me.";
    case "twitch_keys_unavailable": return "Twitch's verification service is unavailable. Try again later.";
    case "identity_challenge_expired": return "This link expired. Start again from Me.";
    case "wallet_proof_rejected": return "The wallet signature did not match this link. Try again.";
    case "twitch_already_linked_elsewhere": return "This Twitch identity is already linked to another hub account.";
    case "wallet_already_linked_elsewhere": return "This wallet is already linked to another hub account.";
    case "twitch_unlink_first": return "Unlink your current Twitch identity before linking another.";
    case "wallet_unlink_first": return "Unlink your current wallet before linking another.";
    case "slow_down": return "Too fast. Try again in a minute.";
    default: return "Couldn't link your account. Try again.";
  }
}
