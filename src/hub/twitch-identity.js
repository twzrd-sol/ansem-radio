// SPDX-License-Identifier: MIT
// Optional public-client OIDC identity. The only remote request is to Twitch's fixed public JWKS URL.
// Tokens, access permissions and provider activity never reach storage or the points engine.
import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { HttpError } from "../platform/guard.js";

export const TWITCH_ISSUER = "https://id.twitch.tv/oauth2";
export const TWITCH_KEYS = `${TWITCH_ISSUER}/keys`;
const rejected = () => new HttpError(400, "twitch_identity_rejected");

export function twitchConfig(env = process.env) {
  const clientId = env.RADIOLAN_HUB_TWITCH_CLIENT_ID ?? "";
  const redirectUri = env.RADIOLAN_HUB_TWITCH_REDIRECT_URI ?? "";
  if (!clientId && !redirectUri) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) throw new TypeError("hub Twitch client id required");
  if (!redirectUri) throw new TypeError("hub Twitch redirect URI required");
  return { clientId, redirectUri };
}

function decode(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw rejected();
  const bytes = Buffer.from(text, "base64url");
  if (bytes.toString("base64url") !== text) throw rejected();
  return bytes;
}
function object(bytes) {
  const value = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw rejected();
  return value;
}

export function createTwitchVerifier({ clientId, fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000) }) {
  let keys = new Map(); let loadedAt = -Infinity; let attemptedAt = -Infinity; let pending = null;
  const refresh = async () => {
    if (pending) return pending;
    if (now() - attemptedAt < 60) throw new HttpError(503, "twitch_keys_unavailable");
    attemptedAt = now();
    pending = (async () => {
      try {
        const response = await fetchImpl(TWITCH_KEYS, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("key response");
        const text = await response.text();
        if (text.length > 32_768) throw new Error("key size");
        const body = JSON.parse(text);
        if (!Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 32) throw new Error("key set");
        const next = new Map();
        for (const jwk of body.keys) {
          if (jwk.kty !== "RSA" || (jwk.alg && jwk.alg !== "RS256") || (jwk.use && jwk.use !== "sig") || (jwk.key_ops && !jwk.key_ops.includes("verify"))) continue;
          if (typeof jwk.kid !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(jwk.kid) || next.has(jwk.kid) || jwk.d) throw new Error("key id");
          const key = createPublicKey({ key: jwk, format: "jwk" });
          if (key.asymmetricKeyDetails.modulusLength < 2048 || key.asymmetricKeyDetails.modulusLength > 8192) throw new Error("key strength");
          next.set(jwk.kid, key);
        }
        if (next.size === 0) throw new Error("no signing keys");
        keys = next; loadedAt = now();
      } catch {
        throw new HttpError(503, "twitch_keys_unavailable");
      }
    })();
    try { await pending; } finally { pending = null; }
  };

  return async (idToken, nonce) => {
    let header, payload, parts, signature;
    try {
      if (typeof idToken !== "string" || idToken.length > 8192) throw rejected();
      parts = idToken.split(".");
      if (parts.length !== 3) throw rejected();
      header = object(decode(parts[0])); payload = object(decode(parts[1])); signature = decode(parts[2]);
      if (header.alg !== "RS256" || typeof header.kid !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(header.kid) || header.crit || header.b64 === false) throw rejected();
      const aud = typeof payload.aud === "string" ? [payload.aud] : payload.aud;
      if (!Array.isArray(aud) || aud.length < 1 || aud.length > 10 || !aud.every((a) => typeof a === "string") || !aud.includes(clientId)) throw rejected();
      if ((payload.azp !== undefined && payload.azp !== clientId) || (aud.length > 1 && payload.azp !== clientId)) throw rejected();
      if (payload.iss !== TWITCH_ISSUER || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || payload.exp <= now() || payload.iat < 0 || payload.iat > now() + 30 || payload.exp <= payload.iat) throw rejected();
      if (typeof payload.sub !== "string" || !/^[0-9]{1,32}$/.test(payload.sub)) throw rejected();
      if (typeof nonce !== "string" || typeof payload.nonce !== "string") throw rejected();
      const expected = Buffer.from(nonce); const given = Buffer.from(payload.nonce);
      if (expected.length === 0 || expected.length !== given.length || !timingSafeEqual(expected, given)) throw rejected();
    } catch { throw rejected(); }
    if (now() - loadedAt >= 3600) await refresh();
    else if (!keys.has(header.kid) && now() - attemptedAt >= 60) await refresh();
    const key = keys.get(header.kid);
    if (!key || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, signature)) throw rejected();
    const name = typeof payload.preferred_username === "string" ? payload.preferred_username.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 128) : "";
    return { subject: payload.sub, displayName: name || payload.sub };
  };
}
