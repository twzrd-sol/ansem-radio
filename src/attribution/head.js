/**
 * Signed tree heads, byte-exact with what the evidence-ledger program checks
 * in `anchor_head` (programs/evidence-ledger/src/instructions/anchor.rs):
 *
 *   "TWZRD:RECEIPT_LOG_STH_V1" || u16le(len(log_id)) || log_id
 *     || u64le(tree_size) || u64le(timestamp_unix) || root
 *
 * The domain string is fixed in the program for every scheme-2 log; the log_id
 * inside the signed bytes is what keeps Radio LAN's heads apart from others'.
 * A head verifies with the log's public key alone, without the chain.
 */

import { verifyEd25519 } from "../core/ed25519.js";
import { LOG_ID } from "./claim.js";
import { verifyConsistency } from "./tree.js";

export const STH_DOMAIN = "TWZRD:RECEIPT_LOG_STH_V1";
const MAX_LOG_ID_BYTES = 64;
const encoder = new TextEncoder();

function le(value, width) {
  const out = new Uint8Array(width);
  let rest = BigInt(value);
  for (let i = 0; i < width; i += 1) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function checkHeadFields({ logId, treeSize, timestamp, root }) {
  if (typeof logId !== "string") throw new TypeError("log id must be a string");
  const id = encoder.encode(logId);
  if (id.length < 1 || id.length > MAX_LOG_ID_BYTES) {
    throw new TypeError("log id must be 1..64 UTF-8 bytes");
  }
  if (!Number.isSafeInteger(treeSize) || treeSize < 1) throw new TypeError("tree size must be at least 1");
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("timestamp must be unix seconds");
  if (!(root instanceof Uint8Array) || root.length !== 32) throw new TypeError("root must be 32 bytes");
  return id;
}

/** The exact bytes a head's signature covers. */
export function treeHeadPreimage(fields) {
  const id = checkHeadFields(fields);
  const parts = [encoder.encode(STH_DOMAIN), le(id.length, 2), id, le(fields.treeSize, 8), le(fields.timestamp, 8), fields.root];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Sign a head with the log's key (the ledger's `trusted_signer`). */
export function signTreeHead({ logId = LOG_ID, treeSize, timestamp, root }, signer) {
  const fields = { logId, treeSize, timestamp, root: root.slice() };
  return Object.freeze({ ...fields, signature: signer.sign(treeHeadPreimage(fields)) });
}

/** True only if `head` is well formed and signed by `publicKey`. */
export function verifyTreeHead(head, publicKey) {
  try {
    return verifyEd25519(publicKey, treeHeadPreimage(head), head.signature);
  } catch {
    return false;
  }
}

/**
 * Both heads signed by the log key, same log, and the newer one extends the
 * older (RFC 9162 consistency). This is how a holder of an old receipt checks
 * that nothing before it was dropped or changed.
 */
export function verifyHeadConsistency(older, newer, path, publicKey) {
  return (
    verifyTreeHead(older, publicKey) &&
    verifyTreeHead(newer, publicKey) &&
    older.logId === newer.logId &&
    verifyConsistency(older.treeSize, newer.treeSize, path, older.root, newer.root)
  );
}

/** JSON-safe form: hex for bytes. */
export function headToJSON(head) {
  return {
    log_id: head.logId,
    tree_size: head.treeSize,
    timestamp_unix: head.timestamp,
    root: Buffer.from(head.root).toString("hex"),
    signature: Buffer.from(head.signature).toString("hex"),
  };
}

export function headFromJSON(json) {
  const bytes = (text, length, field) => {
    if (typeof text !== "string" || !new RegExp(`^[0-9a-f]{${length * 2}}$`).test(text)) {
      throw new TypeError(`${field} must be ${length * 2} lowercase hex characters`);
    }
    return new Uint8Array(Buffer.from(text, "hex"));
  };
  const head = {
    logId: json?.log_id,
    treeSize: json?.tree_size,
    timestamp: json?.timestamp_unix,
    root: bytes(json?.root, 32, "root"),
    signature: bytes(json?.signature, 64, "signature"),
  };
  checkHeadFields(head);
  return Object.freeze(head);
}
