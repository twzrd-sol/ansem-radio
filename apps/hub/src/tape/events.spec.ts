import { describe, expect, it } from "vitest";

import { ARENA_PROGRAM } from "../chain/config";
import {
  classifyArenaChange,
  eventsFromAccountNotification,
  listingKey,
  tapeListings,
  parseLogsNotification,
  snapshotFromArena,
  type ArenaSnapshot,
  type ChannelRef,
} from "./events";

function arenaBytes(over: Partial<{ closed: boolean; positions: bigint; total: bigint; seasonStart: bigint; seasonSeconds: bigint }> = {}): Uint8Array {
  const arena = new Uint8Array(112);
  arena.set(new TextEncoder().encode("RLARENA1"), 0);
  arena[9] = 6;
  arena[10] = over.closed ? 1 : 0;
  arena.set(new Uint8Array(32).fill(3), 16);
  arena.set(new Uint8Array(32).fill(4), 48);
  const view = new DataView(arena.buffer);
  view.setBigInt64(80, over.seasonStart ?? 1_775_000_000n, true);
  view.setBigUint64(88, over.seasonSeconds ?? 60n, true);
  view.setBigUint64(96, over.positions ?? 1n, true);
  view.setBigUint64(104, over.total ?? 1_000_000n, true);
  return arena;
}

function snap(over: Partial<ArenaSnapshot> = {}): ArenaSnapshot {
  return {
    account: "Arena111111111111111111111111111111111111111",
    closed: false,
    positions: 2n,
    total: 1_000_000n,
    seasonStart: 1_775_000_000n,
    seasonSeconds: 60n,
    atSeconds: 1_775_000_010n,
    ...over,
  };
}

function notice(slot: number, subscription: number, data: Uint8Array, owner = ARENA_PROGRAM) {
  return {
    jsonrpc: "2.0",
    method: "accountNotification",
    params: {
      subscription,
      result: {
        context: { slot },
        value: { owner, data: [btoa(String.fromCharCode(...data)), "base64"], lamports: 1 },
      },
    },
  };
}

const channels: ChannelRef[] = [{ slug: "radiolanlive", name: "Radio LAN", arena: "Arena111111111111111111111111111111111111111" }];

describe("arena activity classification", () => {
  it("uses the first account read as a baseline, not a fabricated event", () => {
    expect(classifyArenaChange(null, snap())).toEqual([]);
  });

  it("classifies deposits, withdrawals, season opens, and closes without quoting totals", () => {
    const deposit = classifyArenaChange(snap(), snap({ total: 2_000_000n, positions: 3n }));
    expect(deposit).toEqual([expect.objectContaining({ kind: "deposit", participants: 3, summary: "Deposit · comes back 1:1 · 3 participants" })]);
    expect(JSON.stringify(deposit)).not.toMatch(/2000000|2,000,000|RLAN|Raydium|price/);

    const withdraw = classifyArenaChange(snap({ total: 2_000_000n }), snap({ total: 500_000n, positions: 1n }));
    expect(withdraw[0]).toMatchObject({ kind: "withdraw", summary: "Withdrawal · 1 participant" });

    const season = classifyArenaChange(snap({ atSeconds: 1_775_000_010n }), snap({ atSeconds: 1_775_000_070n }));
    expect(season[0]).toMatchObject({ kind: "season", season: 2, summary: "Season 2 opened" });

    const closed = classifyArenaChange(snap(), snap({ closed: true }));
    expect(closed[0]).toMatchObject({ kind: "closed", summary: "Arena closed · 2 participants" });
  });

  it("ignores generic program logs and foreign account owners", () => {
    expect(
      parseLogsNotification({
        method: "logsNotification",
        params: { subscription: 1, result: { context: { slot: 9 }, value: { signature: "sig", err: null, logs: [`Program ${ARENA_PROGRAM} invoke [1]`] } } },
      }),
    ).toBeNull();
    const previous = new Map<string, ArenaSnapshot>();
    expect(eventsFromAccountNotification(notice(10, 1, arenaBytes(), "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), channels, 1_000, () => channels[0]!.arena ?? undefined, previous)).toEqual([]);
  });

  it("emits a deposit only after a later subscribed account write", () => {
    const previous = new Map<string, ArenaSnapshot>();
    const account = channels[0]!.arena!;
    const first = eventsFromAccountNotification(notice(10, 1, arenaBytes({ total: 1_000_000n })), channels, 1_000, () => account, previous);
    const second = eventsFromAccountNotification(notice(11, 1, arenaBytes({ total: 2_500_000n, positions: 2n })), channels, 2_000, () => account, previous);
    expect(first).toEqual([]);
    expect(snapshotFromArena(account, arenaBytes(), 1n)?.total).toBe(1_000_000n);
    expect(second).toEqual([
      expect.objectContaining({ kind: "deposit", channel: "Radio LAN", slug: "radiolanlive", slot: 11, summary: "Deposit · comes back 1:1 · 2 participants" }),
    ]);
  });

  it("subscribes a mainnet tape only to the open featured arena", () => {
    const open = { slug: "radiolanlive", name: "Radio LAN", kind: "featured", backingOpen: true, arena: { address: "Arena111111111111111111111111111111111111111" } };
    const other = { slug: "other", name: "Other", kind: "tracked", backingOpen: true, arena: { address: "Arena222222222222222222222222222222222222222" } };
    expect(tapeListings([open, other], true).map((row) => row.slug)).toEqual(["radiolanlive"]);
    expect(tapeListings([open, other], false).map((row) => row.slug)).toEqual(["radiolanlive", "other"]);
    expect(tapeListings([{ ...open, backingOpen: false }], true)).toEqual([]);
    expect(tapeListings([{ ...open, kind: "tracked" }], true)).toEqual([]);
  });

  it("treats a fresh empty listings array as the same tape identity", () => {
    expect(listingKey([])).toBe(listingKey([]));
    expect(listingKey([{ slug: "radiolanlive", name: "Radio LAN", arena: { address: "Arena111111111111111111111111111111111111111" } }])).toBe(
      listingKey([{ slug: "radiolanlive", name: "Radio LAN", arena: { address: "Arena111111111111111111111111111111111111111" } }]),
    );
  });
});
