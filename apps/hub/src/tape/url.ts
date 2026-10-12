// The browser only opens the same-origin relay. An absolute mainnet RPC, which may
// carry a provider key, never becomes a page socket.

const MAINNET = /mainnet/i;

export function httpToWs(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.toString();
}

export function looksLikeMainnetRpc(url: string): boolean {
  try {
    const parsed = new URL(url, "http://localhost");
    return MAINNET.test(parsed.hostname) || MAINNET.test(parsed.href);
  } catch {
    return true;
  }
}

export function resolveTapeWsUrl(opts: {
  network: "devnet" | "mainnet";
  rpcUrl: string;
  wsOverride?: string;
  location: { protocol: string; host: string };
}): string | null {
  if (opts.wsOverride) {
    if (!/^wss?:\/\//i.test(opts.wsOverride) || looksLikeMainnetRpc(opts.wsOverride) || opts.network === "mainnet") return null;
    return opts.wsOverride;
  }
  if (/^https?:\/\//i.test(opts.rpcUrl)) {
    if (opts.network === "mainnet" || looksLikeMainnetRpc(opts.rpcUrl)) return null;
    return httpToWs(opts.rpcUrl);
  }
  const path = opts.rpcUrl.startsWith("/") ? opts.rpcUrl : "/hub/rpc";
  const protocol = opts.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${opts.location.host}${path}`;
}
