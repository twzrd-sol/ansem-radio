import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { useCallback, useEffect, useRef, useState } from "react";

import { MAINNET_CLAIM_RECORDED, refuseMainnetHubOverrides } from "../chain/mainnet-claim-lock";
import { RPC_URL } from "../chain/config";
import { kitRpc, type RpcPort } from "../chain/rpc";

export { MAINNET_CLAIM_OVERRIDE_REFUSED as MAINNET_VAULT_OVERRIDE_REFUSED } from "../chain/mainnet-claim-lock";

export const DAY_ZERO_ENABLED = import.meta.env.VITE_HUB_DAY_ZERO === "1";
export const ICELAN_CLAIM_ENABLED = import.meta.env.VITE_HUB_ICELAN_CLAIM === "1";

const nonempty = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed !== "0" ? trimmed : undefined;
};

/** Recorded mainnet PDAs. The admin key is not imported here. Unset Vite overrides keep these. */
export const MAINNET_VAULT_ADDRESSES = Object.freeze({
  programId: MAINNET_CLAIM_RECORDED.programId,
  mint: MAINNET_CLAIM_RECORDED.mint,
  vault: MAINNET_CLAIM_RECORDED.vault,
  vaultTokens: MAINNET_CLAIM_RECORDED.vaultTokens,
});

/**
 * Vault the Collect page reads. Local rehearsal sets VITE_HUB_REWARDS_PROGRAM,
 * VITE_HUB_ICELAN_MINT, VITE_HUB_ICELAN_VAULT, and VITE_HUB_ICELAN_VAULT_TOKENS.
 * Unset, blank, or "0" keep the recorded mainnet addresses. A
 * VITE_HUB_NETWORK=mainnet build refuses any override that differs from that set.
 */
export function vaultAddressesFromEnv(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>) {
  refuseMainnetHubOverrides(env);
  if (env.VITE_HUB_NETWORK === "mainnet") return MAINNET_VAULT_ADDRESSES;
  return Object.freeze({
    programId: nonempty(env.VITE_HUB_REWARDS_PROGRAM) ?? MAINNET_VAULT_ADDRESSES.programId,
    mint: nonempty(env.VITE_HUB_ICELAN_MINT) ?? MAINNET_VAULT_ADDRESSES.mint,
    vault: nonempty(env.VITE_HUB_ICELAN_VAULT) ?? MAINNET_VAULT_ADDRESSES.vault,
    vaultTokens: nonempty(env.VITE_HUB_ICELAN_VAULT_TOKENS) ?? MAINNET_VAULT_ADDRESSES.vaultTokens,
  });
}

export const VAULT_ADDRESSES = vaultAddressesFromEnv();

/** Same as #183 `ICELAN_POOL`. */
export const ICELAN_BOOK_CAP_BASE_UNITS = 100_000n * 1_000_000n;

export type VaultView = {
  status: "missing" | "created" | "funded" | "error";
  fundedBaseUnits: bigint;
};

export type IcelanBookView = {
  accountId: string;
  earned: bigint;
  pool: bigint;
  poolCap: bigint;
  /** Wallet fixed by the station's first co-sign; null until a claim was issued. */
  claimWallet: string | null;
  /** Largest cumulative amount station-co-signed for claimWallet; this is not proof of payment. */
  issuedCumulative: bigint | null;
  claim?: "unavailable" | "season_end" | "task_book";
};

/** The claimable preview is the task-book balance, capped at the #183 pool. */
export function previewFromBooked(earnedBaseUnits: bigint): bigint {
  if (earnedBaseUnits < 0n) throw new RangeError("earned cannot be negative");
  return earnedBaseUnits > ICELAN_BOOK_CAP_BASE_UNITS ? ICELAN_BOOK_CAP_BASE_UNITS : earnedBaseUnits;
}

/** `task_claimed` stores cumulative claimed u64 plus nonce u64 in its exact 16-byte allocation. */
export function alreadyClaimedFromAccount(data: Uint8Array | null | undefined): bigint {
  if (!data) return 0n;
  if (data.length !== 16) throw new TypeError("claimed account data has an invalid layout");
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(0, true);
}

/** Newly collectable = booked (capped) minus already claimed on chain. */
export function newlyCollectable(earnedBaseUnits: bigint, alreadyClaimedBaseUnits: bigint): bigint {
  if (alreadyClaimedBaseUnits < 0n) throw new RangeError("already claimed cannot be negative");
  const booked = previewFromBooked(earnedBaseUnits);
  return booked > alreadyClaimedBaseUnits ? booked - alreadyClaimedBaseUnits : 0n;
}

export async function taskClaimedPda(vault: string, wallet: string, programId = VAULT_ADDRESSES.programId): Promise<string> {
  const encode = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: ["task_claimed", encode.encode(address(vault)) as Uint8Array, encode.encode(address(wallet)) as Uint8Array],
  });
  return pda;
}

export async function loadAlreadyClaimed(rpc: RpcPort, vault: string, wallet: string, programId = VAULT_ADDRESSES.programId): Promise<bigint> {
  const pda = await taskClaimedPda(vault, wallet, programId);
  const account = await rpc.account(address(pda));
  if (account && account.owner !== programId) throw new TypeError("claimed account is owned by a different program");
  if (account && account.executable !== false) throw new TypeError("claimed account is executable or missing account metadata");
  return alreadyClaimedFromAccount(account?.data);
}

/** Claim control is on only when the hub flag is on and the vault token account holds a balance. */
export function claimsAreOpen(flagOn: boolean, vault: VaultView | null | undefined): boolean {
  return flagOn === true && vault?.status === "funded";
}

function tokenAmount(data: Uint8Array): bigint {
  if (data.length < 72) throw new TypeError("not a token account");
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
}

export async function loadVaultStatus(rpc: RpcPort): Promise<VaultView> {
  const [vaultAccount, tokenAccount] = await Promise.all([
    rpc.account(address(VAULT_ADDRESSES.vault)),
    rpc.account(address(VAULT_ADDRESSES.vaultTokens)),
  ]);
  if (!vaultAccount) return { status: "missing", fundedBaseUnits: 0n };
  const fundedBaseUnits = tokenAccount ? tokenAmount(tokenAccount.data) : 0n;
  return { status: fundedBaseUnits > 0n ? "funded" : "created", fundedBaseUnits };
}

export async function loadIcelanBook(accountId: string, fetchImpl: typeof fetch = fetch): Promise<IcelanBookView | null> {
  if (!/^[0-9a-f]{64}$/.test(accountId)) return null;
  const res = await fetchImpl("/hub/api/icelan-tasks", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json() as { accountId?: string; earned?: string; pool?: string; poolCap?: string; claim?: string; claimWallet?: string | null; issuedCumulative?: string | null };
  if (body.accountId !== accountId || typeof body.earned !== "string" || !/^[0-9]+$/.test(body.earned) || typeof body.pool !== "string" || !/^[0-9]+$/.test(body.pool)
    || typeof body.poolCap !== "string" || !/^[0-9]+$/.test(body.poolCap)
    || (body.claimWallet !== null && (typeof body.claimWallet !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.claimWallet)))
    || (body.issuedCumulative !== null && (typeof body.issuedCumulative !== "string" || !/^[0-9]+$/.test(body.issuedCumulative)))
    || (body.claimWallet === null) !== (body.issuedCumulative === null)) return null;
  const earned = BigInt(body.earned);
  const pool = BigInt(body.pool);
  const poolCap = BigInt(body.poolCap);
  const issuedCumulative = body.issuedCumulative === null ? null : BigInt(body.issuedCumulative);
  if (earned > pool || pool > poolCap || issuedCumulative !== null && issuedCumulative > earned) return null;
  const claim = body.claim === "unavailable" || body.claim === "season_end" || body.claim === "task_book" ? body.claim : undefined;
  return {
    accountId,
    earned,
    pool,
    poolCap,
    claimWallet: body.claimWallet ?? null,
    issuedCumulative,
    ...(claim ? { claim } : {}),
  };
}

export function useDayZeroVault(enabled: boolean, rpc?: RpcPort): { load: "off" | "loading" | "ready" | "error"; vault: VaultView | null; refresh: () => Promise<void> } {
  const injected = useRef(rpc);
  const owned = useRef<RpcPort | null>(null);
  const [load, setLoad] = useState<"off" | "loading" | "ready" | "error">(DAY_ZERO_ENABLED && enabled ? "loading" : "off");
  const [vault, setVault] = useState<VaultView | null>(null);
  const refresh = useCallback(async () => {
    if (!DAY_ZERO_ENABLED || !enabled) {
      setLoad("off");
      setVault(null);
      return;
    }
    const port = injected.current ?? (owned.current ??= kitRpc(RPC_URL));
    try {
      setVault(await loadVaultStatus(port));
      setLoad("ready");
    } catch {
      setVault({ status: "error", fundedBaseUnits: 0n });
      setLoad("error");
    }
  }, [enabled]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { load, vault, refresh };
}

export function useIcelanBook(enabled: boolean, accountId: string | null | undefined): { book: IcelanBookView | null; refresh: () => Promise<void> } {
  const [result, setResult] = useState<{ key: string; book: IcelanBookView | null }>({ key: "", book: null });
  const request = useRef(0);
  const key = `${enabled ? "on" : "off"}:${accountId ?? ""}`;
  const refresh = useCallback(async () => {
    const requestId = ++request.current;
    if (!enabled || !accountId) { setResult({ key, book: null }); return; }
    try {
      const next = await loadIcelanBook(accountId);
      if (request.current === requestId) setResult({ key, book: next });
    } catch { if (request.current === requestId) setResult({ key, book: null }); }
  }, [enabled, accountId, key]);
  useEffect(() => {
    void refresh();
    return () => { ++request.current; };
  }, [refresh]);
  return { book: result.key === key ? result.book : null, refresh };
}

export type ClaimedReadStatus = "off" | "loading" | "ready" | "error";
export type ClaimedReadResult = { key: string; status: ClaimedReadStatus; claimed: bigint | null };

/** Never expose a result captured for a different wallet, vault, or program target. */
export function claimReadForKey(result: ClaimedReadResult, key: string, enabled: boolean): ClaimedReadResult {
  return result.key === key ? result : { key, status: enabled ? "loading" : "off", claimed: enabled ? null : 0n };
}

/** On-chain already-claimed for this wallet's task_claimed PDA. A failed read is error, not 0. */
export function useAlreadyClaimed(enabled: boolean, wallet: string | null | undefined, rpc?: RpcPort): { status: ClaimedReadStatus; claimed: bigint | null; refresh: () => Promise<void> } {
  const injected = useRef(rpc);
  const owned = useRef<RpcPort | null>(null);
  const [result, setResult] = useState<{ key: string; status: ClaimedReadStatus; claimed: bigint | null }>({
    key: "", status: enabled && wallet ? "loading" : "off", claimed: enabled && wallet ? null : 0n,
  });
  const request = useRef(0);
  const key = `${enabled ? "on" : "off"}:${wallet ?? ""}:${VAULT_ADDRESSES.vault}:${VAULT_ADDRESSES.programId}`;
  const refresh = useCallback(async () => {
    const requestId = ++request.current;
    if (!enabled || !wallet) {
      setResult({ key, status: "off", claimed: 0n });
      return;
    }
    setResult({ key, status: "loading", claimed: null });
    const port = injected.current ?? (owned.current ??= kitRpc(RPC_URL));
    try {
      const claimed = await loadAlreadyClaimed(port, VAULT_ADDRESSES.vault, wallet, VAULT_ADDRESSES.programId);
      if (request.current === requestId) setResult({ key, status: "ready", claimed });
    } catch {
      if (request.current === requestId) setResult({ key, status: "error", claimed: null });
    }
  }, [enabled, wallet, key]);
  useEffect(() => {
    void refresh();
    return () => { ++request.current; };
  }, [refresh]);
  const current = claimReadForKey(result, key, enabled && Boolean(wallet));
  return { status: current.status, claimed: current.claimed, refresh };
}
