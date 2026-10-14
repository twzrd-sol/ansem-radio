export type HubNetwork = "mainnet" | "devnet";
export type NetworkGate = "ready" | "mismatch" | "unknown";
export type MarketLoad = "loading" | "error" | "ready";

/** Never offer a wallet action when the listing data and this build target different Solana clusters. */
export function networkGate(observed: string | null | undefined, target: HubNetwork): NetworkGate {
  if (observed !== "mainnet" && observed !== "devnet") return "unknown";
  return observed === target ? "ready" : "mismatch";
}

export function networkName(network: string | null | undefined): string {
  return network === "mainnet" ? "Solana mainnet" : network === "devnet" ? "Solana devnet" : "an unknown network";
}

export function networkRibbonCopy(observed: string | null | undefined, target: HubNetwork, backingOpen: boolean, openFor: readonly string[] = [], stale = false): { chip: string; message: string } {
  const gate = networkGate(observed, target);
  if (gate === "unknown") {
    return { chip: "Market network unknown", message: `Market data's network could not be verified. Wallet actions target ${networkName(target)}; backing is paused.` };
  }
  if (gate === "mismatch") {
    return { chip: "Network mismatch", message: `Market data${stale ? " was last read" : " is"} from ${networkName(observed)}; wallet actions target ${networkName(target)}. Backing is paused until they match.` };
  }
  const network = observed as HubNetwork;
  if (stale) return { chip: `Stale ${network} data`, message: `The last ${networkName(network)} market read is stale. Backing availability cannot be verified; refresh before acting.` };
  if (network === "devnet") return { chip: "Solana devnet", message: "Test tokens only. No real value. Check the network and mint before signing." };
  const names = openFor.length === 0 ? "listed creators" : openFor.length === 1 ? openFor[0]! : openFor.length === 2 ? `${openFor[0]} and ${openFor[1]}` : `${openFor.length} listed creators`;
  return {
    chip: "Mainnet board",
    message: backingOpen ? `Solana mainnet data. Backing is open for ${names}.` : "Solana mainnet data. No mainnet arena is open, so backing is not available here.",
  };
}

/** A failed board read is unknown, never permission to start a wallet flow. */
export function backingNetworkGate(load: MarketLoad, observed: string | null | undefined, target: HubNetwork): NetworkGate | "loading" {
  if (load === "loading") return "loading";
  if (load === "error") return "unknown";
  return networkGate(observed, target);
}
