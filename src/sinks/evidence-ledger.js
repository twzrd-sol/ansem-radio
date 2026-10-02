/**
 * The evidence-ledger program as Radio LAN's attribution sink
 * (docs/DECISION_20261001_EVIDENCE_LEDGER.md, docs/ATTRIBUTION_LOG_V1.md).
 * Instruction and account layouts follow programs/evidence-ledger in
 * attention-oracle-program @ bd1ef2e; no code is imported from there.
 * This module builds instructions and decodes accounts. It sends nothing.
 */

import { createHash } from "node:crypto";

import { decodeBase58, encodeBase58 } from "../core/base58.js";
import { keccak256 } from "../core/keccak.js";
import { findProgramAddress } from "../core/solana.js";
import { treeHeadPreimage } from "../attribution/head.js";

export const PROGRAM_ID = "BzBAYJxUtJp6mUkJPjEYjd8vdb2FUGnAfB5X9LqrQ72W";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const ED25519_PROGRAM = "Ed25519SigVerify111111111111111111111111111";
export const INSTRUCTIONS_SYSVAR = "Sysvar1nstructions1111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const SCHEME_RFC9162 = 2;

const encoder = new TextEncoder();
const disc = (name) => new Uint8Array(createHash("sha256").update(`global:${name}`).digest().subarray(0, 8));
const accountDisc = (name) => new Uint8Array(createHash("sha256").update(`account:${name}`).digest().subarray(0, 8));
const DISC = {
  init_ledger: disc("init_ledger"),
  anchor_head: disc("anchor_head"),
  verify_inclusion: disc("verify_inclusion"),
  ledger: accountDisc("Ledger"),
  rootEntry: accountDisc("RootEntry"),
};

function u64le(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function readU64(data, offset) {
  const value = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("u64 above 2^53");
  return Number(value);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function logIdBytes(logId) {
  const bytes = encoder.encode(logId);
  if (bytes.length < 1 || bytes.length > 64) throw new TypeError("log id must be 1..64 UTF-8 bytes");
  return bytes;
}

const key = (value) => (typeof value === "string" ? decodeBase58(value) : value);
const meta = (pubkey, isSigner, isWritable) => ({ pubkey: key(pubkey), isSigner, isWritable });

/** The ledger PDA for a log id: ["ledger", keccak256(log_id)]. */
export function ledgerAddress(logId) {
  return findProgramAddress([encoder.encode("ledger"), keccak256(logIdBytes(logId))], PROGRAM_ID);
}

/** The root PDA for a head: ["root", ledger, u64le(tree_size)]. */
export function rootAddress(ledger, treeSize) {
  return findProgramAddress([encoder.encode("root"), key(ledger), u64le(treeSize)], PROGRAM_ID);
}

/**
 * init_ledger. Radio LAN's log is scheme 2; `scheme` exists so tests can pin the
 * builder to real scheme-1 ledgers. Anyone may pay; first come per log id.
 */
export function initLedgerInstruction({ payer, authority, trustedSigner, logId, scheme = SCHEME_RFC9162 }) {
  const id = logIdBytes(logId);
  if (scheme !== 1 && scheme !== SCHEME_RFC9162) throw new TypeError("scheme must be 1 or 2");
  return {
    programId: key(PROGRAM_ID),
    keys: [meta(payer, true, true), meta(ledgerAddress(logId).address, false, true), meta(SYSTEM_PROGRAM, false, false)],
    data: concat([DISC.init_ledger, key(authority), key(trustedSigner), Uint8Array.of(scheme, id.length), id]),
  };
}

/**
 * The Ed25519 precompile instruction: one signature, every offset pointing into
 * this instruction (index u16::MAX), laid out as solana-ed25519-program does:
 * [1, 0][7 x u16 offsets][public key][signature][message].
 */
export function ed25519VerifyInstruction(publicKey, signature, message) {
  const header = new Uint8Array(16);
  const view = new DataView(header.buffer);
  header[0] = 1;
  const pkOffset = 16;
  const sigOffset = pkOffset + 32;
  const msgOffset = sigOffset + 64;
  [sigOffset, 0xffff, pkOffset, 0xffff, msgOffset, message.length, 0xffff].forEach((value, i) =>
    view.setUint16(2 + 2 * i, value, true),
  );
  return { programId: key(ED25519_PROGRAM), keys: [], data: concat([header, key(publicKey), signature, message]) };
}

/**
 * The two instructions that anchor a signed head: the Ed25519 check of the
 * head's signature, then anchor_head right after it, as the program requires.
 */
export function anchorHeadInstructions({ authority, payer, trustedSigner, head }) {
  const ledger = ledgerAddress(head.logId).address;
  const root = rootAddress(ledger, head.treeSize).address;
  const id = logIdBytes(head.logId);
  return [
    ed25519VerifyInstruction(trustedSigner, head.signature, treeHeadPreimage(head)),
    {
      programId: key(PROGRAM_ID),
      keys: [
        meta(authority, true, false),
        meta(payer, true, true),
        meta(ledger, false, true),
        meta(root, false, true),
        meta(SYSTEM_PROGRAM, false, false),
        meta(INSTRUCTIONS_SYSVAR, false, false),
      ],
      data: concat([DISC.anchor_head, u64le(head.treeSize), u64le(head.timestamp), head.root, Uint8Array.of(id.length), id]),
    },
  ];
}

/**
 * SetComputeUnitLimit. The program hashes in software (about 23k compute units
 * per node, measured on devnet 2026-10-01), so the default 200k covers only
 * about six path nodes; 1.4M covers about 55.
 */
export function computeUnitLimitInstruction(units = 1_400_000) {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programId: key(COMPUTE_BUDGET_PROGRAM), keys: [], data };
}

/** verify_inclusion (scheme 2): no signers, no writes. Fails unless `entry` is at `index`. */
export function verifyInclusionInstruction({ logId, treeSize, entry, index, path }) {
  const ledger = ledgerAddress(logId).address;
  return {
    programId: key(PROGRAM_ID),
    keys: [meta(ledger, false, false), meta(rootAddress(ledger, treeSize).address, false, false)],
    data: concat([DISC.verify_inclusion, u64le(treeSize), entry, u64le(index), ...path]),
  };
}

function expectAccount(data, discriminator, length, name) {
  if (!(data instanceof Uint8Array) || data.length < length) throw new TypeError(`${name}: wrong size`);
  if (!discriminator.every((byte, i) => data[i] === byte)) throw new TypeError(`${name}: wrong discriminator`);
}

/** Decode a Ledger account (128 bytes). */
export function decodeLedger(data) {
  expectAccount(data, DISC.ledger, 128, "ledger");
  return {
    version: data[8],
    bump: data[9],
    scheme: data[10],
    authority: encodeBase58(data.slice(11, 43)),
    logIdHash: data.slice(43, 75),
    trustedSigner: encodeBase58(data.slice(75, 107)),
    lastSeq: readU64(data, 107),
    count: readU64(data, 115),
  };
}

/** Decode a RootEntry account (152 bytes). */
export function decodeRootEntry(data) {
  expectAccount(data, DISC.rootEntry, 152, "root entry");
  return {
    version: data[8],
    bump: data[9],
    seq: readU64(data, 10),
    root: data.slice(18, 50),
    auxHash: data.slice(50, 82),
    leafCount: readU64(data, 82),
    signedTimestamp: readU64(data, 90),
    publishedSlot: readU64(data, 98),
    publishedUnix: readU64(data, 106),
    publisher: encodeBase58(data.slice(114, 146)),
  };
}
