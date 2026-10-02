/**
 * Attribution claims: the exact text a creator and a collaborator sign in their
 * own wallets. Plain UTF-8, so a wallet shows the signer what they are signing
 * (design v3.1, sections 1 and 3). Canonical or rejected: a claim is parsed,
 * re-rendered and must match byte for byte, so a third-party verifier never has
 * to guess which bytes were signed. The canonical format is defined below.
 */

import { decodePublicKey } from "../core/base58.js";
import { keccak256 } from "../core/keccak.js";

export const LOG_ID = "radiolan.attribution.v1";
export const NETWORKS = Object.freeze(["devnet", "mainnet"]);
// Tier 1 work items only (v3.1 section 1). Raid organizing and scene hosting wait.
export const WORK_TYPES = Object.freeze(["clip", "edit", "guest_segment"]);

const HEADER = "Radio LAN attribution";
const CLAIM_DOMAIN = "RADIOLAN:ATTRIBUTION_CLAIM_V1";
const HEX32 = /^[0-9a-f]{64}$/;

const FIELDS = Object.freeze({
  credit: ["version", "action", "network", "log", "creator", "binding", "work", "scope", "deliverable", "collaborator"],
  revoke: ["version", "action", "network", "log", "creator", "binding", "revokes"],
});

export class ClaimError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClaimError";
  }
}

function hex32(value, field) {
  if (typeof value !== "string" || !HEX32.test(value)) {
    throw new ClaimError(`${field} must be 64 lowercase hex characters`);
  }
  return value;
}

function wallet(value, field) {
  try {
    decodePublicKey(value, field);
  } catch (error) {
    throw new ClaimError(error.message);
  }
  return value;
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new ClaimError(`${field} must be one of ${allowed.join(", ")}`);
  return value;
}

function normalize(input) {
  if (!input || typeof input !== "object") throw new ClaimError("claim must be an object");
  const action = oneOf(input.action, Object.keys(FIELDS), "action");
  const claim = {
    version: "1",
    action,
    network: oneOf(input.network, NETWORKS, "network"),
    log: LOG_ID,
    creator: wallet(input.creator, "creator"),
    binding: hex32(input.binding, "binding"),
  };
  if (input.version !== undefined && input.version !== "1") throw new ClaimError("claim version must be 1");
  if (input.log !== undefined && input.log !== LOG_ID) throw new ClaimError(`log must be ${LOG_ID}`);
  if (action === "credit") {
    claim.work = oneOf(input.work, WORK_TYPES, "work");
    claim.scope = hex32(input.scope, "scope");
    claim.deliverable = hex32(input.deliverable, "deliverable");
    claim.collaborator = wallet(input.collaborator, "collaborator");
    if (claim.collaborator === claim.creator) throw new ClaimError("collaborator must not be the creator");
  } else {
    claim.revokes = hex32(input.revokes, "revokes");
  }
  const extra = Object.keys(input).filter((key) => !FIELDS[action].includes(key));
  if (extra.length > 0) throw new ClaimError(`unknown claim fields: ${extra.join(", ")}`);
  return claim;
}

function render(claim) {
  return [HEADER, ...FIELDS[claim.action].map((field) => `${field}: ${claim[field]}`)].join("\n") + "\n";
}

/** The canonical text for a claim object. Both signers sign these exact bytes. */
export function claimText(input) {
  return render(normalize(input));
}

/** Parse canonical claim text. Throws ClaimError unless re-rendering gives the same text. */
export function parseClaimText(text) {
  if (typeof text !== "string") throw new ClaimError("claim text must be a string");
  const lines = text.split("\n");
  if (lines.pop() !== "" || lines.shift() !== HEADER) throw new ClaimError("claim text is not canonical");
  const input = {};
  for (const line of lines) {
    const at = line.indexOf(": ");
    if (at < 1) throw new ClaimError("claim text is not canonical");
    const field = line.slice(0, at);
    if (Object.hasOwn(input, field)) throw new ClaimError(`duplicate claim field: ${field}`);
    input[field] = line.slice(at + 2);
  }
  if (input.version !== "1") throw new ClaimError("claim version must be 1");
  const claim = normalize(input);
  if (render(claim) !== text) throw new ClaimError("claim text is not canonical");
  return Object.freeze(claim);
}

/**
 * The claim's id: keccak256 over a domain tag and the claim text, as 64 hex.
 * A revoke names the credit it cancels by this id; it needs no index or salt.
 */
export function claimId(text) {
  return Buffer.from(keccak256(CLAIM_DOMAIN, text)).toString("hex");
}
