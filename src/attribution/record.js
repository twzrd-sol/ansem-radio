/**
 * The attribution record: an append-only list of signed claims, each committed
 * as a salted 32-byte value for the evidence-ledger log
 *. It holds creators and collaborators who signed,
 * never viewers, participant ids or Twitch data.
 *
 * Not here yet: the binding check (v3.1 section 2 is not built, so `binding`
 * is trusted as opaque bytes), receipts and the tree (PR 6), on-chain anchoring
 * (PR 7). Erasure is an operator action and is not authenticated here.
 */

import { randomBytes } from "node:crypto";

import { decodePublicKey } from "../core/base58.js";
import { verifyEd25519 } from "../core/ed25519.js";
import { keccak256 } from "../core/keccak.js";
import { ClaimError, claimId, parseClaimText } from "./claim.js";

export const RECORD_DOMAIN = "RADIOLAN:ATTRIBUTION_RECORD_V1";
export const ENTRY_DOMAIN = "RADIOLAN:ATTRIBUTION_ENTRY_V1";

const HEX = (bytes) => Buffer.from(bytes).toString("hex");
const encoder = new TextEncoder();

function fromHex(text, length, field) {
  if (typeof text !== "string" || text.length !== length * 2 || !/^[0-9a-f]*$/.test(text)) {
    throw new ClaimError(`${field} must be ${length * 2} lowercase hex characters`);
  }
  return new Uint8Array(Buffer.from(text, "hex"));
}

function u32le(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64le(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function unixSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ClaimError("appended_at must be unix seconds");
  return value;
}

/**
 * keccak256(RECORD_DOMAIN || u32le(len(text)) || text || u8(count) || signatures || u64le(appended_at)).
 * The parties sign the claim text; `appended_at` is the server's clock and is
 * covered here but signed by neither party.
 */
export function recordDigest(text, signatures, appendedAt) {
  const claimBytes = encoder.encode(text);
  return keccak256(
    RECORD_DOMAIN,
    u32le(claimBytes.length),
    claimBytes,
    new Uint8Array([signatures.length]),
    ...signatures,
    u64le(unixSeconds(appendedAt)),
  );
}

/** keccak256(ENTRY_DOMAIN || salt || record_digest): the 32 bytes the log holds. */
export function entryCommitment(salt, digest) {
  return keccak256(ENTRY_DOMAIN, salt, digest);
}

function signature(value, field) {
  if (!(value instanceof Uint8Array) || value.length !== 64) throw new ClaimError(`${field} must be 64 bytes`);
  return value;
}

/**
 * The checks one signed claim needs on its own, with no record: canonical text,
 * the expected network, and the signature of each party over the exact text.
 * Returns { claim, id, signatures }. Throws ClaimError otherwise.
 */
export function verifySignedClaim(text, creatorSignature, collaboratorSignature, network) {
  const claim = parseClaimText(text);
  if (claim.network !== network) throw new ClaimError(`claim is for ${claim.network}, record is ${network}`);
  const message = encoder.encode(text);
  const id = claimId(text);
  if (!verifyEd25519(decodePublicKey(claim.creator), message, signature(creatorSignature, "creator signature"))) {
    throw new ClaimError("creator signature does not verify");
  }
  if (claim.action === "revoke") {
    if (collaboratorSignature !== undefined) throw new ClaimError("a revoke is signed by the creator only");
    return { claim, id, signatures: [creatorSignature] };
  }
  const cosign = signature(collaboratorSignature, "collaborator signature");
  if (!verifyEd25519(decodePublicKey(claim.collaborator), message, cosign)) {
    throw new ClaimError("collaborator signature does not verify");
  }
  return { claim, id, signatures: [creatorSignature, cosign] };
}

function build({
  network,
  now = () => Math.floor(Date.now() / 1000),
  randomSalt = () => new Uint8Array(randomBytes(32)),
} = {}) {
  if (network !== "devnet" && network !== "mainnet") throw new ClaimError("network must be devnet or mainnet");

  const entries = []; // in log order; an erased entry keeps only its commitment
  const credits = new Map(); // claim id -> index of a live credit
  const revokedBy = new Map(); // credit claim id -> index of the revoke naming it

  function check(text, creatorSignature, collaboratorSignature) {
    const checked = verifySignedClaim(text, creatorSignature, collaboratorSignature, network);
    const { claim, id } = checked;
    if (claim.action === "credit") {
      if (credits.has(id)) throw new ClaimError("this credit is already in the record");
      return checked;
    }
    const target = credits.get(claim.revokes);
    if (target === undefined) throw new ClaimError("revoke names no live credit in this record");
    const credit = entries[target].claim;
    if (credit.creator !== claim.creator || credit.binding !== claim.binding) {
      throw new ClaimError("only the crediting wallet and binding can revoke");
    }
    if (revokedBy.has(claim.revokes)) throw new ClaimError("this credit is already revoked");
    return checked;
  }

  function push({ claim, id, signatures: given }, text, appendedAt, givenSalt) {
    // Copies, so a caller's buffers cannot change a stored entry.
    const signatures = given.map((sig) => sig.slice());
    const salt = givenSalt.slice();
    const digest = recordDigest(text, signatures, appendedAt);
    const entry = Object.freeze({
      index: entries.length,
      claim,
      claim_id: id,
      text,
      signatures: Object.freeze(signatures),
      appended_at: appendedAt,
      salt,
      commitment: entryCommitment(salt, digest),
    });
    entries.push(entry);
    if (claim.action === "credit") credits.set(id, entry.index);
    else revokedBy.set(claim.revokes, entry.index);
    return entry;
  }

  function salt32(value) {
    if (!(value instanceof Uint8Array) || value.length !== 32) throw new ClaimError("salt must be 32 bytes");
    return value;
  }

  function restore(line, number) {
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new ClaimError(`line ${number}: not JSON`);
    }
    if (raw?.v !== 1 || raw.index !== entries.length) throw new ClaimError(`line ${number}: wrong version or index`);
    const commitment = fromHex(raw.commitment, 32, "commitment");
    if (raw.erased === true) {
      entries.push(Object.freeze({ index: raw.index, erased: true, commitment }));
      return;
    }
    if (!Array.isArray(raw.signatures) || raw.signatures.length < 1 || raw.signatures.length > 2) {
      throw new ClaimError(`line ${number}: signatures must be one or two`);
    }
    const [creatorSignature, collaboratorSignature] = raw.signatures.map((sig) => fromHex(sig, 64, "signature"));
    const checked = check(raw.text, creatorSignature, collaboratorSignature);
    const entry = push(checked, raw.text, unixSeconds(raw.appended_at), fromHex(raw.salt, 32, "salt"));
    if (HEX(entry.commitment) !== raw.commitment) {
      throw new ClaimError(`line ${number}: commitment does not match the entry`);
    }
  }

  const record = Object.freeze({
    network,

    /** Append a signed claim. Throws ClaimError and changes nothing if any check fails. */
    append({ text, creatorSignature, collaboratorSignature }) {
      const checked = check(text, creatorSignature, collaboratorSignature);
      return push(checked, text, unixSeconds(now()), salt32(randomSalt()));
    },

    /**
     * Erase a credit and every revoke naming it, or a revoke and the credit it
     * names: erasing only a revoke would reinstate the credit. Bodies and salts
     * go; commitments stay, so heads and proofs still verify.
     */
    erase(index) {
      const entry = entries[index];
      if (!entry || entry.erased) throw new ClaimError("no live entry at that index");
      const creditId = entry.claim.action === "credit" ? entry.claim_id : entry.claim.revokes;
      const thread = [credits.get(creditId), revokedBy.get(creditId)].filter((i) => i !== undefined);
      for (const i of thread) {
        entries[i] = Object.freeze({ index: i, erased: true, commitment: entries[i].commitment });
      }
      credits.delete(creditId);
      revokedBy.delete(creditId);
      return thread.sort((a, b) => a - b);
    },

    /** Commitments in log order, erased entries included. This is what the tree hashes. */
    commitments() {
      return entries.map((entry) => entry.commitment.slice());
    },

    entry(index) {
      return entries[index];
    },

    get size() {
      return entries.length;
    },

    /** Whether a credit is live and not revoked. */
    isCredited(id) {
      return credits.has(id) && !revokedBy.has(id);
    },

    /** One JSON line per entry, for storage. Loading re-verifies all of it. */
    toLines() {
      return entries.map((entry) =>
        JSON.stringify(
          entry.erased
            ? { v: 1, index: entry.index, erased: true, commitment: HEX(entry.commitment) }
            : {
                v: 1,
                index: entry.index,
                text: entry.text,
                signatures: entry.signatures.map(HEX),
                appended_at: entry.appended_at,
                salt: HEX(entry.salt),
                commitment: HEX(entry.commitment),
              },
        ),
      );
    },

  });
  return { record, restore };
}

/**
 * An empty record for one network. `now` returns unix seconds and `randomSalt`
 * 32 bytes; both are injectable so tests and fixtures are reproducible.
 */
export function createAttributionRecord(options) {
  return build(options).record;
}

/** Rebuild a record from stored lines, re-checking every signature and commitment. */
export function loadAttributionRecord(lines, options) {
  const { record, restore } = build(options);
  lines.forEach((line, i) => restore(line, i + 1));
  return record;
}
