/**
 * Client for the Radio LAN attribution rewards vault (programs/radiolan-rewards).
 * Builds init, prove, claim and withdraw instructions in the program's byte layout,
 * derives its addresses and decodes vault accounts. Sends nothing.
 *
 * A reward takes two transactions, so each fits Solana's 1,232-byte packet however
 * large the log grows: prove (commitment + inclusion path) then claim (text + signatures).
 */

import { decodeBase58, encodeBase58 } from "../core/base58.js";
import { findProgramAddress } from "../core/solana.js";
import { LOG_ID } from "../attribution/claim.js";
import { entryCommitment, recordDigest } from "../attribution/record.js";
import { PROGRAM_ID as EVIDENCE_LEDGER_ID, computeUnitLimitInstruction, ledgerAddress, rootAddress } from "./evidence-ledger.js";

export const REWARDS_PROGRAM_ID_DEVNET = "5AKkruu8yQSmGLwtD8aRSczjxVxKTSarTzNDEEPhf4jC";
export const REWARDS_PROGRAM_ID_MAINNET = "5wAVbHfZCBrYPymk1FNeV4D69iZioUmZaiE4ki4qrqWD";
/** Default remains the shipped JS client: the devnet program. Pass `programId` for mainnet. */
export const REWARDS_PROGRAM_ID = REWARDS_PROGRAM_ID_DEVNET;
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const VAULT_LEN = 160;
export const ATTESTATION_LEN = 16;
export const STATION_LEN = 40;
export const TASK_CLAIMED_LEN = 16;
/** 100,000 tokens at 6 decimals. Per-claim and global cap for claim_task_book. */
export const TASK_BOOK_CAP = 100_000_000_000n;
export const TASK_BOOK_CLAIM_DOMAIN = "RADIOLAN:TASK_BOOK_CLAIM_V1";
const MAGIC = "RLVAULT1";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

const key = (value) => (typeof value === "string" ? decodeBase58(value) : value);
const meta = (pubkey, isSigner, isWritable) => ({ pubkey: key(pubkey), isSigner, isWritable });
const utf8 = (text) => new TextEncoder().encode(text);
const hexBytes = (text, length, field) => {
  if (typeof text !== "string" || !new RegExp(`^[0-9a-f]{${length * 2}}$`).test(text)) throw new TypeError(`${field} must be ${length * 2} hex characters`);
  return new Uint8Array(Buffer.from(text, "hex"));
};
function le(value, width) {
  const out = new Uint8Array(width);
  const view = new DataView(out.buffer);
  if (width === 8) view.setBigUint64(0, BigInt(value), true);
  else if (width === 4) view.setUint32(0, value, true);
  else if (width === 2) view.setUint16(0, value, true);
  return out;
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function vaultAddress(admin, mint, programId = REWARDS_PROGRAM_ID) {
  return findProgramAddress([utf8("vault"), key(admin), key(mint)], programId);
}
export function vaultTokensAddress(vault, programId = REWARDS_PROGRAM_ID) {
  return findProgramAddress([utf8("vault_tokens"), key(vault)], programId);
}
export function stationAddress(vault, programId = REWARDS_PROGRAM_ID) {
  return findProgramAddress([utf8("station"), key(vault)], programId);
}
export function taskClaimedAddress(vault, wallet, programId = REWARDS_PROGRAM_ID) {
  return findProgramAddress([utf8("task_claimed"), key(vault), key(wallet)], programId);
}
export function associatedTokenAddress(wallet, mint, tokenProgram = TOKEN_PROGRAM_ID) {
  return findProgramAddress([key(wallet), key(tokenProgram), key(mint)], ASSOCIATED_TOKEN_PROGRAM_ID);
}
/** Domain-separated payload the station signs: program, vault, wallet, cumulative, nonce. */
export function taskBookClaimMessage({ programId = REWARDS_PROGRAM_ID, vault, wallet, cumulativeAmount, nonce }) {
  return concat([utf8(TASK_BOOK_CLAIM_DOMAIN), key(programId), key(vault), key(wallet), le(cumulativeAmount, 8), le(nonce, 8)]);
}
/**
 * The attestation `prove` leaves: an account at this address owned by the rewards program means
 * `commitment` was proven into `ledger`'s anchored head. Shared by every vault on that ledger.
 */
export function attestationAddress(ledger, commitment) {
  return findProgramAddress([utf8("included"), key(ledger), commitment], REWARDS_PROGRAM_ID);
}
/** The marker that records a credit as paid; it exists once the credit's reward is claimed. */
export function claimedAddress(vault, commitment) {
  return findProgramAddress([utf8("claimed"), key(vault), commitment], REWARDS_PROGRAM_ID);
}
/** The per-creator counter for one epoch: floor(appended_at / epoch_seconds). */
export function epochAddress(vault, creator, epoch) {
  return findProgramAddress([utf8("epoch"), key(vault), key(creator), le(epoch, 8)], REWARDS_PROGRAM_ID);
}

/** The creator and collaborator a credit names (base58). */
export function partiesOf(claimText) {
  const one = (field) => {
    const lines = claimText.split("\n").filter((l) => l.startsWith(`${field}: `));
    if (lines.length !== 1) throw new TypeError(`claim text must name exactly one ${field}`);
    return lines[0].slice(field.length + 2);
  };
  if (one("action") !== "credit") throw new TypeError("only a credit earns a reward");
  return { creator: one("creator"), collaborator: one("collaborator") };
}

/** The 32 bytes the log holds for a receipt, recomputed; throws if the receipt's own `commitment` disagrees. */
export function receiptCommitment(receipt) {
  const signatures = receipt.signatures.map((s) => hexBytes(s, 64, "signature"));
  const commitment = entryCommitment(hexBytes(receipt.salt, 32, "salt"), recordDigest(receipt.text, signatures, receipt.appended_at));
  if (receipt.commitment && Buffer.from(commitment).toString("hex") !== receipt.commitment) throw new TypeError("receipt commitment does not match its record");
  return commitment;
}

/**
 * Open a vault for `mint`: `rewardPerCredit` base units per credit, at most `capPerEpoch`
 * paid credits per creator per `epochSeconds` of the log's server time.
 */
export function initVaultInstruction({ admin, mint, rewardPerCredit, capPerEpoch, epochSeconds, ledger = ledgerAddress(LOG_ID).address, programId = REWARDS_PROGRAM_ID }) {
  if (!(rewardPerCredit > 0 && capPerEpoch > 0 && epochSeconds > 0)) throw new TypeError("reward, cap and epoch must be positive");
  const vault = vaultAddress(admin, mint, programId).address;
  return {
    programId: key(programId),
    keys: [
      meta(admin, true, true),
      meta(vault, false, true),
      meta(vaultTokensAddress(vault, programId).address, false, true),
      meta(mint, false, false),
      meta(SYSTEM_PROGRAM, false, false),
      meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data: concat([Uint8Array.of(0), key(ledger), le(rewardPerCredit, 8), le(capPerEpoch, 4), le(epochSeconds, 8)]),
  };
}

/**
 * Prove a receipt's commitment into the log's anchored head (any payer; the payer funds the
 * attestation's rent). Returns [compute budget, prove]: inclusion costs ~23k compute units per
 * path node. A credit proven once can be claimed from every vault on the same ledger.
 */
export function proveInstructions({ payer, receipt, ledger = ledgerAddress(LOG_ID).address }) {
  const commitment = receiptCommitment(receipt);
  const treeSize = receipt.head.tree_size;
  const data = concat([
    Uint8Array.of(3),
    le(treeSize, 8),
    le(receipt.index, 8),
    commitment,
    Uint8Array.of(receipt.path.length),
    ...receipt.path.map((n) => hexBytes(n, 32, "path node")),
  ]);
  return [
    computeUnitLimitInstruction(),
    {
      programId: key(REWARDS_PROGRAM_ID),
      keys: [
        meta(payer, true, true),
        meta(attestationAddress(ledger, commitment).address, false, true),
        meta(ledger, false, false),
        meta(rootAddress(key(ledger), treeSize).address, false, false),
        meta(EVIDENCE_LEDGER_ID, false, false),
        meta(SYSTEM_PROGRAM, false, false),
      ],
      data,
    },
  ];
}

/**
 * Claim one proven credit's reward into `destination`, a token account the collaborator owns for
 * the vault's mint. `vault` is the decoded vault (decodeVault) at `vaultAddress`. Any payer may
 * send it (the payer funds the marker and counter rent); it fits the default compute budget.
 */
export function claimRewardInstruction({ payer, vault, vaultAddress: address, destination, receipt }) {
  if (receipt.signatures?.length !== 2) throw new TypeError("a credit receipt carries two signatures");
  const { creator, collaborator } = partiesOf(receipt.text);
  const commitment = receiptCommitment(receipt);
  const text = utf8(receipt.text);
  const epoch = Math.floor(receipt.appended_at / vault.epoch_seconds);
  const data = concat([
    Uint8Array.of(1),
    key(creator),
    key(collaborator),
    le(receipt.appended_at, 8),
    hexBytes(receipt.salt, 32, "salt"),
    ...receipt.signatures.map((s) => hexBytes(s, 64, "signature")),
    le(text.length, 2),
    text,
  ]);
  return {
    programId: key(REWARDS_PROGRAM_ID),
    keys: [
      meta(payer, true, true),
      meta(address, false, true),
      meta(vaultTokensAddress(address).address, false, true),
      meta(destination, false, true),
      meta(attestationAddress(vault.ledger, commitment).address, false, false),
      meta(claimedAddress(address, commitment).address, false, true),
      meta(epochAddress(address, creator, epoch).address, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
      meta(SYSTEM_PROGRAM, false, false),
    ],
    data,
  };
}

/** Admin sets the station key that must sign every `claim_task_book`. */
export function setStationCosignerInstruction({ admin, mint, cosigner, programId = REWARDS_PROGRAM_ID }) {
  const vault = vaultAddress(admin, mint, programId).address;
  return {
    programId: key(programId),
    keys: [
      meta(admin, true, true),
      meta(vault, false, false),
      meta(stationAddress(vault, programId).address, false, true),
      meta(SYSTEM_PROGRAM, false, false),
    ],
    data: concat([Uint8Array.of(4), key(cosigner)]),
  };
}

/**
 * Pay `cumulativeAmount - already_claimed` to `destination` (the wallet's token account for the vault mint).
 * `cosigner` must match the key stored by `set_station_cosigner` and must sign the transaction.
 */
export function claimTaskBookInstruction({
  payer,
  admin,
  mint,
  wallet,
  destination,
  cosigner,
  cumulativeAmount,
  nonce,
  programId = REWARDS_PROGRAM_ID,
}) {
  const n = BigInt(cumulativeAmount);
  if (n < 0n || n > TASK_BOOK_CAP) throw new RangeError("cumulative amount is outside the task-book cap");
  const vault = vaultAddress(admin, mint, programId).address;
  return {
    programId: key(programId),
    keys: [
      meta(payer, true, true),
      meta(vault, false, true),
      meta(vaultTokensAddress(vault, programId).address, false, true),
      meta(wallet, false, false),
      meta(destination, false, true),
      meta(taskClaimedAddress(vault, wallet, programId).address, false, true),
      meta(stationAddress(vault, programId).address, false, false),
      meta(cosigner, true, false),
      meta(TOKEN_PROGRAM_ID, false, false),
      meta(SYSTEM_PROGRAM, false, false),
    ],
    data: concat([Uint8Array.of(5), key(wallet), le(n, 8), le(nonce, 8)]),
  };
}

/** Withdraw `amount` base units from the vault to `destination`: the admin's alone. */
export function withdrawInstruction({ admin, mint, destination, amount, programId = REWARDS_PROGRAM_ID }) {
  const vault = vaultAddress(admin, mint, programId).address;
  return {
    programId: key(programId),
    keys: [meta(admin, true, false), meta(vault, false, false), meta(vaultTokensAddress(vault, programId).address, false, true), meta(destination, false, true), meta(TOKEN_PROGRAM_ID, false, false)],
    data: concat([Uint8Array.of(2), le(amount, 8)]),
  };
}

export function decodeVault(data) {
  if (!(data instanceof Uint8Array) || data.length < VAULT_LEN || new TextDecoder().decode(data.subarray(0, 8)) !== MAGIC) {
    throw new TypeError("not a rewards vault");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    version: data[8],
    bump: data[9],
    tokens_bump: data[10],
    admin: encodeBase58(data.slice(11, 43)),
    mint: encodeBase58(data.slice(43, 75)),
    ledger: encodeBase58(data.slice(75, 107)),
    reward_per_credit: Number(view.getBigUint64(107, true)),
    cap_per_epoch: view.getUint32(115, true),
    epoch_seconds: Number(view.getBigUint64(119, true)),
    claims: Number(view.getBigUint64(127, true)),
    task_paid: view.getBigUint64(135, true).toString(),
  };
}
