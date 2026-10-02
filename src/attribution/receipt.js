/**
 * Inclusion receipts: what each signer keeps (design v3.1, section 3). A receipt
 * is self-contained. With it and the log's public key, anyone can check the
 * claim text, both parties' signatures, the salted commitment, the head's
 * signature and the entry's place in the head's tree, without the server.
 * Whether that head was anchored on-chain is a separate check (PR 7).
 *
 * The receipt carries the salt, so the holder can always link their own entry
 * to the log. Erasure on the server does not reach a receipt already issued.
 */

import { ClaimError, LOG_ID } from "./claim.js";
import { headFromJSON, headToJSON, verifyTreeHead } from "./head.js";
import { entryCommitment, recordDigest, verifySignedClaim } from "./record.js";
import { inclusionPath, treeRoot, verifyInclusion } from "./tree.js";

const hex = (bytes) => Buffer.from(bytes).toString("hex");

function fromHex(text, length, field) {
  if (typeof text !== "string" || text.length !== length * 2 || !/^[0-9a-f]*$/.test(text)) {
    throw new ClaimError(`${field} must be ${length * 2} lowercase hex characters`);
  }
  return new Uint8Array(Buffer.from(text, "hex"));
}

/** A receipt for a live entry under `head`, which must cover it and match the record. */
export function issueReceipt(record, index, head) {
  const entry = record.entry(index);
  if (!entry || entry.erased) throw new ClaimError("no live entry at that index");
  if (index >= head.treeSize) throw new ClaimError("the head does not cover this entry");
  const commitments = record.commitments();
  if (head.treeSize > commitments.length || hex(treeRoot(commitments, head.treeSize)) !== hex(head.root)) {
    throw new ClaimError("the head does not match this record");
  }
  return {
    v: 1,
    index,
    text: entry.text,
    signatures: entry.signatures.map(hex),
    appended_at: entry.appended_at,
    salt: hex(entry.salt),
    commitment: hex(entry.commitment),
    path: inclusionPath(commitments, index, head.treeSize).map(hex),
    head: headToJSON(head),
  };
}

/**
 * Check a receipt against the log's public key. Returns { ok: true, claim,
 * claim_id, index, head } or { ok: false, reason }; never throws.
 */
export function verifyReceipt(receipt, logPublicKey, { network } = {}) {
  try {
    if (receipt?.v !== 1) throw new ClaimError("unknown receipt version");
    const head = headFromJSON(receipt.head);
    if (head.logId !== LOG_ID) throw new ClaimError("the head is for another log");
    if (!verifyTreeHead(head, logPublicKey)) throw new ClaimError("head signature does not verify");

    if (!Array.isArray(receipt.signatures) || receipt.signatures.length < 1 || receipt.signatures.length > 2) {
      throw new ClaimError("signatures must be one or two");
    }
    const [creatorSignature, collaboratorSignature] = receipt.signatures.map((sig) => fromHex(sig, 64, "signature"));
    const { claim, id, signatures } = verifySignedClaim(receipt.text, creatorSignature, collaboratorSignature, network);

    const salt = fromHex(receipt.salt, 32, "salt");
    const commitment = entryCommitment(salt, recordDigest(receipt.text, signatures, receipt.appended_at));
    if (hex(commitment) !== receipt.commitment) throw new ClaimError("commitment does not match the claim");

    if (!Array.isArray(receipt.path)) throw new ClaimError("path must be a list");
    const path = receipt.path.map((node) => fromHex(node, 32, "path node"));
    if (!verifyInclusion(commitment, receipt.index, head.treeSize, path, head.root)) {
      throw new ClaimError("the entry is not in the head's tree");
    }
    return { ok: true, claim, claim_id: id, index: receipt.index, head };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}
