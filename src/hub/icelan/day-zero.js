/**
 * Day-zero ICELAN vault: addresses, unsigned instructions, and a season-end plan from the #183 task book.
 * Sends nothing. Does not open an arena, buy RLAN, or apply a support boost.
 */
import { decodeBase58, encodeBase58 } from "../../core/base58.js";
import { compactU16, compileLegacyMessage } from "../../core/solana.js";
import { LOG_ID } from "../../attribution/claim.js";
import { ledgerAddress } from "../../sinks/evidence-ledger.js";
import {
  REWARDS_PROGRAM_ID_DEVNET,
  REWARDS_PROGRAM_ID_MAINNET,
  TOKEN_PROGRAM_ID,
  VAULT_LEN,
  decodeVault,
  initVaultInstruction,
  setStationCosignerInstruction,
  stationAddress,
  STATION_LEN,
  vaultAddress,
  vaultTokensAddress,
} from "../../sinks/rewards.js";
import { ICELAN_POOL } from "./icelan-tasks.js";
import {
  ICELAN_DAY_ZERO_BASE_UNITS,
  ICELAN_DAY_ZERO_TOKENS,
  ICELAN_MINT,
  ICELAN_TREASURY_BASE_UNITS,
  dayZeroIcelanVault,
} from "./economy-budgets.js";

export {
  ICELAN_DAY_ZERO_BASE_UNITS,
  ICELAN_DAY_ZERO_TOKENS,
  ICELAN_MINT,
  ICELAN_POOL,
  ICELAN_TREASURY_BASE_UNITS,
  REWARDS_PROGRAM_ID_DEVNET,
  REWARDS_PROGRAM_ID_MAINNET,
  TOKEN_PROGRAM_ID,
  VAULT_LEN,
  STATION_LEN,
  dayZeroIcelanVault,
  decodeVault,
  setStationCosignerInstruction,
  stationAddress,
};

export const TOKEN_DECIMALS = 6;
/** Temporary vault admin (owner, 2026-10-07). Migrate to Squads. */
export const VAULT_ADMIN = "EatwUpB2eCRcCEJgvQvzNb1hiPKqasjzXQ7NtVVFuLYX";
export const ICELAN_TREASURY_TOKEN_ACCOUNT = "4PuDwXMz5Fb9TpfbksVPcKAwRLkF81kR7UWe7iXbSPyA";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
export const DEVNET_RPC = "https://api.devnet.solana.com";
export const ATTRIBUTION_LOG_ID = LOG_ID;
/** Devnet rewards rehearsal mint from docs/examples/rewards-devnet (classic SPL, not Token-2022). */
export const DEVNET_REWARDS_MINT = "AwTzBG9hNZx9XGmCVTSY72JPDPQSMNX3PC7JcqdLfpT7";

/** Vault program knobs if prove+claim is ever used. Hub claims stay off. */
export const DAY_ZERO_REWARD_PER_CREDIT = 1_000_000n;
export const DAY_ZERO_CAP_PER_EPOCH = 5;
export const DAY_ZERO_EPOCH_SECONDS = 604_800;

/** Default Solana rent: 3480 lamports/byte-year, two-year exemption, 128-byte overhead. */
export const RENT_LAMPORTS_PER_BYTE_YEAR = 3480n;
export const RENT_EXEMPTION_YEARS = 2n;
export const ACCOUNT_STORAGE_OVERHEAD = 128;

export function rentExemptLamports(dataLen) {
  if (!Number.isInteger(dataLen) || dataLen < 0) throw new RangeError("data length must be a nonnegative integer");
  return BigInt(ACCOUNT_STORAGE_OVERHEAD + dataLen) * RENT_LAMPORTS_PER_BYTE_YEAR * RENT_EXEMPTION_YEARS;
}

export const VAULT_RENT_LAMPORTS = rentExemptLamports(VAULT_LEN);
export const VAULT_TOKENS_RENT_LAMPORTS = rentExemptLamports(165);
export const STATION_RENT_LAMPORTS = rentExemptLamports(STATION_LEN);
export const SIGNATURE_FEE_LAMPORTS = 5000n;

export function dayZeroVault(programId = REWARDS_PROGRAM_ID_MAINNET, mint = ICELAN_MINT, admin = VAULT_ADMIN) {
  const vault = vaultAddress(admin, mint, programId);
  return Object.freeze({
    programId,
    mint,
    vault: encodeBase58(vault.address),
    vaultBump: vault.bump,
    vaultTokens: encodeBase58(vaultTokensAddress(vault.address, programId).address),
    station: encodeBase58(stationAddress(vault.address, programId).address),
    ledger: encodeBase58(ledgerAddress(ATTRIBUTION_LOG_ID).address),
  });
}

export const DAY_ZERO_VAULT_MAINNET = dayZeroVault(REWARDS_PROGRAM_ID_MAINNET);

/** Public addresses the hub may import in tests. The admin key is not included. */
export const DAY_ZERO_VAULT_ADDRESSES = Object.freeze({
  programId: DAY_ZERO_VAULT_MAINNET.programId,
  mint: DAY_ZERO_VAULT_MAINNET.mint,
  vault: DAY_ZERO_VAULT_MAINNET.vault,
  vaultTokens: DAY_ZERO_VAULT_MAINNET.vaultTokens,
});

/**
 * The claimable amount is the #183 task-book balance, never a second conversion from season points.
 * Caps at the remaining vault, which equals the book pool cap.
 */
export function bookedIcelanBaseUnits(earned, { vaultBudget = ICELAN_POOL } = {}) {
  if (earned === undefined || earned === null || earned === "") throw new TypeError("earned is required");
  const n = BigInt(earned);
  if (n < 0n) throw new RangeError("earned cannot be negative");
  const budget = BigInt(vaultBudget);
  return n > budget ? budget : n;
}

/**
 * Unsigned season-end ICELAN allocation from the task book. Not a payout instruction.
 * `earnedByAccount` is already-booked ICELAN (base units), the same map `createIcelanTaskStore.snapshot()`.
 */
export function proposeIcelanSeasonPlan({ earnedByAccount, vaultBudget = ICELAN_POOL } = {}) {
  if (!earnedByAccount || typeof earnedByAccount !== "object") throw new TypeError("earnedByAccount is required");
  const rows = Object.entries(earnedByAccount).map(([accountId, earned]) => ({
    accountId,
    earned: BigInt(earned).toString(),
    amountBaseUnits: bookedIcelanBaseUnits(earned, { vaultBudget }).toString(),
  })).filter((row) => row.amountBaseUnits !== "0").sort((a, b) => a.accountId.localeCompare(b.accountId));
  let remaining = BigInt(vaultBudget);
  const allocations = [];
  for (const row of rows) {
    const want = BigInt(row.amountBaseUnits);
    const amount = want > remaining ? remaining : want;
    if (amount === 0n) break;
    allocations.push({ accountId: row.accountId, earned: row.earned, amountBaseUnits: amount.toString() });
    remaining -= amount;
  }
  return Object.freeze({
    mint: ICELAN_MINT,
    vault: DAY_ZERO_VAULT_ADDRESSES.vault,
    source: "icelan-tasks",
    signed: false,
    claimable: false,
    reason: "claim_task_book",
    allocations: Object.freeze(allocations),
    allocatedBaseUnits: allocations.reduce((s, r) => s + BigInt(r.amountBaseUnits), 0n).toString(),
    remainingBaseUnits: remaining.toString(),
  });
}

export function splTransferInstruction({ source, destination, owner, amount, programId = TOKEN_PROGRAM_ID }) {
  const n = BigInt(amount);
  if (n <= 0n) throw new RangeError("transfer amount must be positive");
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, n, true);
  const meta = (pubkey, isSigner, isWritable) => ({ pubkey: decodeBase58(pubkey), isSigner, isWritable });
  return {
    programId: decodeBase58(programId),
    keys: [meta(source, false, true), meta(destination, false, true), meta(owner, true, false)],
    data,
  };
}

export function initDayZeroVaultInstruction({ programId = REWARDS_PROGRAM_ID_MAINNET, mint = ICELAN_MINT, admin = VAULT_ADMIN } = {}) {
  return initVaultInstruction({
    admin,
    mint,
    rewardPerCredit: DAY_ZERO_REWARD_PER_CREDIT,
    capPerEpoch: DAY_ZERO_CAP_PER_EPOCH,
    epochSeconds: DAY_ZERO_EPOCH_SECONDS,
    programId,
  });
}

export function setDayZeroCosignerInstruction({
  cosigner,
  programId = REWARDS_PROGRAM_ID_MAINNET,
  mint = ICELAN_MINT,
  admin = VAULT_ADMIN,
} = {}) {
  if (!cosigner) throw new TypeError("cosigner is required");
  return setStationCosignerInstruction({ admin, mint, cosigner, programId });
}

export function fundDayZeroVaultInstruction({
  source = ICELAN_TREASURY_TOKEN_ACCOUNT,
  amount = ICELAN_DAY_ZERO_BASE_UNITS,
  owner = VAULT_ADMIN,
  programId = REWARDS_PROGRAM_ID_MAINNET,
  mint = ICELAN_MINT,
} = {}) {
  const tokens = dayZeroVault(programId, mint, owner).vaultTokens;
  return splTransferInstruction({ source, destination: tokens, owner, amount });
}

/** Unsigned legacy wire (zero signatures) for simulateTransaction with sigVerify=false. */
export function unsignedWire({ feePayer, instructions, recentBlockhash }) {
  const message = compileLegacyMessage({ feePayer: decodeBase58(feePayer), instructions, recentBlockhash: decodeBase58(recentBlockhash) });
  const empty = new Uint8Array(64);
  const sigs = Array.from({ length: message.signerCount }, () => empty);
  const parts = [compactU16(sigs.length), ...sigs, message.bytes];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return { message, wire: out, base64: Buffer.from(out).toString("base64") };
}

export function tokenAmount(data) {
  if (!(data instanceof Uint8Array) || data.length < 72) throw new TypeError("not a token account");
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
}

export function readVaultStatus({ vaultAccount, tokenAccount }) {
  if (!vaultAccount) return { status: "missing", fundedBaseUnits: 0n };
  const vault = decodeVault(vaultAccount);
  const fundedBaseUnits = tokenAccount ? tokenAmount(tokenAccount) : 0n;
  return {
    status: fundedBaseUnits > 0n ? "funded" : "created",
    fundedBaseUnits,
    mint: vault.mint,
    rewardPerCredit: vault.reward_per_credit,
    capPerEpoch: vault.cap_per_epoch,
    claims: vault.claims,
  };
}

export function dayZeroPlan() {
  const vault = DAY_ZERO_VAULT_MAINNET;
  return Object.freeze({
    cluster: "mainnet",
    genesis: MAINNET_GENESIS,
    vault,
    fund: dayZeroIcelanVault(),
    bookCap: ICELAN_POOL.toString(),
    signers: Object.freeze({ vaultInit: VAULT_ADMIN, vaultFund: VAULT_ADMIN, setCosigner: VAULT_ADMIN }),
    bans: Object.freeze([
      "never --final",
      "never burn or transfer upgrade authority",
      "never deploy or upgrade a program from this script",
      "never send from this script",
    ]),
  });
}
