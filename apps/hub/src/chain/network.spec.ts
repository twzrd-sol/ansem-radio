// The network is a build input: devnet by default, mainnet when VITE_HUB_NETWORK=mainnet, each with its own genesis
// check, wallet chain, explorer link and featured mint.
import { afterEach, describe, expect, it, vi } from "vitest";

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
