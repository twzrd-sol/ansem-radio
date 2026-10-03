/**
 * WebAuthn for hub accounts (docs/HUB_FRONTEND_PLAN.md section 3, F-6), zero dependencies: a CBOR decoder for
 * the attestation object, COSE keys to node:crypto KeyObjects, and the two verifications. Attestation statements
 * are not evaluated (`fmt: "none"` or any format is accepted as self-asserted): the hub needs a stable credential
 * per account, not an authenticator model. Challenges, origins and RP ids are checked here; storage is the caller's.
 */
import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

export const base64url = {
  encode: (bytes) => Buffer.from(bytes).toString("base64url"),
  decode: (text) => {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new TypeError("not base64url");
    return new Uint8Array(Buffer.from(text, "base64url"));
  },
};

const sha256 = (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest());

/** Decode one CBOR item (major types 0-5, booleans, null) at `at`; returns [value, next]. */
export function decodeCbor(bytes, at = 0) {
  const value = decodeItem(bytes, at, 0);
  return value;
}
function decodeItem(bytes, at, depth) {
  if (depth > 16) throw new RangeError("CBOR nesting too deep");
  if (at >= bytes.length) throw new RangeError("CBOR truncated");
  const initial = bytes[at];
  const major = initial >> 5;
  const info = initial & 0x1f;
  let length;
  let next = at + 1;
  if (info < 24) length = info;
  else if (info === 24) { length = bytes[next]; next += 1; }
  else if (info === 25) { length = (bytes[next] << 8) | bytes[next + 1]; next += 2; }
  else if (info === 26) { length = ((bytes[next] << 24) >>> 0) + (bytes[next + 1] << 16) + (bytes[next + 2] << 8) + bytes[next + 3]; next += 4; }
  else if (info === 27) {
    let big = 0n;
    for (let i = 0; i < 8; i += 1) big = (big << 8n) | BigInt(bytes[next + i]);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("CBOR integer too large");
    length = Number(big);
    next += 8;
  } else throw new RangeError("CBOR indefinite lengths are not supported");
  if (next > bytes.length) throw new RangeError("CBOR truncated");
  switch (major) {
    case 0: return [length, next];
    case 1: return [-1 - length, next];
    case 2:
    case 3: {
      if (next + length > bytes.length) throw new RangeError("CBOR truncated");
      const slice = bytes.subarray(next, next + length);
      return [major === 2 ? new Uint8Array(slice) : Buffer.from(slice).toString("utf8"), next + length];
    }
    case 4: {
      const items = [];
      for (let i = 0; i < length; i += 1) {
        const [item, after] = decodeItem(bytes, next, depth + 1);
        items.push(item);
        next = after;
      }
      return [items, next];
    }
    case 5: {
      const map = new Map();
      for (let i = 0; i < length; i += 1) {
        const [key, afterKey] = decodeItem(bytes, next, depth + 1);
        const [item, afterValue] = decodeItem(bytes, afterKey, depth + 1);
        if (typeof key !== "string" && typeof key !== "number") throw new TypeError("CBOR map keys must be text or integers");
        map.set(key, item);
        next = afterValue;
      }
      return [map, next];
    }
    case 7:
      if (info === 20) return [false, next];
      if (info === 21) return [true, next];
      if (info === 22) return [null, next];
      throw new RangeError("unsupported CBOR simple value");
    default:
      throw new RangeError("unsupported CBOR major type");
  }
}

/** Encode strings, integers, byte strings, arrays and maps (for tests and fixtures; no floats). */
export function encodeCbor(value) {
  const head = (major, n) => {
    if (n < 24) return [(major << 5) | n];
    if (n < 0x100) return [(major << 5) | 24, n];
    if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
    return [(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  };
  const parts = [];
  const put = (v) => {
    if (typeof v === "number" && Number.isInteger(v)) parts.push(Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v)));
    else if (typeof v === "string") { const b = Buffer.from(v, "utf8"); parts.push(Uint8Array.from(head(3, b.length)), b); }
    else if (v instanceof Uint8Array) { parts.push(Uint8Array.from(head(2, v.length)), v); }
    else if (Array.isArray(v)) { parts.push(Uint8Array.from(head(4, v.length))); v.forEach(put); }
    else if (v instanceof Map) { parts.push(Uint8Array.from(head(5, v.size))); for (const [k, item] of v) { put(k); put(item); } }
    else if (v === true) parts.push(Uint8Array.of(0xf5));
    else if (v === false) parts.push(Uint8Array.of(0xf4));
    else if (v === null) parts.push(Uint8Array.of(0xf6));
    else throw new TypeError("unsupported CBOR value");
  };
  put(value);
  return new Uint8Array(Buffer.concat(parts));
}

/** The algorithms the hub accepts, COSE identifiers to node:crypto verification parameters. */
export const ALGORITHMS = Object.freeze({
  [-7]: { name: "ES256", hash: "sha256", dsaEncoding: "der" },
  [-8]: { name: "EdDSA", hash: null },
  [-257]: { name: "RS256", hash: "sha256" },
});

/** A COSE_Key map to a JWK the hub stores, plus its algorithm. EC2 P-256, OKP Ed25519 and RSA only. */
export function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new TypeError("COSE key must be a map");
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (!ALGORITHMS[alg]) throw new RangeError("unsupported credential algorithm");
  const b64 = (bytes, length) => {
    if (!(bytes instanceof Uint8Array) || (length !== undefined && bytes.length !== length)) throw new TypeError("malformed COSE key coordinate");
    return base64url.encode(bytes);
  };
  if (kty === 2 && alg === -7) {
    if (cose.get(-1) !== 1) throw new RangeError("ES256 needs P-256");
    return { jwk: { kty: "EC", crv: "P-256", x: b64(cose.get(-2), 32), y: b64(cose.get(-3), 32) }, alg };
  }
  if (kty === 1 && alg === -8) {
    if (cose.get(-1) !== 6) throw new RangeError("EdDSA needs Ed25519");
    return { jwk: { kty: "OKP", crv: "Ed25519", x: b64(cose.get(-2), 32) }, alg };
  }
  if (kty === 3 && alg === -257) return { jwk: { kty: "RSA", n: b64(cose.get(-1)), e: b64(cose.get(-2)) }, alg };
  throw new RangeError("unsupported credential key type");
}

/** Authenticator data: rpIdHash, flags, signCount, and on registration the credential id and COSE key. */
export function parseAuthenticatorData(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 37) throw new RangeError("authenticator data too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[32];
  const parsed = {
    rpIdHash: new Uint8Array(bytes.subarray(0, 32)),
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    signCount: view.getUint32(33, false),
    credentialId: null,
    cosePublicKey: null,
  };
  if (flags & 0x40) {
    if (bytes.length < 55) throw new RangeError("attested credential data too short");
    const idLength = view.getUint16(53, false);
    const idEnd = 55 + idLength;
    if (idLength === 0 || idEnd > bytes.length) throw new RangeError("credential id out of range");
    parsed.credentialId = new Uint8Array(bytes.subarray(55, idEnd));
    const [cose, next] = decodeCbor(bytes, idEnd);
    parsed.cosePublicKey = cose;
    // Extensions may follow (flag 0x80); nothing here reads them.
    if (!(flags & 0x80) && next !== bytes.length) throw new RangeError("trailing bytes after credential data");
  }
  return parsed;
}

function clientData(encoded, expectedType, expectedChallenge, origins) {
  const raw = base64url.decode(encoded);
  let data;
  try {
    data = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    throw new TypeError("clientDataJSON is not JSON");
  }
  if (data?.type !== expectedType) throw new TypeError(`clientData type is not ${expectedType}`);
  const given = typeof data.challenge === "string" ? Buffer.from(data.challenge, "base64url") : Buffer.alloc(0);
  const expected = Buffer.from(base64url.decode(expectedChallenge));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new TypeError("challenge mismatch");
  if (typeof data.origin !== "string" || !origins.includes(data.origin)) throw new TypeError("origin not allowed");
  return { hash: sha256(raw), origin: data.origin };
}

const rpIdOk = (rpIdHash, rpIds) => rpIds.some((id) => timingSafeEqual(Buffer.from(rpIdHash), Buffer.from(sha256(Buffer.from(id, "utf8")))));

/**
 * Check a `navigator.credentials.create()` result. Returns the credential to store. `origins` is the allowlist of
 * page origins; `rpIds` their RP ids (a hostname, never an IP literal: browsers refuse those).
 */
export function verifyRegistration({ clientDataJSON, attestationObject, expectedChallenge, origins, rpIds }) {
  clientData(clientDataJSON, "webauthn.create", expectedChallenge, origins);
  const [attestation] = decodeCbor(base64url.decode(attestationObject));
  if (!(attestation instanceof Map) || !(attestation.get("authData") instanceof Uint8Array)) throw new TypeError("attestation object has no authData");
  const auth = parseAuthenticatorData(attestation.get("authData"));
  if (!rpIdOk(auth.rpIdHash, rpIds)) throw new TypeError("RP id mismatch");
  if (!auth.userPresent) throw new TypeError("user presence not asserted");
  if (!auth.credentialId || !auth.cosePublicKey) throw new TypeError("no credential in the attestation");
  if (auth.credentialId.length > 1023) throw new RangeError("credential id too long");
  const { jwk, alg } = coseToJwk(auth.cosePublicKey);
  createPublicKey({ key: jwk, format: "jwk" }); // refuses a point off the curve or a malformed modulus now, not at login
  return { credentialId: base64url.encode(auth.credentialId), publicKeyJwk: jwk, alg, signCount: auth.signCount, userVerified: auth.userVerified };
}

/** Check a `navigator.credentials.get()` result against a stored credential. Returns the new sign count. */
export function verifyAssertion({ credential, clientDataJSON, authenticatorData, signature, expectedChallenge, origins, rpIds }) {
  const { hash } = clientData(clientDataJSON, "webauthn.get", expectedChallenge, origins);
  const authBytes = base64url.decode(authenticatorData);
  const auth = parseAuthenticatorData(authBytes);
  if (!rpIdOk(auth.rpIdHash, rpIds)) throw new TypeError("RP id mismatch");
  if (!auth.userPresent) throw new TypeError("user presence not asserted");
  const algorithm = ALGORITHMS[credential.alg];
  if (!algorithm) throw new RangeError("unsupported credential algorithm");
  const key = createPublicKey({ key: credential.publicKeyJwk, format: "jwk" });
  const signed = Buffer.concat([Buffer.from(authBytes), Buffer.from(hash)]);
  const options = algorithm.dsaEncoding ? { key, dsaEncoding: algorithm.dsaEncoding } : key;
  if (!verify(algorithm.hash, signed, options, Buffer.from(base64url.decode(signature)))) throw new TypeError("signature does not verify");
  // A counter that does not advance means a cloned authenticator. Authenticators that never count report 0 for
  // ever; once a credential has reported a nonzero count, a 0 is a regression too.
  if (credential.signCount !== 0 && auth.signCount <= credential.signCount) throw new TypeError("sign count did not advance");
  return { signCount: auth.signCount, userVerified: auth.userVerified };
}
