// Ed25519 over raw 32-byte keys and 64-byte signatures, as Solana wallets use
// them. node:crypto does the math; this file only converts raw bytes to and
// from the key formats it accepts.

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

// PKCS#8 DER prefix for an Ed25519 private key; the 32-byte seed follows it.
const PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function bytes(value, length, field) {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new TypeError(`${field} must be ${length} bytes`);
  }
  return value;
}

/**
 * A signer from a 32-byte seed. For tests and for keys the server holds; a
 * creator or collaborator signs in their own wallet, never here.
 */
export function signerFromSeed(seed) {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_SEED_PREFIX, bytes(seed, 32, "seed")]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = new Uint8Array(Buffer.from(createPublicKey(key).export({ format: "jwk" }).x, "base64url"));
  return Object.freeze({
    publicKey,
    sign: (message) => new Uint8Array(sign(null, message, key)),
  });
}

/** True only for a valid signature; false for any malformed input. */
export function verifyEd25519(publicKey, message, signature) {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) return false;
  if (!(signature instanceof Uint8Array) || signature.length !== 64) return false;
  if (!(message instanceof Uint8Array)) return false;
  try {
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey).toString("base64url") },
      format: "jwk",
    });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}
