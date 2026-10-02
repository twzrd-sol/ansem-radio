/**
 * The attribution log: the record plus the log key that signs heads. Every
 * append signs a new head and returns the receipt for both signers at once, so
 * nobody waits for an on-chain anchor to hold proof of their entry (v3.1,
 * section 3). Anchoring a head on-chain is PR 7; this file never touches the
 * network.
 *
 * Append through the log, not the record, or entries go unsigned by any head.
 */

import { ClaimError } from "./claim.js";
import { createAttributionRecord, loadAttributionRecord } from "./record.js";
import { signTreeHead } from "./head.js";
import { issueReceipt } from "./receipt.js";
import { consistencyPath, inclusionPath, treeRoot } from "./tree.js";

const defaultNow = () => Math.floor(Date.now() / 1000);

function checkSigner(headSigner) {
  if (!(headSigner?.publicKey instanceof Uint8Array) || typeof headSigner.sign !== "function") {
    throw new TypeError("headSigner must have publicKey and sign()");
  }
  return headSigner;
}

function wrap(record, headSigner, now) {
  let latest = null;

  function signHead() {
    if (record.size === 0) throw new ClaimError("an empty log has no head");
    latest = signTreeHead({ treeSize: record.size, timestamp: now(), root: treeRoot(record.commitments()) }, headSigner);
    return latest;
  }

  return Object.freeze({
    network: record.network,
    publicKey: headSigner.publicKey.slice(),

    /** Append a signed claim, sign a head over it, and return the entry, head and receipt. */
    append(signedClaim) {
      const entry = record.append(signedClaim);
      const head = signHead();
      return { entry, head, receipt: issueReceipt(record, entry.index, head) };
    },

    /** Sign a fresh head over the whole log, e.g. after loading or before anchoring. */
    signHead,

    /** The latest head signed by this process, or null. */
    head() {
      return latest;
    },

    /** A receipt for `index` under the latest head. */
    receipt(index) {
      if (!latest) throw new ClaimError("no head yet; call signHead()");
      return issueReceipt(record, index, latest);
    },

    /** Inclusion path for `index` in the tree of the first `treeSize` entries. */
    inclusion(index, treeSize = record.size) {
      return inclusionPath(record.commitments(), index, treeSize);
    },

    /** Proof that the log at `oldSize` is a prefix of the log at `newSize`. */
    consistency(oldSize, newSize = record.size) {
      return consistencyPath(record.commitments(), oldSize, newSize);
    },

    erase: (index) => record.erase(index),
    entry: (index) => record.entry(index),
    isCredited: (id) => record.isCredited(id),
    commitments: () => record.commitments(),
    toLines: () => record.toLines(),
    get size() {
      return record.size;
    },
  });
}

export function createAttributionLog({ network, headSigner, now = defaultNow, randomSalt } = {}) {
  checkSigner(headSigner);
  return wrap(createAttributionRecord({ network, now, randomSalt }), headSigner, now);
}

/** Reload from stored record lines (fully re-verified). No head until signHead() or the next append. */
export function loadAttributionLog(lines, { network, headSigner, now = defaultNow, randomSalt } = {}) {
  checkSigner(headSigner);
  return wrap(loadAttributionRecord(lines, { network, now, randomSalt }), headSigner, now);
}
