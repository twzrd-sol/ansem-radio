// The hub API client (plan sections 3 and 12): same-origin /hub/api, the session in an HttpOnly cookie the page
// never reads, the CSRF token in memory, and passkeys through navigator.credentials. No key of a fan is ever
// held here; a passkey lives in the fan's authenticator.
import type { Action } from "./types";
import { identityApi } from "./identity-api";

export const API_BASE = "/hub/api";
export const CSRF_HEADER = "x-hub-csrf";

export interface ApiPolicy {
  dailyCap: number;
  weeklyCap: number;
  weights: Record<Action, number>;
}
export interface ApiSeason {
  number: string;
  arena: string;
  network: string;
  startsAt: number;
  endsAt: number;
  open: boolean;
  policy: ApiPolicy;
  players: number;
  credited: number;
  poll?: { id: string; question: string; options: string[]; placeholder: boolean } | null;
  board?: Array<[string, string]>;
}
export type BadgeId = "first_play" | "three_days";
export interface ApiSubmission {
  id: string;
  action: Action;
  status: "credited" | "pending";
  occurredAt: number;
  pollId?: string;
}
export interface ApiMe {
  accountId: string;
  createdAt?: number;
  joined: boolean;
  points: string;
  today: string;
  rank?: number | null;
  badges?: Array<{ id: BadgeId; earnedAt: number }>;
  pending: number;
  submissions: ApiSubmission[];
}
export interface ApiState {
  season: ApiSeason | null;
  me: ApiMe | null;
  generatedAt: number;
}
export type ActivityInput = { action: "question" | "accepted_work"; text: string } | { action: "poll_response"; pollId: string; choice: number };

export class HubApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, detail?: string) {
    super(detail ?? code);
    this.name = "HubApiError";
  }
}

/** What the page says for an API refusal, in the hub's words. */
export function explainApiError(error: unknown): string {
  if (!(error instanceof HubApiError)) return error instanceof Error && error.name === "NotAllowedError" ? "The passkey prompt was closed. Nothing changed." : "Couldn't reach the hub. Nothing changed.";
  switch (error.code) {
    case "sign_in_required": return "Sign in first.";
    case "no_season": return "No season is open yet.";
    case "season_not_open": return "This season isn't open right now.";
    case "join_first": return "Join the season first. It's free.";
    case "already_submitted": return "You already sent that one.";
    case "poll_not_creditable": return "That placeholder poll is for preview; it doesn't earn points.";
    case "slow_down": return "Too fast. Try again in a minute.";
    case "credential_already_registered": return "This passkey already has an account. Sign in instead.";
    case "unknown_credential": return "No account for that passkey here. Create one instead.";
    default: return `The hub refused it (${error.code}).`;
  }
}

const b64u = {
  toBytes: (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=")), (c) => c.charCodeAt(0)),
  fromBytes: (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
};

export interface Passkeys {
  create(options: PublicKeyCredentialCreationOptions): Promise<PublicKeyCredential>;
  get(options: PublicKeyCredentialRequestOptions): Promise<PublicKeyCredential>;
}
const browserPasskeys = (): Passkeys => ({
  create: async (publicKey) => (await navigator.credentials.create({ publicKey })) as PublicKeyCredential,
  get: async (publicKey) => (await navigator.credentials.get({ publicKey })) as PublicKeyCredential,
});

export function createHubApi({ fetchImpl = (input: string, init?: RequestInit) => fetch(input, init), passkeys = browserPasskeys(), base = API_BASE }: { fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>; passkeys?: Passkeys; base?: string } = {}) {
  let csrf = "";
  const call = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(csrf ? { [CSRF_HEADER]: csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({ error: "bad_response" }))) as Record<string, unknown>;
    if (!response.ok) {
      if (response.status === 401) csrf = "";
      throw new HubApiError(response.status, String(json.error ?? "request_failed"), typeof json.detail === "string" ? json.detail : undefined);
    }
    if (typeof json.csrf === "string") csrf = json.csrf;
    return json as T;
  };

  const state = () => call<ApiState>("GET", "/state");
  /** Loads the CSRF token for a session the cookie already holds; null without one. */
  const me = async () => {
    try {
      return await call<{ accountId: string; csrf: string }>("GET", "/me");
    } catch (error) {
      if (error instanceof HubApiError && error.status === 401) return null;
      throw error;
    }
  };
  const register = async () => {
    const { publicKey } = await call<{ publicKey: PublicKeyCredentialCreationOptions & { challenge: string; user: { id: string; name: string; displayName: string } } }>("POST", "/register/options", {});
    const credential = await passkeys.create({ ...publicKey, challenge: b64u.toBytes(publicKey.challenge), user: { ...publicKey.user, id: b64u.toBytes(publicKey.user.id) } } as PublicKeyCredentialCreationOptions);
    const response = credential.response as AuthenticatorAttestationResponse;
    return call<{ accountId: string; csrf: string }>("POST", "/register", {
      id: credential.id,
      response: { clientDataJSON: b64u.fromBytes(response.clientDataJSON), attestationObject: b64u.fromBytes(response.attestationObject) },
    });
  };
  const login = async () => {
    const { publicKey } = await call<{ publicKey: PublicKeyCredentialRequestOptions & { challenge: string } }>("POST", "/login/options", {});
    const credential = await passkeys.get({ ...publicKey, challenge: b64u.toBytes(publicKey.challenge) } as PublicKeyCredentialRequestOptions);
    const response = credential.response as AuthenticatorAssertionResponse;
    return call<{ accountId: string; csrf: string }>("POST", "/login", {
      id: credential.id,
      response: {
        clientDataJSON: b64u.fromBytes(response.clientDataJSON),
        authenticatorData: b64u.fromBytes(response.authenticatorData),
        signature: b64u.fromBytes(response.signature),
        userHandle: response.userHandle ? b64u.fromBytes(response.userHandle) : null,
      },
    });
  };
  const logout = async () => {
    await call("POST", "/logout", {});
    csrf = "";
  };
  const join = () => call<ApiMe>("POST", "/join", {});
  const submit = (input: ActivityInput) => call<ApiMe & { submission: ApiSubmission }>("POST", "/activities", input);

  return { state, me, register, login, logout, join, submit, ...identityApi(call), get hasSession() { return csrf !== ""; } };
}

export type HubApi = ReturnType<typeof createHubApi>;
