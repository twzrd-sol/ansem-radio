import { describe, expect, it } from "vitest";

import { httpToWs, looksLikeMainnetRpc, resolveTapeWsUrl } from "./url";

describe("tape websocket URL", () => {
  const location = { protocol: "https:", host: "radiolan.live" };

  it("derives a same-origin socket for the HTTP relay", () => {
    expect(resolveTapeWsUrl({ network: "devnet", rpcUrl: "/hub/rpc", location })).toBe("wss://radiolan.live/hub/rpc");
    expect(httpToWs("https://api.devnet.solana.com")).toBe("wss://api.devnet.solana.com/");
  });

  it("uses the same-origin relay on mainnet and never a keyed mainnet RPC", () => {
    expect(resolveTapeWsUrl({ network: "mainnet", rpcUrl: "/hub/rpc", location })).toBe("wss://radiolan.live/hub/rpc");
    expect(looksLikeMainnetRpc("https://api.mainnet-beta.solana.com")).toBe(true);
    expect(resolveTapeWsUrl({ network: "mainnet", rpcUrl: "https://api.mainnet-beta.solana.com/?api-key=secret", location })).toBeNull();
    expect(resolveTapeWsUrl({ network: "devnet", rpcUrl: "https://api.mainnet-beta.solana.com", location })).toBeNull();
    expect(resolveTapeWsUrl({ network: "devnet", rpcUrl: "/hub/rpc", wsOverride: "wss://api.mainnet-beta.solana.com", location })).toBeNull();
    expect(resolveTapeWsUrl({ network: "mainnet", rpcUrl: "/hub/rpc", wsOverride: "wss://api.mainnet-beta.solana.com", location })).toBeNull();
  });

  it("converts an absolute devnet RPC to websocket", () => {
    expect(resolveTapeWsUrl({ network: "devnet", rpcUrl: "https://api.devnet.solana.com", location })).toBe("wss://api.devnet.solana.com/");
  });
});
