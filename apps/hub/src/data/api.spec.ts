// The hub API client against a fake fetch and a fake authenticator: what it sends, what it keeps, what it says.
import { describe, expect, it } from "vitest";

import { createHubApi, CSRF_HEADER, explainApiError, HubApiError, type Passkeys } from "./api";

type Call = { url: string; init: RequestInit };
const b64u = (s: string) => Buffer.from(s).toString("base64url");

function fakeServer(responses: Record<string, (body: unknown) => { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = responses[key];
    if (!handler) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    const { status = 200, json } = handler(init?.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const bytes = (s: string) => Uint8Array.from(Buffer.from(s));
const fakePasskeys = (): Passkeys & { created: PublicKeyCredentialCreationOptions[]; got: PublicKeyCredentialRequestOptions[] } => {
  const created: PublicKeyCredentialCreationOptions[] = [];
  const got: PublicKeyCredentialRequestOptions[] = [];
  return {
    created,
    got,
    async create(options) {
      created.push(options);
      return { id: "cred-1", response: { clientDataJSON: bytes("client-create").buffer, attestationObject: bytes("attestation").buffer } } as unknown as PublicKeyCredential;
    },
    async get(options) {
      got.push(options);
      return { id: "cred-1", response: { clientDataJSON: bytes("client-get").buffer, authenticatorData: bytes("auth").buffer, signature: bytes("sig").buffer, userHandle: null } } as unknown as PublicKeyCredential;
    },
  };
};

describe("hub API client", () => {
  it("registers: decodes the challenge and user id for the authenticator, posts base64url fields, keeps the CSRF token for writes", async () => {
    const server = fakeServer({
      "POST /hub/api/register/options": () => ({ json: { publicKey: { rp: { id: "localhost", name: "Radio LAN" }, user: { id: b64u("user-handle-32-bytes-long-xxxxxxx"), name: "fan-1", displayName: "fan" }, challenge: b64u("challenge-bytes"), pubKeyCredParams: [], attestation: "none" } } }),
      "POST /hub/api/register": (body) => ({ json: { accountId: "a".repeat(64), csrf: "csrf-token", echo: body } }),
      "POST /hub/api/join": () => ({ json: { joined: true, points: "0", today: "0", pending: 0, submissions: [] } }),
    });
    const passkeys = fakePasskeys();
    const api = createHubApi({ fetchImpl: server.fetchImpl, passkeys });
    const registered = await api.register();
    expect(registered.accountId).toBe("a".repeat(64));
    expect(Buffer.from(passkeys.created[0]!.challenge as ArrayBuffer).toString()).toBe("challenge-bytes");
    expect(Buffer.from(passkeys.created[0]!.user.id as ArrayBuffer).toString()).toBe("user-handle-32-bytes-long-xxxxxxx");
    const sent = JSON.parse(String(server.calls[1]!.init.body));
    expect(sent).toEqual({ id: "cred-1", response: { clientDataJSON: b64u("client-create"), attestationObject: b64u("attestation") } });
    expect(api.hasSession).toBe(true);
    await api.join();
    const headers = server.calls[2]!.init.headers as Record<string, string>;
    expect(headers[CSRF_HEADER]).toBe("csrf-token");
    expect(server.calls[2]!.init.credentials).toBe("same-origin");
  });

  it("signs in with a discoverable passkey and forgets the token on a 401", async () => {
    const server = fakeServer({
      "POST /hub/api/login/options": () => ({ json: { publicKey: { rpId: "localhost", challenge: b64u("c2"), allowCredentials: [] } } }),
      "POST /hub/api/login": () => ({ json: { accountId: "b".repeat(64), csrf: "t2" } }),
      "POST /hub/api/join": () => ({ status: 401, json: { error: "sign_in_required" } }),
      "GET /hub/api/me": () => ({ status: 401, json: { error: "sign_in_required" } }),
    });
    const passkeys = fakePasskeys();
    const api = createHubApi({ fetchImpl: server.fetchImpl, passkeys });
    await api.login();
    expect(passkeys.got[0]!.rpId).toBe("localhost");
    const sent = JSON.parse(String(server.calls[1]!.init.body));
    expect(sent.response).toEqual({ clientDataJSON: b64u("client-get"), authenticatorData: b64u("auth"), signature: b64u("sig"), userHandle: null });
    expect(api.hasSession).toBe(true);
    await expect(api.join()).rejects.toMatchObject({ status: 401, code: "sign_in_required" });
    expect(api.hasSession).toBe(false);
    expect(await api.me()).toBeNull();
  });

  it("submits activities as the API expects them and explains refusals in the hub's words", async () => {
    const server = fakeServer({
      "POST /hub/api/activities": (body) => ((body as { action: string }).action === "question" ? { status: 409, json: { error: "already_submitted" } } : { json: { points: "5", submission: { id: "s", action: "poll_response", status: "credited", occurredAt: 1 } } }),
    });
    const api = createHubApi({ fetchImpl: server.fetchImpl, passkeys: fakePasskeys() });
    const poll = await api.submit({ action: "poll_response", pollId: "p1", choice: 2 });
    expect(poll.points).toBe("5");
    expect(JSON.parse(String(server.calls[0]!.init.body))).toEqual({ action: "poll_response", pollId: "p1", choice: 2 });
    const refused = await api.submit({ action: "question", text: "again" }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(HubApiError);
    expect(explainApiError(refused)).toBe("You already sent that one.");
    expect(explainApiError(new HubApiError(409, "join_first"))).toBe("Join the season first. It's free.");
    expect(explainApiError(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe("The passkey prompt was closed. Nothing changed.");
    expect(explainApiError(new Error("offline"))).toBe("Couldn't reach the hub. Nothing changed.");
  });
});

describe("a broken success response", () => {
  it("a 200 whose body is not JSON is an error, not a success (api and market reads)", async () => {
    const html = async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } });
    const api = createHubApi({ fetchImpl: html, passkeys: fakePasskeys() });
    await expect(api.state()).rejects.toMatchObject({ status: 200, code: "bad_response" });
    const { fetchMarket } = await import("./market");
    await expect(fetchMarket(html)).rejects.toMatchObject({ status: 200, code: "bad_response" });
  });
});
