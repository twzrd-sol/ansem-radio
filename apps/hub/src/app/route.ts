import { useSyncExternalStore } from "react";

export type Tab = "market" | "lan" | "play" | "positions" | "me";
export type RouteKey = "" | "s" | "lan" | "play" | "board" | "back" | "positions" | "me" | "claim" | "how";

export interface Route {
  key: RouteKey;
  arg: string;
  title: string;
  tab: Tab;
  /** On-chain route: shows the network ribbon. */
  onchain: boolean;
}

const ROUTES: Record<RouteKey, Omit<Route, "key" | "arg">> = {
  "": { title: "Discover", tab: "market", onchain: false },
  s: { title: "Listing", tab: "market", onchain: false },
  lan: { title: "Radio LAN", tab: "lan", onchain: false },
  play: { title: "Play", tab: "play", onchain: false },
  board: { title: "Points board", tab: "play", onchain: false },
  back: { title: "Back the creator", tab: "market", onchain: true },
  positions: { title: "My positions", tab: "me", onchain: false },
  me: { title: "Profile", tab: "me", onchain: false },
  claim: { title: "Collect", tab: "me", onchain: false },
  how: { title: "How Radio LAN works", tab: "lan", onchain: false },
};

export function parseHash(hash: string): Route {
  const [name = "", arg = ""] = hash.replace(/^#\/?/, "").split("/");
  const key = (Object.hasOwn(ROUTES, name) ? name : "") as RouteKey;
  return { key, arg, ...ROUTES[key] };
}

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export const useHash = () => useSyncExternalStore(subscribe, () => window.location.hash, () => "");

export const useRoute = (): Route => parseHash(useHash());
