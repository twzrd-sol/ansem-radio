// The backing flow (plan section 6): connect -> build -> simulate -> review -> sign -> send -> confirm, one step per
// tap. Pure functions over injected ports, so every branch is tested without a wallet or a network.
import { address, type Address } from "@solana/kit";

import {
  ARENA_ERRORS,
  ARENA_LEN,
  arenaAddress,
  decodeArena,
  decodePosition,
  depositInstruction,
  initArenaInstruction,
  positionAddress,
  POSITION_LEN,
  requestWithdrawInstruction,
  supportAddress,
  withdrawInstruction,
  type ArenaAccount,
  type PositionAccount,
} from "./arena";
import { DEVNET_GENESIS_HASH } from "./config";
import type { RpcPort } from "./rpc";
import { mostRecentMondayUtc, seasonIndex, withdrawAvailableAt } from "./season";
import { compileWire, isFullySigned, signatureOf } from "./tx";

/** The fan's three actions, plus "init": the official streamer creating the devnet arena (one time, devnet only). */
export type FlowAction = "deposit" | "request" | "withdraw" | "init";
export type FlowFailure = "simulation" | "network" | "expired" | "wrong-network" | "no-arena" | "no-tokens" | "failed-onchain" | "not-streamer";

export interface WalletPort {
  /** The connected account; connecting happens before the flow, when the fan taps an on-chain action. */
  address: Address;
  signTransaction(wire: Uint8Array): Promise<Uint8Array>;
}

export interface Pending {
  signature: string;
  action: FlowAction;
  fan: string;
  lastValidBlockHeight: string;
  /** The position before signing (amount in base units and state), to tell a landed transaction from an expired one. */
  before: { amount: string; state: "active" | "requested" } | null;
}

export interface PendingStore {
  load(): Pending | null;
  save(pending: Pending): void;
  clear(): void;
}

export interface TxPlan {
  action: FlowAction;
  fan: Address;
  arena: Address;
  position: Address;
  support: Address;
  /** Base units moved: the deposit, the amount asked back, or everything on withdraw. */
  amount: bigint;
  source: Address | null;
  destination: Address | null;
  /** Rent the fan pays on a first deposit, or gets back on a full withdrawal. */
  rentLamports: bigint;
  feeLamports: bigint;
  /** Unix seconds when a request made now becomes available (deposit, request). */
  releaseAt: bigint | null;
  onchainSeason: bigint;
  cancelsRequest: boolean;
  /** The position as read before building. */
  positionBefore: { amount: bigint; state: "active" | "requested" } | null;
  /** init only: the schedule the arena will store, fixed at creation. */
  schedule: { seasonStart: bigint; seasonSeconds: bigint } | null;
  wire: Uint8Array;
  lastValidBlockHeight: bigint;
}

export type FlowState =
  | { step: "idle" }
  | { step: "working"; label: string }
  | { step: "review"; plan: TxPlan; notice?: "not-signed" }
  | { step: "signing"; plan: TxPlan }
  | { step: "confirming"; signature: string; action: FlowAction }
  | { step: "done"; signature: string; action: FlowAction; position: PositionAccount | null }
  | { step: "failed"; kind: FlowFailure; detail?: string };

export const FEE_LAMPORTS = 5000n;

export interface ChainView {
  arena: ArenaAccount | null;
  arenaAddress: Address;
  position: PositionAccount | null;
  token: { address: Address; amount: bigint } | null;
}

export async function readChain(rpc: RpcPort, target: { streamer: Address; mint: Address }, fan: Address | null): Promise<ChainView> {
  const at = await arenaAddress(target.streamer, target.mint);
  const arenaAccount = await rpc.account(at);
  const arena = arenaAccount ? decodeArena(arenaAccount.data) : null;
  if (!fan) return { arena, arenaAddress: at, position: null, token: null };
  const positionAccount = await rpc.account(await positionAddress(at, fan));
  const position = positionAccount ? decodePosition(positionAccount.data) : null;
  const token = await rpc.tokenAccount(fan, target.mint);
  return { arena, arenaAddress: at, position, token };
}

/** Refuses to build for any cluster but devnet (plan sections 6 and 13). */
export async function onDevnet(rpc: RpcPort): Promise<boolean> {
  return (await rpc.genesisHash()) === DEVNET_GENESIS_HASH;
}

const explain = (error: { code: number } | { message: string }) => ("code" in error ? ARENA_ERRORS[error.code] ?? `The program refused it (error ${error.code}).` : error.message);

/** connect is done; build, simulate, and stop at review. Nothing is signed or sent. */
export async function prepare(rpc: RpcPort, input: { action: FlowAction; fan: Address; streamer: Address; mint: Address; amount: bigint; now: bigint }): Promise<FlowState> {
  try {
    if (!(await onDevnet(rpc))) return { step: "failed", kind: "wrong-network", detail: "The RPC is not Solana devnet, so nothing was built." };
    const view = await readChain(rpc, input, input.fan);
    if (!view.arena) return { step: "failed", kind: "no-arena", detail: "No arena exists yet for the official streamer and this build's devnet test mint." };
    const arena = view.arena;
    const at = view.arenaAddress;
    const position = await positionAddress(at, input.fan);
    const support = await supportAddress(at, input.fan);
    const season = seasonIndex(arena.seasonStart, arena.seasonSeconds, input.now);
    const releaseAt = withdrawAvailableAt(arena.seasonStart, arena.seasonSeconds, season);
    let instruction;
    let amount = 0n;
    let rentLamports = 0n;
    let source: Address | null = null;
    let destination: Address | null = null;
    if (input.action === "deposit") {
      if (arena.closed) return { step: "failed", kind: "simulation", detail: ARENA_ERRORS[6304] };
      if (!view.token || view.token.amount < input.amount) return { step: "failed", kind: "no-tokens", detail: "Your wallet does not hold enough of this token on devnet." };
      amount = input.amount;
      source = view.token.address;
      if (!view.position) rentLamports = (await rpc.rentExemption(POSITION_LEN)) + (await rpc.rentExemption(165));
      instruction = await depositInstruction({ fan: input.fan, streamer: input.streamer, mint: input.mint, source, amount });
    } else if (input.action === "request") {
      if (!view.position) return { step: "failed", kind: "simulation", detail: "There is no position to withdraw." };
      amount = view.position.amount;
      instruction = await requestWithdrawInstruction({ fan: input.fan, streamer: input.streamer, mint: input.mint });
    } else {
      if (!view.position) return { step: "failed", kind: "simulation", detail: "There is no position to withdraw." };
      if (!view.token) return { step: "failed", kind: "no-tokens", detail: "Your wallet has no account for this token to receive it." };
      amount = view.position.amount;
      destination = view.token.address;
      const pos = await rpc.account(position);
      const sup = await rpc.account(support);
      rentLamports = (pos?.lamports ?? 0n) + (sup?.lamports ?? 0n);
      instruction = await withdrawInstruction({ fan: input.fan, streamer: input.streamer, mint: input.mint, destination, amount });
    }
    const lifetime = await rpc.latestBlockhash();
    const wire = compileWire(input.fan, instruction, lifetime);
    const simulation = await rpc.simulate(wire);
    if (simulation.error) return { step: "failed", kind: "simulation", detail: explain(simulation.error) };
    return {
      step: "review",
      plan: {
        action: input.action,
        fan: input.fan,
        arena: at,
        position,
        support,
        amount,
        source,
        destination,
        rentLamports,
        feeLamports: FEE_LAMPORTS,
        releaseAt: input.action === "withdraw" ? null : releaseAt,
        onchainSeason: season,
        cancelsRequest: input.action === "deposit" && view.position?.state === "requested",
        positionBefore: view.position ? { amount: view.position.amount, state: view.position.state } : null,
        schedule: null,
        wire,
        lastValidBlockHeight: lifetime.lastValidBlockHeight,
      },
    };
  } catch (e) {
    return { step: "failed", kind: "network", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Seasons of the official arena: 7 days, rolling over Monday 00:00 UTC (docs/examples/arena-mainnet/INIT.md). */
export const SETUP_SEASON_SECONDS = 604_800n;

/**
 * The streamer-setup step (FOUNDER_HUB_CHECK.md Part B): build and simulate `init_arena` for the official streamer's
 * devnet arena. Only the official streamer key can sign it, so the connected wallet must be that key; the arena must
 * not exist yet; devnet only, like every build here. Nothing is signed or sent.
 */
export async function prepareSetup(rpc: RpcPort, input: { signer: Address; streamer: Address; mint: Address; now: bigint }): Promise<FlowState> {
  try {
    if (!(await onDevnet(rpc))) return { step: "failed", kind: "wrong-network", detail: "The RPC is not Solana devnet, so nothing was built." };
    if (input.signer !== input.streamer) return { step: "failed", kind: "not-streamer", detail: "The connected wallet is not the official streamer key, which is the only key that can create this arena." };
    const at = await arenaAddress(input.streamer, input.mint);
    if (await rpc.account(at)) return { step: "failed", kind: "simulation", detail: ARENA_ERRORS[6300] };
    const seasonStart = mostRecentMondayUtc(input.now);
    const instruction = await initArenaInstruction({ streamer: input.streamer, mint: input.mint, seasonStart, seasonSeconds: SETUP_SEASON_SECONDS, now: input.now });
    const rentLamports = await rpc.rentExemption(ARENA_LEN);
    const lifetime = await rpc.latestBlockhash();
    const wire = compileWire(input.streamer, instruction, lifetime);
    const simulation = await rpc.simulate(wire);
    if (simulation.error) return { step: "failed", kind: "simulation", detail: explain(simulation.error) };
    return {
      step: "review",
      plan: {
        action: "init",
        fan: input.streamer,
        arena: at,
        position: at,
        support: at,
        amount: 0n,
        source: null,
        destination: null,
        rentLamports,
        feeLamports: FEE_LAMPORTS,
        releaseAt: null,
        onchainSeason: seasonIndex(seasonStart, SETUP_SEASON_SECONDS, input.now),
        cancelsRequest: false,
        positionBefore: null,
        schedule: { seasonStart, seasonSeconds: SETUP_SEASON_SECONDS },
        wire,
        lastValidBlockHeight: lifetime.lastValidBlockHeight,
      },
    };
  } catch (e) {
    return { step: "failed", kind: "network", detail: e instanceof Error ? e.message : String(e) };
  }
}

export interface PollOptions {
  intervalMs: number;
  sleep?: (ms: number) => Promise<void>;
}
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll one signature until it lands, fails, or its blockhash expires. Never resubmits. Once the blockhash has
 * expired, the last check searches ledger history, because a signature older than the node's recent-status cache
 * reads as unknown even when it landed (a slow return from a wallet app).
 */
export async function confirm(rpc: RpcPort, signature: string, lastValidBlockHeight: bigint, options: PollOptions): Promise<"confirmed" | "failed" | "expired"> {
  const sleep = options.sleep ?? defaultSleep;
  for (;;) {
    const status = await rpc.status(signature);
    if (status !== "pending") return status;
    if ((await rpc.blockHeight()) > lastValidBlockHeight) {
      const final = await rpc.status(signature, { history: true });
      return final === "pending" ? "expired" : final;
    }
    await sleep(options.intervalMs);
  }
}

type Before = { amount: bigint; state: "active" | "requested" } | null;

/** Did the account change the way this action changes it? The chain decides, not the page's memory. */
function landed(action: FlowAction, before: Before, after: PositionAccount | null, exists: boolean): boolean {
  if (action === "init") return exists;
  if (action === "deposit") return after !== null && after.amount > (before?.amount ?? 0n);
  if (action === "request") return after !== null && after.state === "requested" && before?.state === "active";
  return before !== null && after === null;
}

/** `account` is the position, or the arena itself for init. */
async function finish(rpc: RpcPort, signature: string, action: FlowAction, outcome: "confirmed" | "failed" | "expired", account: Address, before: Before, sendError: string | null): Promise<FlowState> {
  const read = await rpc.account(account);
  const after = read && action !== "init" ? decodePosition(read.data) : null;
  if (outcome === "confirmed" || (outcome === "expired" && landed(action, before, after, read !== null))) return { step: "done", signature, action, position: after };
  const why = sendError ? ` The network said: ${sendError}` : "";
  if (outcome === "expired") return { step: "failed", kind: "expired", detail: `It was not confirmed before its blockhash expired, and ${action === "init" ? "the arena was not created" : "your position is unchanged"}.${why}` };
  return { step: "failed", kind: "failed-onchain", detail: `Transaction ${signature} failed on chain.${why}` };
}

/**
 * Sign once and send once. The signature is stored before sending, so a reload or a return from the wallet app
 * polls it instead of building again (plan section 6).
 */
export async function signAndSend(rpc: RpcPort, wallet: WalletPort, store: PendingStore, plan: TxPlan, options: PollOptions): Promise<FlowState> {
  try {
    if ((await rpc.blockHeight()) > plan.lastValidBlockHeight) return { step: "failed", kind: "expired", detail: "The review is out of date; build it again before signing." };
  } catch (e) {
    return { step: "failed", kind: "network", detail: e instanceof Error ? e.message : String(e) };
  }
  let signed: Uint8Array;
  try {
    signed = await wallet.signTransaction(plan.wire);
  } catch {
    return { step: "review", plan, notice: "not-signed" };
  }
  if (!isFullySigned(signed) || signatureOf(signed) === undefined) return { step: "review", plan, notice: "not-signed" };
  const signature = signatureOf(signed);
  const before = plan.positionBefore;
  store.save({ signature, action: plan.action, fan: plan.fan, lastValidBlockHeight: plan.lastValidBlockHeight.toString(), before: before ? { amount: before.amount.toString(), state: before.state } : null });
  let sendError: string | null = null;
  try {
    await rpc.send(signed);
  } catch (e) {
    // It may still have landed; the stored signature decides, never a second send. Keep the reason in case not.
    sendError = e instanceof Error ? e.message : String(e);
  }
  try {
    const outcome = await confirm(rpc, signature, plan.lastValidBlockHeight, options);
    const state = await finish(rpc, signature, plan.action, outcome, plan.position, before, sendError);
    store.clear();
    return state;
  } catch (e) {
    return { step: "failed", kind: "network", detail: `${e instanceof Error ? e.message : String(e)} Transaction ${signature} may still land; reopen this page to check it.` };
  }
}

/** On load: a stored signature is polled, never rebuilt or resent. */
export async function resume(rpc: RpcPort, store: PendingStore, target: { streamer: Address; mint: Address }, options: PollOptions): Promise<FlowState | null> {
  const pending = store.load();
  if (!pending) return null;
  try {
    const outcome = await confirm(rpc, pending.signature, BigInt(pending.lastValidBlockHeight), options);
    const at = await arenaAddress(target.streamer, target.mint);
    const position = pending.action === "init" ? at : await positionAddress(at, address(pending.fan));
    const before = pending.before ? { amount: BigInt(pending.before.amount), state: pending.before.state } : null;
    const state = await finish(rpc, pending.signature, pending.action, outcome, position, before, null);
    store.clear();
    return state;
  } catch (e) {
    return { step: "failed", kind: "network", detail: `${e instanceof Error ? e.message : String(e)} Transaction ${pending.signature} is still being checked.` };
  }
}

/** sessionStorage-backed store: one pending signature per tab, public data only (a signature, never a key). */
export function sessionPendingStore(key = "radiolan-hub:pending"): PendingStore {
  return {
    load() {
      try {
        const raw = window.sessionStorage.getItem(key);
        return raw ? (JSON.parse(raw) as Pending) : null;
      } catch {
        return null;
      }
    },
    save(pending) {
      try {
        window.sessionStorage.setItem(key, JSON.stringify(pending));
      } catch {
        /* storage unavailable: the flow still confirms in this view */
      }
    },
    clear() {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        /* nothing stored */
      }
    },
  };
}
