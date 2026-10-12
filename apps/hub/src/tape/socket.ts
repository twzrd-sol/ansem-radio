import { NETWORK, RPC_URL, type Network } from "../chain/config";
import { eventsFromAccountNotification, parseLogsNotification, type ChannelRef, type TapeEvent } from "./events";
import { accountSubscribeCall, CONNECT_TIMEOUT_MS, logsSubscribeCall, MAX_ARENA_SUBS, MAX_RECONNECTS, subscribeProblem } from "./policy";
import { resolveTapeWsUrl } from "./url";

export type TapeStatus = "connecting" | "live" | "offline";

export type SocketCtor = new (url: string) => {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (type: string, listener: (event: { data?: string }) => void) => void;
  removeEventListener: (type: string, listener: (event: { data?: string }) => void) => void;
};

export interface TapeClient {
  stop: () => void;
  retry: () => void;
}

export function tapeWsUrl(location: { protocol: string; host: string } = typeof window === "undefined" ? { protocol: "http:", host: "localhost" } : window.location): string | null {
  return resolveTapeWsUrl({
    network: NETWORK,
    rpcUrl: RPC_URL,
    wsOverride: typeof import.meta.env.VITE_HUB_RPC_WS_URL === "string" ? import.meta.env.VITE_HUB_RPC_WS_URL : undefined,
    location,
  });
}

export function createTapeClient(opts: {
  channels: ChannelRef[];
  url: string | null;
  onEvents: (events: TapeEvent[]) => void;
  onStatus: (status: TapeStatus) => void;
  WebSocketImpl?: SocketCtor;
  now?: () => number;
  network?: Network;
}): TapeClient {
  const WebSocketImpl = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as SocketCtor);
  const now = opts.now ?? Date.now;
  const network = opts.network ?? NETWORK;
  let stopped = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let socket: InstanceType<SocketCtor> | null = null;
  let nextId = 1;
  const pendingAccounts = new Map<number, string>();
  const subToAccount = new Map<number, string>();
  const previous = new Map<string, import("./events").ArenaSnapshot>();

  const arenas = opts.channels.map((row) => row.arena).filter((id): id is string => Boolean(id)).slice(0, MAX_ARENA_SUBS);

  const open = () => {
    if (stopped) return;
    if (!opts.url || !WebSocketImpl) {
      opts.onStatus("offline");
      return;
    }
    if (attempts >= MAX_RECONNECTS) {
      opts.onStatus("offline");
      return;
    }
    opts.onStatus("connecting");
    const ws = new WebSocketImpl(opts.url);
    socket = ws;
    connectTimer = setTimeout(() => {
      if (stopped || socket !== ws) return;
      ws.close();
    }, CONNECT_TIMEOUT_MS);
    const onOpen = () => {
      clearTimeout(connectTimer);
      // Program-wide logs are the devnet rehearsal. Mainnet watches the one open arena account.
      if (network !== "mainnet") {
        const logs = logsSubscribeCall(nextId++);
        if (!subscribeProblem(logs.method, logs.params)) ws.send(JSON.stringify(logs));
      }
      for (const account of arenas) {
        const call = accountSubscribeCall(nextId, account);
        if (subscribeProblem(call.method, call.params)) continue;
        pendingAccounts.set(nextId, account);
        nextId += 1;
        ws.send(JSON.stringify(call));
      }
      opts.onStatus("live");
    };
    const onMessage = (event: { data?: string }) => {
      if (typeof event.data !== "string") return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const root = message && typeof message === "object" ? (message as Record<string, unknown>) : null;
      if (root && typeof root.id === "number" && typeof root.result === "number") {
        const account = pendingAccounts.get(root.id);
        if (account) {
          subToAccount.set(root.result, account);
          pendingAccounts.delete(root.id);
        }
        return;
      }
      if (root && root.error && typeof root.id === "number" && pendingAccounts.has(root.id)) {
        pendingAccounts.delete(root.id);
        ws.close();
        return;
      }
      parseLogsNotification(message);
      const events = eventsFromAccountNotification(message, opts.channels, now(), (id) => subToAccount.get(id), previous);
      if (events.length) opts.onEvents(events);
    };
    const onClose = () => {
      clearTimeout(connectTimer);
      if (stopped || socket !== ws) return;
      socket = null;
      attempts += 1;
      opts.onStatus("offline");
      if (attempts >= MAX_RECONNECTS) return;
      timer = setTimeout(open, Math.min(10_000, 400 * 2 ** (attempts - 1)));
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onClose);
  };

  open();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(connectTimer);
      socket?.close();
      socket = null;
    },
    retry() {
      if (stopped) return;
      attempts = 0;
      clearTimeout(timer);
      clearTimeout(connectTimer);
      socket?.close();
      socket = null;
      open();
    },
  };
}
