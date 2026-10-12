// Subscribe only to the arena program already on the relay allowlist (#147). ComputeBudget is
// allowlisted for transactions, not for the tape.
import { ARENA_PROGRAM } from "../chain/config";

export const TAPE_PROGRAMS = Object.freeze([ARENA_PROGRAM]);
export const PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const MAX_EVENTS = 80;
export const MAX_SPARK_POINTS = 48;
export const MAX_TICKER = 20;
export const MAX_RECONNECTS = 8;
export const CONNECT_TIMEOUT_MS = 4_000;
export const MAX_ARENA_SUBS = 16;
export const MAX_WS_BYTES = 64 * 1024;

export const SUBSCRIBE_METHODS = Object.freeze(["accountSubscribe", "accountUnsubscribe", "logsSubscribe", "logsUnsubscribe"]);

export function subscribeProblem(method: string, params: unknown[] | undefined, programs: readonly string[] = TAPE_PROGRAMS): string | null {
  if (method === "logsSubscribe") {
    const filter = params?.[0] as { mentions?: unknown } | undefined;
    const mentions = filter?.mentions;
    if (!Array.isArray(mentions) || mentions.length === 0) return "logsSubscribe must name mentions";
    if (mentions.some((item) => typeof item !== "string" || !programs.includes(item))) return "logsSubscribe mentions a program the hub does not use";
    if (!mentions.includes(ARENA_PROGRAM)) return "logsSubscribe must mention the arena program";
    return null;
  }
  if (method === "accountSubscribe") {
    const pubkey = params?.[0];
    if (typeof pubkey !== "string" || !PUBKEY.test(pubkey)) return "accountSubscribe needs an account";
    return null;
  }
  if (method === "accountUnsubscribe" || method === "logsUnsubscribe") return null;
  return "method not relayed";
}

export function logsSubscribeCall(id: number): { jsonrpc: "2.0"; id: number; method: "logsSubscribe"; params: unknown[] } {
  return { jsonrpc: "2.0", id, method: "logsSubscribe", params: [{ mentions: [ARENA_PROGRAM] }, { commitment: "confirmed" }] };
}

export function accountSubscribeCall(id: number, pubkey: string): { jsonrpc: "2.0"; id: number; method: "accountSubscribe"; params: unknown[] } {
  return { jsonrpc: "2.0", id, method: "accountSubscribe", params: [pubkey, { encoding: "base64", commitment: "confirmed" }] };
}
