/**
 * RFC 9162 (Certificate Transparency v2) Merkle tree over Keccak-256, the rule
 * the evidence-ledger program verifies (`verify_inclusion_rfc9162` in
 * programs/evidence-ledger/src/merkle.rs):
 *
 *   LeafHash(entry)  = keccak256(0x00 || entry)
 *   NodeHash(l, r)   = keccak256(0x01 || l || r)
 *
 * Entries are the record's 32-byte commitments in log order. Paths list nodes
 * from the leaf up. Every check takes `treeSize` from a signed head: an
 * inclusion path does not always bind the size by itself.
 *
 * Roots are recomputed in O(n). Fine for thousands of entries; an incremental
 * root is a later change if the log grows past that.
 */

import { keccak256 } from "../core/keccak.js";

/** Longest path the program accepts (2^32 entries). */
export const MAX_PATH = 32;

const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

function is32(value) {
  return value instanceof Uint8Array && value.length === 32;
}

function same(a, b) {
  return is32(a) && is32(b) && a.every((byte, i) => byte === b[i]);
}

function sizeOk(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

export function leafHash(entry) {
  if (!is32(entry)) throw new TypeError("a log entry must be 32 bytes");
  return keccak256(LEAF_PREFIX, entry);
}

export function nodeHash(left, right) {
  return keccak256(NODE_PREFIX, left, right);
}

// Largest power of two strictly below n (n >= 2).
function split(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function entriesOf(entries, treeSize) {
  if (!Array.isArray(entries) || !entries.every(is32)) throw new TypeError("entries must be 32-byte arrays");
  if (!sizeOk(treeSize) || treeSize > entries.length) throw new RangeError("tree size must be 1..entries.length");
  return entries;
}

function mth(entries, start, end) {
  if (end - start === 1) return leafHash(entries[start]);
  const k = split(end - start);
  return nodeHash(mth(entries, start, start + k), mth(entries, start + k, end));
}

/** Root of the first `treeSize` entries (all of them by default). Empty trees are refused, as on-chain. */
export function treeRoot(entries, treeSize = entries?.length) {
  return mth(entriesOf(entries, treeSize), 0, treeSize);
}

/** RFC 9162 2.1.3.1: the inclusion path for `index` in the tree of the first `treeSize` entries. */
export function inclusionPath(entries, index, treeSize = entries?.length) {
  entriesOf(entries, treeSize);
  if (!Number.isSafeInteger(index) || index < 0 || index >= treeSize) throw new RangeError("index out of range");
  const path = [];
  (function walk(m, start, end) {
    if (end - start === 1) return;
    const k = split(end - start);
    if (m < k) {
      walk(m, start, start + k);
      path.push(mth(entries, start + k, end));
    } else {
      walk(m - k, start + k, end);
      path.push(mth(entries, start, start + k));
    }
  })(index, 0, treeSize);
  return path;
}

/**
 * RFC 9162 2.1.3.2, step for step as the program runs it. True only if `entry`
 * sits at `index` in a tree of `treeSize` entries with this `root`.
 */
export function verifyInclusion(entry, index, treeSize, path, root) {
  if (!is32(entry) || !is32(root) || !sizeOk(treeSize)) return false;
  if (!Number.isSafeInteger(index) || index < 0 || index >= treeSize) return false;
  if (!Array.isArray(path) || path.length > MAX_PATH || !path.every(is32)) return false;
  let fn = index;
  let sn = treeSize - 1;
  let r = leafHash(entry);
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      r = nodeHash(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && same(r, root);
}

/** RFC 9162 2.1.4.1: proof that the first `oldSize` entries are a prefix of the first `newSize`. */
export function consistencyPath(entries, oldSize, newSize = entries?.length) {
  entriesOf(entries, newSize);
  if (!sizeOk(oldSize) || oldSize > newSize) throw new RangeError("old size must be 1..new size");
  const path = [];
  (function subproof(m, start, end, whole) {
    if (m === end - start) {
      if (!whole) path.push(mth(entries, start, end));
      return;
    }
    const k = split(end - start);
    if (m <= k) {
      subproof(m, start, start + k, whole);
      path.push(mth(entries, start + k, end));
    } else {
      subproof(m - k, start + k, end, false);
      path.push(mth(entries, start, start + k));
    }
  })(oldSize, 0, newSize, true);
  return path;
}

/**
 * RFC 9162 2.1.4.2. True only if a tree of `oldSize` with `oldRoot` is a prefix
 * of a tree of `newSize` with `newRoot`. Equal sizes need an empty path and
 * equal roots. The program does not run this; anyone holding two heads can.
 */
export function verifyConsistency(oldSize, newSize, path, oldRoot, newRoot) {
  if (!sizeOk(oldSize) || !sizeOk(newSize) || oldSize > newSize) return false;
  if (!is32(oldRoot) || !is32(newRoot)) return false;
  if (!Array.isArray(path) || path.length > 2 * MAX_PATH || !path.every(is32)) return false;
  if (oldSize === newSize) return path.length === 0 && same(oldRoot, newRoot);
  if (path.length === 0) return false;

  const nodes = (oldSize & (oldSize - 1)) === 0 ? [oldRoot, ...path] : path;
  let fn = oldSize - 1;
  let sn = newSize - 1;
  while (fn % 2 === 1) {
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  let fr = nodes[0];
  let sr = nodes[0];
  for (const c of nodes.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = nodeHash(c, fr);
      sr = nodeHash(c, sr);
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      sr = nodeHash(sr, c);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return same(fr, oldRoot) && same(sr, newRoot) && sn === 0;
}
