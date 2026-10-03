// Every branch of the backing flow with mock ports: no wallet, no network, nothing signed or sent for real.
import { address, getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { arenaAddress, positionAddress, supportAddress } from "./arena";
import { DEVNET_GENESIS_HASH } from "./config";
import { prepare, prepareSetup, resume, SETUP_SEASON_SECONDS, signAndSend, type FlowState, type Pending, type PendingStore, type TxPlan, type WalletPort } from "./flow";
import type { RpcPort, SimulationError } from "./rpc";
import { mostRecentMondayUtc } from "./season";
import { signatureOf } from "./tx";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const streamer = address("EatwUpB2eCRcCEJgvQvzNb1hiPKqasjzXQ7NtVVFuLYX");
const mint = address("9ocVrg8z6wva3Z7A3rLYU4fWXFXWWf6sC4aGV7fgSJuN");
const fan = key(7);
const tokenAccount = key(8);
const BLOCKHASH = getAddressDecoder().decode(new Uint8Array(32).fill(11)) as string;
const SEASON_START = 1_790_000_000n;
const SEASON_SECONDS = 604_800n;
const NOW = SEASON_START + 11n * SEASON_SECONDS + 3_600n; // on-chain season 12
const poll = { intervalMs: 0, sleep: async () => {} };

function arenaData(closed = false) {
  const d = new Uint8Array(112);
  d.set(new TextEncoder().encode("RLARENA1"), 0);
  d[9] = 6;
  d[10] = closed ? 1 : 0;
  d.set(getAddressEncoder().encode(streamer), 16);
  d.set(getAddressEncoder().encode(mint), 48);
  const v = new DataView(d.buffer);
  v.setBigInt64(80, SEASON_START, true);
  v.setBigUint64(88, SEASON_SECONDS, true);
  return d;
}
async function positionData(amount: bigint, requested: boolean) {
  const d = new Uint8Array(104);
  d.set(new TextEncoder().encode("RLPOSIT1"), 0);
  d[10] = requested ? 1 : 0;
  d.set(getAddressEncoder().encode(await arenaAddress(streamer, mint)), 16);
  d.set(getAddressEncoder().encode(fan), 48);
  const v = new DataView(d.buffer);
  v.setBigUint64(80, amount, true);
  v.setBigUint64(88, 12n, true);
  return d;
}

interface Mock extends RpcPort {
  calls: string[];
  accounts: Map<string, { data: Uint8Array; lamports: bigint }>;
}
function mockRpc(opts: { genesis?: string; simulateError?: SimulationError | null; tokens?: bigint | null; heights?: bigint[]; statuses?: Array<"confirmed" | "failed" | "pending">; history?: "confirmed" | "failed" | "pending"; sendThrows?: string } = {}): Mock {
  const heights = [...(opts.heights ?? [100n])];
  const statuses = [...(opts.statuses ?? ["confirmed"])];
  const accounts = new Map<string, { data: Uint8Array; lamports: bigint }>();
  const calls: string[] = [];
  return {
    calls,
    accounts,
    genesisHash: async () => (calls.push("genesis"), opts.genesis ?? DEVNET_GENESIS_HASH),
    latestBlockhash: async () => (calls.push("blockhash"), { blockhash: BLOCKHASH, lastValidBlockHeight: 150n }),
    blockHeight: async () => (calls.push("height"), heights.length > 1 ? heights.shift()! : heights[0]!),
    simulate: async () => (calls.push("simulate"), { error: opts.simulateError ?? null, logs: [] }),
    send: async () => {
      calls.push("send");
      if (opts.sendThrows) throw new Error(opts.sendThrows);
      return "unused";
    },
    status: async (_signature: string, options?: { history?: boolean }) => {
      if (options?.history) return calls.push("status:history"), opts.history ?? "pending";
      return calls.push("status"), statuses.length > 1 ? statuses.shift()! : statuses[0]!;
    },
    account: async (at: Address) => (calls.push(`account:${at.slice(0, 4)}`), accounts.get(at) ?? null),
    rentExemption: async (size: number) => (calls.push(`rent:${size}`), BigInt((128 + size) * 6960)),
    tokenAccount: async () => (calls.push("token"), opts.tokens === null ? null : { address: tokenAccount, amount: opts.tokens ?? 1_000_000_000n }),
  };
}
async function withArena(rpc: Mock, opts: { closed?: boolean; position?: { amount: bigint; requested: boolean } } = {}) {
  const at = await arenaAddress(streamer, mint);
  rpc.accounts.set(at, { data: arenaData(opts.closed), lamports: 1n });
  if (opts.position) {
    rpc.accounts.set(await positionAddress(at, fan), { data: await positionData(opts.position.amount, opts.position.requested), lamports: 1_614_720n });
    rpc.accounts.set(await supportAddress(at, fan), { data: new Uint8Array(165), lamports: 2_039_280n });
  }
  return rpc;
}
function memoryStore(initial: Pending | null = null): PendingStore & { saved: Pending[]; current: Pending | null } {
  const store = {
    saved: [] as Pending[],
    current: initial,
    load: () => store.current,
    save: (p: Pending) => {
      store.saved.push(p);
      store.current = p;
    },
    clear: () => {
      store.current = null;
    },
  };
  return store;
}
/** A wallet that fills the one signature slot (64 non-zero bytes after the compact length). */
function mockWallet(opts: { reject?: boolean } = {}): WalletPort & { signed: number } {
  const w = {
    address: fan,
    signed: 0,
    async signTransaction(wire: Uint8Array) {
      if (opts.reject) throw new Error("User rejected the request.");
      w.signed += 1;
      const out = wire.slice();
      out.fill(9, 1, 65);
      return out;
    },
  };
  return w;
}
const deposit = (amount = 250_000_000n) => ({ action: "deposit" as const, fan, streamer, mint, amount, now: NOW });
const reviewPlan = (state: FlowState): TxPlan => {
  if (state.step !== "review") throw new Error(`expected review, got ${state.step}`);
  return state.plan;
};

describe("prepare: build and simulate, never sign", () => {
  it("refuses any cluster but devnet before building", async () => {
    const rpc = await withArena(mockRpc({ genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" }));
    const state = await prepare(rpc, deposit());
    expect(state).toMatchObject({ step: "failed", kind: "wrong-network" });
    expect(rpc.calls).toEqual(["genesis"]);
  });

  it("reports a missing arena", async () => {
    expect(await prepare(mockRpc(), deposit())).toMatchObject({ step: "failed", kind: "no-arena" });
  });

  it("stops on a failed simulation with the program's reason, so the wallet never opens", async () => {
    const rpc = await withArena(mockRpc({ simulateError: { code: 6305 } }));
    const state = await prepare(rpc, deposit());
    expect(state).toEqual({ step: "failed", kind: "simulation", detail: "Locked until the on-chain season you asked in ends." });
    expect(rpc.calls).not.toContain("send");
  });

  it("refuses a deposit into a closed arena and one larger than the balance", async () => {
    expect(await prepare(await withArena(mockRpc(), { closed: true }), deposit())).toMatchObject({ step: "failed", detail: "The arena is closed to new backing." });
    expect(await prepare(await withArena(mockRpc({ tokens: 10n })), deposit())).toMatchObject({ step: "failed", kind: "no-tokens" });
  });

  it("builds a first deposit with rent, the release date from the arena's own schedule, and no request to cancel", async () => {
    const rpc = await withArena(mockRpc());
    const plan = reviewPlan(await prepare(rpc, deposit()));
    expect(plan.amount).toBe(250_000_000n);
    expect(plan.source).toBe(tokenAccount);
    expect(plan.rentLamports).toBe(3_654_000n);
    expect(plan.onchainSeason).toBe(12n);
    expect(plan.releaseAt).toBe(SEASON_START + 12n * SEASON_SECONDS);
    expect(plan.cancelsRequest).toBe(false);
    expect(plan.lastValidBlockHeight).toBe(150n);
    expect(rpc.calls.indexOf("simulate")).toBeGreaterThan(rpc.calls.indexOf("blockhash"));
  });

  it("flags that a deposit cancels a pending request, and charges no rent for an existing position", async () => {
    const plan = reviewPlan(await prepare(await withArena(mockRpc(), { position: { amount: 100n, requested: true } }), deposit()));
    expect(plan.cancelsRequest).toBe(true);
    expect(plan.rentLamports).toBe(0n);
  });

  it("withdraws everything to the fan's token account and gives back both rents", async () => {
    const rpc = await withArena(mockRpc(), { position: { amount: 250_000_000n, requested: true } });
    const plan = reviewPlan(await prepare(rpc, { ...deposit(), action: "withdraw" }));
    expect(plan.amount).toBe(250_000_000n);
    expect(plan.destination).toBe(tokenAccount);
    expect(plan.rentLamports).toBe(1_614_720n + 2_039_280n);
    expect(plan.releaseAt).toBeNull();
  });
});

describe("signAndSend: one signature, one send, confirm by polling", () => {
  it("signs once, stores the signature before sending, sends once, and reads the position back", async () => {
    const rpc = await withArena(mockRpc({ statuses: ["pending", "confirmed"] }), { position: { amount: 250_000_000n, requested: false } });
    const plan = reviewPlan(await prepare(rpc, deposit()));
    const wallet = mockWallet();
    const store = memoryStore();
    let storedAtSend: string | undefined;
    const send = rpc.send;
    rpc.send = async (wire) => {
      storedAtSend = store.current?.signature;
      return send(wire);
    };
    const state = await signAndSend(rpc, wallet, store, plan, poll);
    expect(state).toMatchObject({ step: "done", action: "deposit" });
    expect(storedAtSend, "the signature is stored before the send").toBe(signatureOf(await mockWallet().signTransaction(plan.wire)));
    expect(state.step === "done" && state.position?.amount).toBe(250_000_000n);
    expect(wallet.signed).toBe(1);
    expect(rpc.calls.filter((c) => c === "send")).toHaveLength(1);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.signature).toBe(signatureOf(await mockWallet().signTransaction(plan.wire)));
    expect(store.current).toBeNull();
  });

  it("goes back to review when the wallet does not sign, and sends nothing", async () => {
    const rpc = await withArena(mockRpc());
    const plan = reviewPlan(await prepare(rpc, deposit()));
    const store = memoryStore();
    const state = await signAndSend(rpc, mockWallet({ reject: true }), store, plan, poll);
    expect(state).toEqual({ step: "review", plan, notice: "not-signed" });
    expect(rpc.calls).not.toContain("send");
    expect(store.saved).toHaveLength(0);
  });

  it("asks for a fresh review when the blockhash expired before signing; the wallet never opens", async () => {
    const rpc = await withArena(mockRpc({ heights: [151n] }));
    const plan = reviewPlan(await prepare(rpc, deposit()));
    const wallet = mockWallet();
    expect(await signAndSend(rpc, wallet, memoryStore(), plan, poll)).toMatchObject({ step: "failed", kind: "expired" });
    expect(wallet.signed).toBe(0);
  });

  it("confirms by polling when the send errors but the transaction landed, without a second send", async () => {
    const rpc = await withArena(mockRpc({ sendThrows: "socket closed", statuses: ["pending", "confirmed"] }));
    const plan = reviewPlan(await prepare(rpc, deposit()));
    expect(await signAndSend(rpc, mockWallet(), memoryStore(), plan, poll)).toMatchObject({ step: "done" });
    expect(rpc.calls.filter((c) => c === "send")).toHaveLength(1);
  });

  it("reports expiry when the blockhash runs out while still pending, and forgets the signature", async () => {
    const rpc = await withArena(mockRpc({ heights: [100n, 100n, 160n], statuses: ["pending"] }));
    const plan = reviewPlan(await prepare(rpc, deposit()));
    const store = memoryStore();
    expect(await signAndSend(rpc, mockWallet(), store, plan, poll)).toMatchObject({ step: "failed", kind: "expired" });
    expect(store.current).toBeNull();
  });
});

describe("after the blockhash expires: the chain decides, not the status cache", () => {
  const signedPending = (before: Pending["before"]): Pending => ({ signature: "5j7s1QzqC9JPsT8NfZQkjq8yiBT8mNfv2NUwvh5V1ZqGRqb6bQqvfiM6bHkhFqcz6BrHVhWB8A1PpGzqHH6vGFa1", action: "deposit", fan, lastValidBlockHeight: "150", before });

  it("finds a landed transaction in ledger history when the recent-status cache has forgotten it", async () => {
    const rpc = await withArena(mockRpc({ statuses: ["pending"], heights: [160n], history: "confirmed" }), { position: { amount: 5n, requested: false } });
    expect(await resume(rpc, memoryStore(signedPending(null)), { streamer, mint }, poll)).toMatchObject({ step: "done" });
    expect(rpc.calls).toContain("status:history");
  });

  it("counts it as landed when history is silent but the position changed the way a deposit changes it", async () => {
    const rpc = await withArena(mockRpc({ statuses: ["pending"], heights: [160n], history: "pending" }), { position: { amount: 300n, requested: false } });
    expect(await resume(rpc, memoryStore(signedPending({ amount: "100", state: "active" })), { streamer, mint }, poll)).toMatchObject({ step: "done" });
  });

  it("reports a real expiry, with the send error's reason, when nothing landed", async () => {
    const rpc = await withArena(mockRpc({ sendThrows: "Blockhash not found", statuses: ["pending"], heights: [100n, 100n, 160n], history: "pending" }));
    const plan = reviewPlan(await prepare(rpc, deposit()));
    const state = await signAndSend(rpc, mockWallet(), memoryStore(), plan, poll);
    expect(state).toMatchObject({ step: "failed", kind: "expired" });
    expect(state.step === "failed" && state.detail).toMatch(/your position is unchanged\. The network said: Blockhash not found/);
  });

  it("reports a failed transaction found in history as failed, not expired", async () => {
    const rpc = await withArena(mockRpc({ statuses: ["pending"], heights: [160n], history: "failed" }));
    expect(await resume(rpc, memoryStore(signedPending(null)), { streamer, mint }, poll)).toMatchObject({ step: "failed", kind: "failed-onchain" });
  });
});

describe("resume: a stored signature is polled, never resent", () => {
  it("finishes a pending transaction after a reload or a return from the wallet app", async () => {
    const rpc = await withArena(mockRpc({ statuses: ["pending", "confirmed"] }), { position: { amount: 5n, requested: false } });
    const store = memoryStore({ signature: "5j7s1QzqC9JPsT8NfZQkjq8yiBT8mNfv2NUwvh5V1ZqGRqb6bQqvfiM6bHkhFqcz6BrHVhWB8A1PpGzqHH6vGFa1", action: "deposit", fan, lastValidBlockHeight: "150", before: null });
    const state = await resume(rpc, store, { streamer, mint }, poll);
    expect(state).toMatchObject({ step: "done", action: "deposit" });
    expect(rpc.calls).not.toContain("send");
    expect(rpc.calls).not.toContain("simulate");
    expect(store.current).toBeNull();
  });

  it("does nothing without a stored signature", async () => {
    expect(await resume(mockRpc(), memoryStore(), { streamer, mint }, poll)).toBeNull();
  });
});

describe("streamer setup: init_arena for the official streamer only (FOUNDER_HUB_CHECK Part B)", () => {
  const MONDAY = 1_790_553_600n; // Mon 2026-09-28 00:00 UTC, the mainnet test arena's start
  const setup = (signer: Address = streamer, now = MONDAY + 3n * 86_400n + 5n) => ({ signer, streamer, mint, now });
  const streamerWallet = () => Object.assign(mockWallet(), { address: streamer });

  it("finds the most recent Monday 00:00 UTC, including Monday itself", () => {
    expect(mostRecentMondayUtc(MONDAY)).toBe(MONDAY);
    expect(mostRecentMondayUtc(MONDAY + 6n * 86_400n + 86_399n)).toBe(MONDAY);
    expect(mostRecentMondayUtc(MONDAY + 7n * 86_400n)).toBe(MONDAY + 7n * 86_400n);
    expect(mostRecentMondayUtc(MONDAY - 1n)).toBe(MONDAY - 7n * 86_400n);
  });

  it("refuses any wallet but the official streamer, before touching the chain", async () => {
    const rpc = mockRpc();
    expect(await prepareSetup(rpc, setup(fan))).toMatchObject({ step: "failed", kind: "not-streamer" });
    expect(rpc.calls).toEqual(["genesis"]);
  });

  it("refuses any cluster but devnet, and an arena that already exists", async () => {
    expect(await prepareSetup(mockRpc({ genesis: "other" }), setup())).toMatchObject({ step: "failed", kind: "wrong-network" });
    expect(await prepareSetup(await withArena(mockRpc()), setup())).toMatchObject({ step: "failed", kind: "simulation", detail: "That account already exists." });
  });

  it("builds init_arena with 7-day seasons from the most recent Monday, the arena's rent, and simulates it", async () => {
    const rpc = mockRpc();
    const plan = reviewPlan(await prepareSetup(rpc, setup()));
    expect(plan).toMatchObject({ action: "init", fan: streamer, amount: 0n, releaseAt: null, onchainSeason: 1n, positionBefore: null });
    expect(plan.arena).toBe(await arenaAddress(streamer, mint));
    expect(plan.position).toBe(plan.arena);
    expect(plan.schedule).toEqual({ seasonStart: MONDAY, seasonSeconds: SETUP_SEASON_SECONDS });
    expect(plan.rentLamports).toBe(BigInt((128 + 112) * 6960));
    expect(rpc.calls).toContain("simulate");
    expect(rpc.calls).not.toContain("send");
    // The wire holds the instruction bytes: tag 0, season_start i64, season_seconds u64.
    const data = new Uint8Array(17);
    data[0] = 0;
    new DataView(data.buffer).setBigInt64(1, MONDAY, true);
    new DataView(data.buffer).setBigUint64(9, SETUP_SEASON_SECONDS, true);
    const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    expect(hex(plan.wire)).toContain(hex(data));
  });

  it("signs once as the streamer, sends once, and reads the arena back", async () => {
    const rpc = mockRpc({ statuses: ["pending", "confirmed"] });
    const plan = reviewPlan(await prepareSetup(rpc, setup()));
    rpc.accounts.set(plan.arena, { data: arenaData(), lamports: 1n });
    const wallet = streamerWallet();
    const store = memoryStore();
    const state = await signAndSend(rpc, wallet, store, plan, poll);
    expect(state).toMatchObject({ step: "done", action: "init", position: null });
    expect(wallet.signed).toBe(1);
    expect(rpc.calls.filter((c) => c === "send")).toHaveLength(1);
    expect(store.saved[0]).toMatchObject({ action: "init", fan: streamer, before: null });
    expect(store.current).toBeNull();
  });

  it("after expiry, counts it as landed only when the arena account exists", async () => {
    const pending = (): Pending => ({ signature: "5j7s1QzqC9JPsT8NfZQkjq8yiBT8mNfv2NUwvh5V1ZqGRqb6bQqvfiM6bHkhFqcz6BrHVhWB8A1PpGzqHH6vGFa1", action: "init", fan: streamer, lastValidBlockHeight: "150", before: null });
    const silent = () => mockRpc({ statuses: ["pending"], heights: [160n], history: "pending" });
    expect(await resume(silent(), memoryStore(pending()), { streamer, mint }, poll)).toMatchObject({ step: "failed", kind: "expired" });
    expect(await resume(await withArena(silent()), memoryStore(pending()), { streamer, mint }, poll)).toMatchObject({ step: "done", action: "init" });
  });
});
