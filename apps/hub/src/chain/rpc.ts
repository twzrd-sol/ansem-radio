// The RPC port the flow uses, and its implementation over @solana/kit through the relay (plan section 5).
import { address, createSolanaRpc, getBase64Encoder, type Address, type Base64EncodedWireTransaction } from "@solana/kit";

import { wireBase64 } from "./tx";

export type SimulationError = { code: number } | { message: string };

export interface RpcPort {
  genesisHash(): Promise<string>;
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }>;
  blockHeight(): Promise<bigint>;
  simulate(wire: Uint8Array): Promise<{ error: SimulationError | null; logs: string[] }>;
  send(signedWire: Uint8Array): Promise<string>;
  /** `history` searches the node's ledger history, for signatures older than its recent-status cache. */
  status(signature: string, options?: { history?: boolean }): Promise<"confirmed" | "failed" | "pending">;
  account(at: Address): Promise<{ data: Uint8Array; lamports: bigint } | null>;
  rentExemption(size: number): Promise<bigint>;
  /** The fan's token account for the mint with the largest balance, or null. */
  tokenAccount(owner: Address, mint: Address): Promise<{ address: Address; amount: bigint } | null>;
}

/** `{ InstructionError: [0, { Custom: 6305 }] }` and friends, as a program error code or a short message. */
export function simulationError(err: unknown): SimulationError | null {
  if (err === null || err === undefined) return null;
  if (typeof err === "object" && "InstructionError" in err) {
    const detail = (err as { InstructionError: [number, unknown] }).InstructionError[1];
    if (detail && typeof detail === "object" && "Custom" in detail) return { code: Number((detail as { Custom: number | bigint }).Custom) };
    return { message: typeof detail === "string" ? detail : JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) };
  }
  return { message: typeof err === "string" ? err : JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) };
}

const fromBase64 = (b64: string) => new Uint8Array(getBase64Encoder().encode(b64));

/**
 * LiveBack reads an arena (112), a position (104), or a support account (165).
 * The hub relay rejects getAccountInfo unless dataSlice.length is 1..256.
 * A slice longer than the account comes back as the account's own bytes.
 */
export const HUB_ACCOUNT_SLICE = 165;

export function kitRpc(url: string): RpcPort {
  const absolute = typeof window === "undefined" ? url : new URL(url, window.location.origin).toString();
  const rpc = createSolanaRpc(absolute);
  // Constant per cluster: fetched once, which keeps a public-devnet session under its rate limit.
  let genesis: Promise<string> | null = null;
  const rent = new Map<number, Promise<bigint>>();
  return {
    genesisHash: () => (genesis ??= rpc.getGenesisHash().send()),
    async latestBlockhash() {
      const { value } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      return { blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight };
    },
    blockHeight: () => rpc.getBlockHeight({ commitment: "confirmed" }).send(),
    async simulate(wire) {
      const { value } = await rpc.simulateTransaction(wireBase64(wire), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" }).send();
      return { error: simulationError(value.err), logs: [...(value.logs ?? [])] };
    },
    async send(signedWire) {
      return rpc.sendTransaction(wireBase64(signedWire) as Base64EncodedWireTransaction, { encoding: "base64", preflightCommitment: "confirmed" }).send();
    },
    async status(signature, options) {
      const { value } = await rpc.getSignatureStatuses([signature as Parameters<typeof rpc.getSignatureStatuses>[0][number]], { searchTransactionHistory: options?.history ?? false }).send();
      const s = value[0];
      if (!s) return "pending";
      if (s.err) return "failed";
      return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "confirmed" : "pending";
    },
    async account(at) {
      const { value } = await rpc.getAccountInfo(at, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: HUB_ACCOUNT_SLICE } }).send();
      return value ? { data: fromBase64(value.data[0]), lamports: value.lamports } : null;
    },
    rentExemption: (size) => {
      const cached = rent.get(size);
      if (cached) return cached;
      // A failed read is not cached, so the next deposit prepare retries instead of failing until reload.
      const known = rpc.getMinimumBalanceForRentExemption(BigInt(size)).send().catch((error: unknown) => {
        rent.delete(size);
        throw error;
      });
      rent.set(size, known);
      return known;
    },
    async tokenAccount(owner, mint) {
      const { value } = await rpc.getTokenAccountsByOwner(owner, { mint }, { encoding: "base64", commitment: "confirmed" }).send();
      let best: { address: Address; amount: bigint } | null = null;
      for (const entry of value) {
        const data = fromBase64(entry.account.data[0]);
        const amount = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
        if (!best || amount > best.amount) best = { address: address(entry.pubkey), amount };
      }
      return best;
    },
  };
}
