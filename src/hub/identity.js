// SPDX-License-Identifier: MIT
// Session-bound optional links. These routes have no scoring, reward, token-balance or transaction authority.
import { createPublicKey, randomBytes, verify } from "node:crypto";
import { decodePublicKey } from "../core/base58.js";
import { HttpError, readJson } from "../platform/guard.js";
import { createHubIdentityStore } from "./identity-store.js";
import { createTwitchVerifier, TWITCH_ISSUER, twitchConfig } from "./twitch-identity.js";

const TTL = 300;
const random = () => randomBytes(32).toString("base64url");
export function createIdentityRoutes({ hubStore, origins, requireOrigin, requireSession, authLimit, now, twitch = twitchConfig(), fetchImpl, store = createHubIdentityStore({ dir: hubStore.dir }) }) {
  if (twitch) {
    const redirect = new URL(twitch.redirectUri);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(twitch.clientId) || !origins.includes(redirect.origin) || redirect.pathname !== "/hub/twitch" || redirect.search || redirect.hash || redirect.username || redirect.password) throw new TypeError("hub Twitch redirect must be /hub/twitch on an allowed origin");
  }
  const verifyTwitch = twitch ? createTwitchVerifier({ clientId: twitch.clientId, fetchImpl, now }) : null;
  const challenges = new Map();
  const snapshot = (accountId) => ({ twitchEnabled: Boolean(twitch), ...store.get(accountId) });
  const writeSession = (request, key) => {
    requireOrigin(request);
    const session = requireSession(request, { csrf: true });
    if (!authLimit(key)) throw new HttpError(429, "slow_down");
    return session;
  };
  const bodyOf = async (request, allowed) => {
    const body = await readJson(request, 12_288);
    if (Object.keys(body).some((k) => !allowed.includes(k))) throw new HttpError(400, "unknown_field");
    return body;
  };
  const issue = (session, kind, record) => {
    for (const [key, c] of challenges) if (c.expiresAt <= now()) challenges.delete(key);
    const key = `${session.id}:${kind}`;
    if (challenges.size >= 4096 && !challenges.has(key)) throw new HttpError(429, "slow_down");
    const challenge = random();
    challenges.set(key, { ...record, challenge, expiresAt: now() + TTL });
    return challenge;
  };
  const take = (session, kind, challenge, origin) => {
    const key = `${session.id}:${kind}`;
    const record = challenges.get(key);
    if (!record || record.used || typeof challenge !== "string" || record.challenge !== challenge || record.origin !== origin) throw new HttpError(400, "identity_challenge_expired");
    record.used = true; // One attempt, including a rejected proof. Another session cannot consume it.
    if (record.expiresAt <= now()) throw new HttpError(400, "identity_challenge_expired");
    return record;
  };
  const routes = {
    "GET /hub/api/identity": (request) => snapshot(requireSession(request, { csrf: false }).accountId),
    "POST /hub/api/identity/twitch/start": async (request, key) => {
      const session = writeSession(request, key);
      await bodyOf(request, []);
      if (!twitch) throw new HttpError(409, "twitch_unavailable");
      // A single registered callback cannot silently move the initiating session to a different page origin.
      if (new URL(twitch.redirectUri).origin !== request.headers.origin) throw new HttpError(409, "twitch_unavailable");
      const nonce = random();
      const state = issue(session, "twitch", { nonce, origin: request.headers.origin });
      const url = new URL(`${TWITCH_ISSUER}/authorize`);
      url.search = new URLSearchParams({ client_id: twitch.clientId, redirect_uri: twitch.redirectUri, response_type: "id_token", scope: "openid", nonce, state, claims: JSON.stringify({ id_token: { preferred_username: null } }) }).toString();
      return { url: url.href, state, expiresAt: now() + TTL };
    },
    "POST /hub/api/identity/twitch/finish": async (request, key) => {
      const session = writeSession(request, key);
      const body = await bodyOf(request, ["state", "idToken"]);
      if (!verifyTwitch) throw new HttpError(409, "twitch_unavailable");
      const record = take(session, "twitch", body.state, request.headers.origin);
      const challengeKey = `${session.id}:twitch`;
      try {
        const identity = await verifyTwitch(body.idToken, record.nonce);
        requireSession(request, { csrf: true }); // Logout/expiry during the remote key fetch cancels the write.
        if (challenges.get(challengeKey) !== record || record.expiresAt <= now()) throw new HttpError(400, "identity_challenge_expired");
        store.link(session.accountId, "twitch", { ...identity, verifiedAt: now() });
        return snapshot(session.accountId);
      } finally {
        if (challenges.get(challengeKey) === record) challenges.delete(challengeKey);
      }
    },
    "POST /hub/api/identity/wallet/start": async (request, key) => {
      const session = writeSession(request, key);
      const { address } = await bodyOf(request, ["address"]);
      if (typeof address !== "string" || address.length > 44) throw new HttpError(400, "wallet_address_required");
      try { decodePublicKey(address); } catch { throw new HttpError(400, "wallet_address_required"); }
      const nonce = random(); const issuedAt = now(); const expiresAt = issuedAt + TTL;
      const message = `Radio LAN wallet link\nOrigin: ${request.headers.origin}\nHub account: ${session.accountId}\nWallet: ${address}\nNonce: ${nonce}\nIssued at: ${new Date(issuedAt * 1000).toISOString()}\nExpires at: ${new Date(expiresAt * 1000).toISOString()}\n\nSign to link this wallet. This does not send a transaction or add points.`;
      const challenge = issue(session, "wallet", { address, message, origin: request.headers.origin });
      return { challenge, message, address, expiresAt };
    },
    "POST /hub/api/identity/wallet/finish": async (request, key) => {
      const session = writeSession(request, key);
      const body = await bodyOf(request, ["challenge", "signature"]);
      const record = take(session, "wallet", body.challenge, request.headers.origin);
      if (typeof body.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(body.signature)) throw new HttpError(400, "wallet_proof_rejected");
      const signature = Buffer.from(body.signature, "base64url");
      if (signature.length !== 64 || signature.toString("base64url") !== body.signature) throw new HttpError(400, "wallet_proof_rejected");
      const publicKey = createPublicKey({ format: "jwk", key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(decodePublicKey(record.address)).toString("base64url") } });
      if (!verify(null, Buffer.from(record.message), publicKey, signature)) throw new HttpError(400, "wallet_proof_rejected");
      store.link(session.accountId, "wallet", { address: record.address, verifiedAt: now() });
      return snapshot(session.accountId);
    },
  };
  for (const kind of ["twitch", "wallet"]) routes[`POST /hub/api/identity/${kind}/unlink`] = async (request, key) => {
    const session = writeSession(request, key);
    await bodyOf(request, []);
    challenges.delete(`${session.id}:${kind}`);
    store.unlink(session.accountId, kind);
    return snapshot(session.accountId);
  };
  return routes;
}
