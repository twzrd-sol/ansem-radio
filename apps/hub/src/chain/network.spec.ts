// The network is a build input: devnet by default, mainnet when VITE_HUB_NETWORK=mainnet, each with its own genesis
// check, wallet chain, explorer link and featured mint.
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAINNET_VAULT_ADDRESSES, vaultAddressesFromEnv } from "../data/day-zero";
import { claimBuildFromEnv, GENESIS } from "./config";
import { MAINNET_CLAIM_RECORDED, refuseMainnetHubOverrides } from "./mainnet-claim-lock";

const load = async (network?: string) => {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (network) vi.stubEnv("VITE_HUB_NETWORK", network);
  return import("./config");
};

describe("network as a build input", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to devnet: its genesis, chain id, explorer cluster, and the build's test mint", async () => {
    const c = await load();
    expect(c.NETWORK).toBe("devnet");
    expect(c.CHAIN).toBe("solana:devnet");
    expect(c.GENESIS_HASH).toBe("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    expect(c.NETWORK_LABEL).toBe("Solana devnet");
    expect(c.explorerUrl("tx", "abc")).toBe("https://explorer.solana.com/tx/abc?cluster=devnet");
    expect(c.ARENA_MINT).not.toBe(c.RLAN_MINT);
  });

  it("on mainnet: mainnet genesis and chain id, plain explorer links, and the featured arena is the official one for RLAN", async () => {
    const c = await load("mainnet");
    expect(c.NETWORK).toBe("mainnet");
    expect(c.IS_MAINNET).toBe(true);
    expect(c.CHAIN).toBe("solana:mainnet");
    expect(c.GENESIS_HASH).toBe("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
    expect(c.NETWORK_LABEL).toBe("Solana mainnet");
    expect(c.explorerUrl("address", "xyz")).toBe("https://explorer.solana.com/address/xyz");
    expect(c.ARENA_MINT).toBe(c.RLAN_MINT);
    const { arenaPda } = await import("./arena");
    const { address } = await import("@solana/kit");
    expect((await arenaPda(address(c.ARENA_STREAMER), address(c.ARENA_MINT!)))[0]).toBe(c.OFFICIAL_ARENA_MAINNET);
  });

  it("local Collect rehearsal skips the public genesis pin unless one is set", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_HUB_LOCAL_CLAIM", "1");
    const local = await import("./config");
    expect(local.LOCAL_CLAIM).toBe(true);
    expect(local.CLAIM_GENESIS_HASH).toBeNull();
    expect(local.IS_MAINNET).toBe(false);
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_HUB_LOCAL_CLAIM", "1");
    vi.stubEnv("VITE_HUB_CLAIM_GENESIS", "LocalGenesisHash111111111111111111111111111");
    const pinned = await import("./config");
    expect(pinned.CLAIM_GENESIS_HASH).toBe("LocalGenesisHash111111111111111111111111111");
  });

  it("a mainnet build refuses Collect target overrides", () => {
    expect(MAINNET_CLAIM_RECORDED.genesis).toBe(GENESIS.mainnet);
    expect(MAINNET_CLAIM_RECORDED.vault).toBe(MAINNET_VAULT_ADDRESSES.vault);
    expect(() => refuseMainnetHubOverrides({
      VITE_HUB_NETWORK: "mainnet",
      VITE_HUB_ICELAN_VAULT: "11111111111111111111111111111111",
    })).toThrow(/refuses Collect target overrides/);
    refuseMainnetHubOverrides({ VITE_HUB_NETWORK: "mainnet" });
    refuseMainnetHubOverrides({ VITE_HUB_NETWORK: "devnet", VITE_HUB_ICELAN_VAULT: "11111111111111111111111111111111" });
    const unset = claimBuildFromEnv({ VITE_HUB_NETWORK: "mainnet" });
    expect(unset.localClaim).toBe(false);
    expect(unset.claimGenesisHash).toBe(GENESIS.mainnet);
    expect(vaultAddressesFromEnv({ VITE_HUB_NETWORK: "mainnet" })).toEqual(MAINNET_VAULT_ADDRESSES);

    const leftovers = claimBuildFromEnv({
      VITE_HUB_NETWORK: "mainnet",
      VITE_HUB_LOCAL_CLAIM: "0",
      VITE_HUB_CLAIM_GENESIS: "   ",
    });
    expect(leftovers.localClaim).toBe(false);
    expect(leftovers.claimGenesisHash).toBe(GENESIS.mainnet);
    expect(vaultAddressesFromEnv({
      VITE_HUB_NETWORK: "mainnet",
      VITE_HUB_LOCAL_CLAIM: "1",
      VITE_HUB_CLAIM_GENESIS: "0",
      VITE_HUB_REWARDS_PROGRAM: "",
      VITE_HUB_ICELAN_MINT: "  ",
      VITE_HUB_ICELAN_VAULT: "0",
      VITE_HUB_ICELAN_VAULT_TOKENS: undefined,
    })).toEqual(MAINNET_VAULT_ADDRESSES);

    const leftoverLocal = claimBuildFromEnv({ VITE_HUB_NETWORK: "mainnet", VITE_HUB_LOCAL_CLAIM: "1" });
    expect(leftoverLocal.localClaim).toBe(true);
    expect(leftoverLocal.claimGenesisHash).toBe(GENESIS.mainnet);

    expect(claimBuildFromEnv({
      VITE_HUB_NETWORK: "mainnet",
      VITE_HUB_CLAIM_GENESIS: GENESIS.mainnet,
    }).claimGenesisHash).toBe(GENESIS.mainnet);
    expect(() => claimBuildFromEnv({
      VITE_HUB_NETWORK: "mainnet",
      VITE_HUB_LOCAL_CLAIM: "1",
      VITE_HUB_CLAIM_GENESIS: "LocalGenesisHash111111111111111111111111111",
    })).toThrow(/refuses Collect target overrides/);
    expect(() => vaultAddressesFromEnv({
      VITE_HUB_NETWORK: "mainnet",
      VITE_HUB_ICELAN_VAULT: "11111111111111111111111111111111",
    })).toThrow(/refuses Collect target overrides/);
    expect(vaultAddressesFromEnv({
      VITE_HUB_NETWORK: "mainnet",
      VITE_HUB_ICELAN_VAULT: MAINNET_VAULT_ADDRESSES.vault,
    })).toEqual(MAINNET_VAULT_ADDRESSES);
  });

  it("a mainnet module load refuses a differing claim genesis", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_HUB_NETWORK", "mainnet");
    vi.stubEnv("VITE_HUB_CLAIM_GENESIS", "LocalGenesisHash111111111111111111111111111");
    await expect(import("./config")).rejects.toThrow(/refuses Collect target overrides/);
  });

  it("a mainnet module load keeps the mainnet genesis pin when LOCAL_CLAIM is leftover", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_HUB_NETWORK", "mainnet");
    vi.stubEnv("VITE_HUB_LOCAL_CLAIM", "1");
    const c = await import("./config");
    expect(c.IS_MAINNET).toBe(true);
    expect(c.LOCAL_CLAIM).toBe(true);
    expect(c.CLAIM_GENESIS_HASH).toBe(c.GENESIS.mainnet);
  });

  it("anything but 'mainnet' stays devnet", async () => {
    expect((await load("testnet")).NETWORK).toBe("devnet");
    expect((await load("MAINNET")).NETWORK).toBe("devnet");
  });

  it("the flow refuses a cluster whose genesis is not the build's", async () => {
    const { onNetwork } = await import("./flow");
    const rpc = { genesisHash: async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" } as unknown as Parameters<typeof onNetwork>[0];
    expect(await onNetwork(rpc, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")).toBe(true);
    expect(await onNetwork(rpc, "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")).toBe(false);
  });
});
