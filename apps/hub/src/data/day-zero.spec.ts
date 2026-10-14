import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { DAY_ZERO_VAULT_ADDRESSES, ICELAN_DAY_ZERO_BASE_UNITS, ICELAN_POOL } from "../../../../src/hub/icelan/day-zero.js";
import { TASK_AMOUNTS } from "../../../../src/hub/icelan/icelan-tasks.js";
import type { RpcPort } from "../chain/rpc";
import { encodeBase58 } from "../../../../src/core/base58.js";
import { taskClaimedAddress } from "../../../../src/sinks/rewards.js";
import { DAY_ZERO_ENABLED, ICELAN_BOOK_CAP_BASE_UNITS, ICELAN_CLAIM_ENABLED, MAINNET_VAULT_ADDRESSES, alreadyClaimedFromAccount, claimReadForKey, claimsAreOpen, loadAlreadyClaimed, loadIcelanBook, loadVaultStatus, newlyCollectable, previewFromBooked, taskClaimedPda, vaultAddressesFromEnv, VAULT_ADDRESSES } from "./day-zero";

describe("day-zero hub flags and book preview", () => {
  it("keeps the new surfaces off by default", () => {
    expect(DAY_ZERO_ENABLED).toBe(false);
    expect(ICELAN_CLAIM_ENABLED).toBe(false);
    expect(claimsAreOpen(false, { status: "funded", fundedBaseUnits: 1n })).toBe(false);
    expect(claimsAreOpen(true, { status: "created", fundedBaseUnits: 0n })).toBe(false);
    expect(claimsAreOpen(true, { status: "funded", fundedBaseUnits: 1n })).toBe(true);
  });

  it("pins the derived vault addresses and uses the #183 book cap", () => {
    expect(VAULT_ADDRESSES.vault).toBe(DAY_ZERO_VAULT_ADDRESSES.vault);
    expect(VAULT_ADDRESSES.vaultTokens).toBe(DAY_ZERO_VAULT_ADDRESSES.vaultTokens);
    expect(MAINNET_VAULT_ADDRESSES.vault).toBe(DAY_ZERO_VAULT_ADDRESSES.vault);
    expect(vaultAddressesFromEnv({}).vault).toBe(DAY_ZERO_VAULT_ADDRESSES.vault);
    expect(vaultAddressesFromEnv({
      VITE_HUB_REWARDS_PROGRAM: "5wAVbHfZCBrYPymk1FNeV4D69iZioUmZaiE4ki4qrqWD",
      VITE_HUB_ICELAN_MINT: "AwTzBG9hNZx9XGmCVTSY72JPDPQSMNX3PC7JcqdLfpT7",
      VITE_HUB_ICELAN_VAULT: "11111111111111111111111111111111",
      VITE_HUB_ICELAN_VAULT_TOKENS: "11111111111111111111111111111112",
    })).toEqual({
      programId: "5wAVbHfZCBrYPymk1FNeV4D69iZioUmZaiE4ki4qrqWD",
      mint: "AwTzBG9hNZx9XGmCVTSY72JPDPQSMNX3PC7JcqdLfpT7",
      vault: "11111111111111111111111111111111",
      vaultTokens: "11111111111111111111111111111112",
    });
    expect(ICELAN_BOOK_CAP_BASE_UNITS).toBe(ICELAN_POOL);
    expect(ICELAN_DAY_ZERO_BASE_UNITS).toBe(ICELAN_POOL);
    expect(previewFromBooked(TASK_AMOUNTS.twitch_link)).toBe(TASK_AMOUNTS.twitch_link);
    expect(previewFromBooked(ICELAN_POOL + 1n)).toBe(ICELAN_POOL);
    expect(newlyCollectable(TASK_AMOUNTS.twitch_link + TASK_AMOUNTS.wallet_link + TASK_AMOUNTS.chat, 210_000_000n)).toBe(0n);
    expect(newlyCollectable(TASK_AMOUNTS.twitch_link + TASK_AMOUNTS.wallet_link + TASK_AMOUNTS.chat, 200_000_000n)).toBe(TASK_AMOUNTS.chat);
    expect(newlyCollectable(TASK_AMOUNTS.twitch_link, 0n)).toBe(TASK_AMOUNTS.twitch_link);
    expect(alreadyClaimedFromAccount(null)).toBe(0n);
    const claimed = new Uint8Array(16);
    new DataView(claimed.buffer).setBigUint64(0, 210_000_000n, true);
    expect(alreadyClaimedFromAccount(claimed)).toBe(210_000_000n);
    expect(() => alreadyClaimedFromAccount(new Uint8Array(8))).toThrow(/invalid layout/);
  });

  it("refuses vault address overrides that differ from recorded mainnet", () => {
    const leftovers = {
      VITE_HUB_NETWORK: "mainnet",
      VITE_HUB_LOCAL_CLAIM: "0",
      VITE_HUB_CLAIM_GENESIS: "",
      VITE_HUB_REWARDS_PROGRAM: "  ",
      VITE_HUB_ICELAN_MINT: "",
      VITE_HUB_ICELAN_VAULT: undefined,
      VITE_HUB_ICELAN_VAULT_TOKENS: "0",
    };
    expect(vaultAddressesFromEnv(leftovers)).toEqual(MAINNET_VAULT_ADDRESSES);
    expect(() => vaultAddressesFromEnv({
      VITE_HUB_NETWORK: "mainnet",
      VITE_HUB_ICELAN_VAULT: "11111111111111111111111111111111",
    })).toThrow(/refuses Collect target overrides/);
    expect(vaultAddressesFromEnv({
      VITE_HUB_NETWORK: "mainnet",
      VITE_HUB_REWARDS_PROGRAM: MAINNET_VAULT_ADDRESSES.programId,
      VITE_HUB_ICELAN_MINT: MAINNET_VAULT_ADDRESSES.mint,
      VITE_HUB_ICELAN_VAULT: MAINNET_VAULT_ADDRESSES.vault,
      VITE_HUB_ICELAN_VAULT_TOKENS: MAINNET_VAULT_ADDRESSES.vaultTokens,
    })).toEqual(MAINNET_VAULT_ADDRESSES);
  });

  it("is a valid Solana address the RPC port can take", () => {
    expect(() => address(VAULT_ADDRESSES.vault)).not.toThrow();
    expect(() => address(VAULT_ADDRESSES.vaultTokens)).not.toThrow();
  });

  it("reads a missing vault and a funded vault from a mocked RPC", async () => {
    const missing: Pick<RpcPort, "account"> = { account: async () => null };
    expect(await loadVaultStatus(missing as RpcPort)).toEqual({ status: "missing", fundedBaseUnits: 0n });

    const vault = new Uint8Array(160);
    new TextEncoder().encodeInto("RLVAULT1", vault);
    const tokens = new Uint8Array(165);
    new DataView(tokens.buffer).setBigUint64(64, ICELAN_DAY_ZERO_BASE_UNITS, true);
    const funded: Pick<RpcPort, "account"> = {
      account: async (at) => {
        if (String(at) === VAULT_ADDRESSES.vault) return { data: vault, lamports: 1n };
        if (String(at) === VAULT_ADDRESSES.vaultTokens) return { data: tokens, lamports: 1n };
        return null;
      },
    };
    expect(await loadVaultStatus(funded as RpcPort)).toEqual({ status: "funded", fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS });
  });

  it("reads already-claimed from the task_claimed PDA", async () => {
    const wallet = "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb";
    const pda = await taskClaimedPda(VAULT_ADDRESSES.vault, wallet, VAULT_ADDRESSES.programId);
    expect(pda).toBe(encodeBase58(taskClaimedAddress(VAULT_ADDRESSES.vault, wallet, VAULT_ADDRESSES.programId).address));
    const missing: Pick<RpcPort, "account"> = { account: async () => null };
    expect(await loadAlreadyClaimed(missing as RpcPort, VAULT_ADDRESSES.vault, wallet)).toBe(0n);
    const data = new Uint8Array(16);
    new DataView(data.buffer).setBigUint64(0, 200_000_000n, true);
    const funded: Pick<RpcPort, "account"> = {
      account: async (at) => String(at) === pda ? { data, lamports: 1n, owner: VAULT_ADDRESSES.programId, executable: false } : null,
    };
    expect(await loadAlreadyClaimed(funded as RpcPort, VAULT_ADDRESSES.vault, wallet)).toBe(200_000_000n);
    await expect(loadAlreadyClaimed({ account: async (at: Parameters<RpcPort["account"]>[0]) => String(at) === pda ? { data, lamports: 1n, owner: "11111111111111111111111111111111", executable: false } : null } as unknown as RpcPort, VAULT_ADDRESSES.vault, wallet)).rejects.toThrow(/different program/);
    await expect(loadAlreadyClaimed({ account: async (at: Parameters<RpcPort["account"]>[0]) => String(at) === pda ? { data, lamports: 1n, owner: VAULT_ADDRESSES.programId, executable: true } : null } as unknown as RpcPort, VAULT_ADDRESSES.vault, wallet)).rejects.toThrow(/executable/);
    await expect(loadAlreadyClaimed({ account: async (at: Parameters<RpcPort["account"]>[0]) => String(at) === pda ? { data, lamports: 1n, executable: false } : null } as unknown as RpcPort, VAULT_ADDRESSES.vault, wallet)).rejects.toThrow(/different program/);
    await expect(loadAlreadyClaimed({ account: async (at: Parameters<RpcPort["account"]>[0]) => String(at) === pda ? { data, lamports: 1n, owner: VAULT_ADDRESSES.programId } : null } as unknown as RpcPort, VAULT_ADDRESSES.vault, wallet)).rejects.toThrow(/executable/);
    await expect(loadAlreadyClaimed({ account: async (at: Parameters<RpcPort["account"]>[0]) => String(at) === pda ? { data: data.subarray(0, 8), lamports: 1n, owner: VAULT_ADDRESSES.programId, executable: false } : null } as unknown as RpcPort, VAULT_ADDRESSES.vault, wallet)).rejects.toThrow(/layout/);
  });

  it("does not carry a previous wallet's claimed value across a target switch", () => {
    const old = { key: "on:wallet-a:vault:program", status: "ready" as const, claimed: 200_000_000n };
    expect(claimReadForKey(old, "on:wallet-b:vault:program", true)).toEqual({ key: "on:wallet-b:vault:program", status: "loading", claimed: null });
    expect(claimReadForKey(old, "off::vault:program", false)).toEqual({ key: "off::vault:program", status: "off", claimed: 0n });
  });

  it("reads the task-book earned amount from the hub API", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ accountId: "a".repeat(64), earned: TASK_AMOUNTS.wallet_link.toString(), pool: TASK_AMOUNTS.wallet_link.toString(), poolCap: ICELAN_POOL.toString(), claim: "season_end", claimWallet: null, issuedCumulative: null }),
    })) as unknown as typeof fetch;
    expect(await loadIcelanBook("a".repeat(64), fetchImpl)).toEqual({
      accountId: "a".repeat(64),
      earned: TASK_AMOUNTS.wallet_link,
      pool: TASK_AMOUNTS.wallet_link,
      poolCap: ICELAN_POOL,
      claimWallet: null,
      issuedCumulative: null,
      claim: "season_end",
    });
    expect(await loadIcelanBook("b".repeat(64), fetchImpl)).toBeNull();
  });
});
