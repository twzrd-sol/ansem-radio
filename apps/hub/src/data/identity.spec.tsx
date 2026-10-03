import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createHubApi } from "./api";
import { captureTwitchCallback, completeTwitchCallback, startTwitchLink, TWITCH_PENDING } from "./twitch-link";
import { IdentityFacts } from "../ui/IdentityLinks";

const accountId = "a".repeat(64);
const NOW = 1_791_025_000;
function storage() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
function server() {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  let session = accountId;
  const fetchImpl = async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    let json: unknown = {};
    if (path.endsWith("/me")) json = { accountId: session, csrf: "csrf" };
    if (path.endsWith("/twitch/start")) json = { url: `https://id.twitch.tv/oauth2/authorize?state=pending`, state: "pending", expiresAt: NOW + 300 };
    if (path.endsWith("/twitch/finish")) json = { twitchEnabled: true, twitch: { subject: "123", displayName: "LAN fan", verifiedAt: NOW }, wallet: null };
    return new Response(JSON.stringify(json));
  };
  return { api: createHubApi({ fetchImpl }), calls, switchAccount: () => { session = "b".repeat(64); } };
}

describe("optional account links", () => {
  it("uses the existing session CSRF for identity writes and stores only pending state before navigating", async () => {
    const h = server(); const local = storage(); const navigate = vi.fn();
    await startTwitchLink(h.api, { storage: local, navigate, now: () => NOW });
    expect(navigate).toHaveBeenCalledWith("https://id.twitch.tv/oauth2/authorize?state=pending");
    expect(JSON.parse(local.getItem(TWITCH_PENDING)!)).toEqual({ state: "pending", accountId, expiresAt: NOW + 300 });
    expect(h.calls[1]!.init!.headers).toMatchObject({ "x-hub-csrf": "csrf" });
  });
  it("scrubs callback credentials before rendering and does not persist an ID token", async () => {
    const h = server(); const local = storage();
    await startTwitchLink(h.api, { storage: local, navigate: () => {}, now: () => NOW });
    const history = { replaceState: vi.fn() };
    const captured = captureTwitchCallback({ pathname: "/hub/twitch", hash: "#id_token=signed-token&state=pending", search: "" }, history)!;
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/hub/twitch");
    await completeTwitchCallback(h.api, captured, { storage: local, now: () => NOW });
    expect(h.calls.at(-1)!.path).toBe("/hub/api/identity/twitch/finish");
    expect(JSON.parse(String(h.calls.at(-1)!.init!.body))).toEqual({ idToken: "signed-token", state: "pending" });
    expect(local.getItem(TWITCH_PENDING)).toBeNull();
    expect(captured.idToken).toBeUndefined();
  });
  it("captures a live Location before history replacement clears its hash", () => {
    const location = { pathname: "/hub/twitch", hash: "#id_token=signed-token&state=pending", search: "" };
    const captured = captureTwitchCallback(location, { replaceState: () => { location.hash = ""; location.search = ""; } });
    expect(captured).toEqual({ state: "pending", idToken: "signed-token" });
    expect(location.hash).toBe("");
  });
  it("rejects a callback with another state, expired state, duplicate fields or a changed hub account before sending the token", async () => {
    for (const scenario of ["state", "expired", "duplicate", "session"]) {
      const h = server(); const local = storage();
      await startTwitchLink(h.api, { storage: local, navigate: () => {}, now: () => NOW });
      if (scenario === "session") h.switchAccount();
      const hash = `#id_token=private-token&state=${scenario === "state" ? "else" : "pending"}${scenario === "duplicate" ? "&id_token=other" : ""}`;
      const captured = captureTwitchCallback({ pathname: "/hub/twitch", hash, search: "" }, { replaceState: () => {} })!;
      await expect(completeTwitchCallback(h.api, captured, { storage: local, now: () => NOW + (scenario === "expired" ? 301 : 0) })).rejects.toThrow();
      expect(h.calls.some((call) => String(call.init?.body).includes("private-token"))).toBe(false);
      expect(local.getItem(TWITCH_PENDING)).toBeNull();
    }
  });
  it("handles denial without provider text or credentials appearing in the result", async () => {
    const h = server(); const local = storage();
    await startTwitchLink(h.api, { storage: local, navigate: () => {}, now: () => NOW });
    const callback = captureTwitchCallback({ pathname: "/hub/twitch", hash: "", search: "?error=access_denied&error_description=private-text&state=pending" }, { replaceState: () => {} })!;
    await expect(completeTwitchCallback(h.api, callback, { storage: local, now: () => NOW })).rejects.toThrow("Twitch linking was cancelled");
    expect(JSON.stringify(callback)).not.toContain("private-text");
    expect(h.calls.some((c) => c.path.endsWith("/finish"))).toBe(false);
  });
  it("does not navigate when storage is unavailable, and ignores ordinary hub hashes", async () => {
    const h = server(); const navigate = vi.fn();
    await expect(startTwitchLink(h.api, { storage: { ...storage(), setItem: () => { throw new Error("denied"); } }, navigate, now: () => NOW })).rejects.toThrow("browser storage");
    expect(navigate).not.toHaveBeenCalled();
    expect(captureTwitchCallback({ pathname: "/hub/", hash: "#/me", search: "" }, { replaceState: vi.fn() })).toBeNull();
  });
  it("labels connection and verified links separately, and makes optional linking add no points", () => {
    const text = renderToStaticMarkup(<IdentityFacts identity={{ twitchEnabled: true, twitch: { subject: "123", displayName: "LAN fan", verifiedAt: NOW }, wallet: { address: "public-address", verifiedAt: NOW } }} />);
    expect(text).toContain("LAN fan");
    expect(text).toContain("public-address");
    expect(text).toContain("adds no points");
    expect(text).not.toContain("Not available yet");
    const disabled = renderToStaticMarkup(<IdentityFacts identity={{ twitchEnabled: false, twitch: null, wallet: null }} />);
    expect(disabled).toContain("Not available yet");
    expect(disabled).toContain("Not linked");
  });

  it("encodes wallet proof bytes for the backend and keeps tokens out of ordinary requests", async () => {
    const h = server();
    await h.api.me();
    await h.api.beginWalletLink("public-address");
    await h.api.finishWalletLink("single-use", new Uint8Array(64).fill(255));
    const call = h.calls.at(-1)!;
    expect(call.path).toBe("/hub/api/identity/wallet/finish");
    expect(JSON.parse(String(call.init!.body))).toEqual({ challenge: "single-use", signature: Buffer.alloc(64, 255).toString("base64url") });
    expect(call.init!.headers).toMatchObject({ "x-hub-csrf": "csrf" });
    await h.api.unlinkWallet();
    await h.api.unlinkTwitch();
    expect(h.calls.slice(-2).map((call) => JSON.parse(String(call.init!.body)))).toEqual([{}, {}]);
  });
});
