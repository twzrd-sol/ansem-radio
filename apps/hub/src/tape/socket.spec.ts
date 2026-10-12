import { describe, expect, it, vi } from "vitest";

import { ARENA_PROGRAM } from "../chain/config";
import { CONNECT_TIMEOUT_MS, MAX_RECONNECTS } from "./policy";
import { createTapeClient, type SocketCtor } from "./socket";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>();
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  emit(type: string, event: { data?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("tape socket", () => {
  it("subscribes to arena logs and known arena accounts, and ignores generic logs", () => {
    FakeSocket.instances = [];
    const events: unknown[] = [];
    const statuses: string[] = [];
    const client = createTapeClient({
      channels: [{ slug: "radiolanlive", name: "Radio LAN", arena: "Arena111111111111111111111111111111111111111" }],
      url: "ws://localhost/hub/rpc",
      onEvents: (incoming) => events.push(...incoming),
      onStatus: (status) => statuses.push(status),
      WebSocketImpl: FakeSocket as unknown as SocketCtor,
    });
    const ws = FakeSocket.instances[0]!;
    ws.open();
    const methods = ws.sent.map((row) => JSON.parse(row).method);
    expect(methods).toContain("logsSubscribe");
    expect(methods).toContain("accountSubscribe");
    expect(JSON.parse(ws.sent[0]!).params[0].mentions).toEqual([ARENA_PROGRAM]);
    ws.emit("message", {
      data: JSON.stringify({
        method: "logsNotification",
        params: { subscription: 1, result: { context: { slot: 8 }, value: { signature: "sig", err: null, logs: [`Program ${ARENA_PROGRAM} invoke [1]`] } } },
      }),
    });
    expect(events).toEqual([]);
    expect(statuses).toContain("live");
    client.stop();
  });

  it("on mainnet subscribes only to the arena account", () => {
    FakeSocket.instances = [];
    const client = createTapeClient({
      channels: [{ slug: "radiolanlive", name: "Radio LAN", arena: "Arena111111111111111111111111111111111111111" }],
      url: "wss://radiolan.live/hub/rpc",
      network: "mainnet",
      onEvents: () => {},
      onStatus: () => {},
      WebSocketImpl: FakeSocket as unknown as SocketCtor,
    });
    const ws = FakeSocket.instances[0]!;
    ws.open();
    const methods = ws.sent.map((row) => JSON.parse(row).method);
    expect(methods).toEqual(["accountSubscribe"]);
    expect(JSON.parse(ws.sent[0]!).params[0]).toBe("Arena111111111111111111111111111111111111111");
    client.stop();
  });

  it("goes offline without a URL and bounds reconnects", () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const statuses: string[] = [];
    const client = createTapeClient({
      channels: [],
      url: "ws://localhost/hub/rpc",
      onEvents: () => {},
      onStatus: (status) => statuses.push(status),
      WebSocketImpl: FakeSocket as unknown as SocketCtor,
    });
    for (let i = 0; i < MAX_RECONNECTS; i += 1) {
      FakeSocket.instances.at(-1)?.close();
      vi.runOnlyPendingTimers();
    }
    expect(FakeSocket.instances.length).toBeLessThanOrEqual(MAX_RECONNECTS);
    expect(statuses.at(-1)).toBe("offline");
    client.stop();
    vi.useRealTimers();
  });

  it("gives up a hung handshake instead of staying on connecting", () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const statuses: string[] = [];
    const client = createTapeClient({
      channels: [],
      url: "ws://localhost/hub/rpc",
      onEvents: () => {},
      onStatus: (status) => statuses.push(status),
      WebSocketImpl: FakeSocket as unknown as SocketCtor,
    });
    expect(statuses.at(-1)).toBe("connecting");
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(FakeSocket.instances[0]!.readyState).toBe(3);
    expect(statuses).toContain("offline");
    client.stop();
    vi.useRealTimers();
  });

  it("stays offline when no websocket URL can be used", () => {
    const statuses: string[] = [];
    const client = createTapeClient({
      channels: [],
      url: null,
      onEvents: () => {},
      onStatus: (status) => statuses.push(status),
    });
    expect(statuses).toEqual(["offline"]);
    client.stop();
  });
});
