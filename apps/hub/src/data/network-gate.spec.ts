import { describe, expect, it } from "vitest";
import { backingNetworkGate, networkGate, networkName, networkRibbonCopy } from "./network-gate";

describe("market and wallet network gate", () => {
  it("allows a backing screen only when listing reads match this build's signing network", () => {
    expect(networkGate("mainnet", "mainnet")).toBe("ready");
    expect(networkGate("devnet", "devnet")).toBe("ready");
    expect(networkGate("mainnet", "devnet")).toBe("mismatch");
    expect(networkGate("devnet", "mainnet")).toBe("mismatch");
  });

  it("fails closed when the listing network is absent or unrecognized", () => {
    expect(networkGate(null, "mainnet")).toBe("unknown");
    expect(networkGate("testnet", "mainnet")).toBe("unknown");
    expect(networkName("testnet")).toBe("an unknown network");
  });

  it("keeps the wallet flow unavailable while the board loads or fails", () => {
    expect(backingNetworkGate("loading", null, "mainnet")).toBe("loading");
    expect(backingNetworkGate("error", null, "mainnet")).toBe("unknown");
    expect(backingNetworkGate("ready", null, "mainnet")).toBe("unknown");
    expect(backingNetworkGate("ready", "devnet", "mainnet")).toBe("mismatch");
    expect(backingNetworkGate("ready", "mainnet", "mainnet")).toBe("ready");
  });

  it("labels observed market data separately from the wallet build network", () => {
    expect(networkRibbonCopy("devnet", "mainnet", true).message).toContain("Market data is from Solana devnet; wallet actions target Solana mainnet");
    expect(networkRibbonCopy("devnet", "mainnet", true).chip).toBe("Network mismatch");
    expect(networkRibbonCopy(null, "mainnet", false).message).toContain("Market data's network could not be verified");
    expect(networkRibbonCopy("mainnet", "mainnet", false).message).toContain("No mainnet arena is open");
    expect(networkRibbonCopy("mainnet", "mainnet", true, ["A", "B", "C"]).message).toContain("Backing is open for 3 listed creators");
    expect(networkRibbonCopy("devnet", "devnet", false).message).toContain("Test tokens only");
    expect(networkRibbonCopy("mainnet", "mainnet", false, [], true).message).toContain("Backing availability cannot be verified");
  });
});
