import { describe, expect, it, vi } from "vitest";

import { encodeBase58 } from "../../../../src/core/base58.js";
import { signerFromSeed } from "../../../../src/core/ed25519.js";
import { compileLegacyMessage, signTransaction as signLegacyTransaction } from "../../../../src/core/solana.js";
import { address } from "@solana/kit";
import { GENESIS } from "./config";
import { claimTaskBook, explainClaimFailure, type IcelanClaimApi } from "./icelan-claim";
import type { RpcPort } from "./rpc";

const fan = signerFromSeed(new Uint8Array(32).fill(12));
const station = signerFromSeed(new Uint8Array(32).fill(13));
const fanAddress = encodeBase58(fan.publicKey);
const stationAddress = encodeBase58(station.publicKey);
const blockhash = encodeBase58(new Uint8Array(32).fill(14));
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function fixtureApi(walletAddress = fanAddress): { api: IcelanClaimApi; walletSigns: (wire: Uint8Array) => Promise<Uint8Array>; walletSignCount: () => number; calls: unknown[] } {
  const calls: unknown[] = [];
  const message = compileLegacyMessage({
    feePayer: fanAddress,
    recentBlockhash: blockhash,
    instructions: [{
      programId: "11111111111111111111111111111111",
      keys: [
        { pubkey: fanAddress, isSigner: true, isWritable: true },
        { pubkey: stationAddress, isSigner: true, isWritable: false },
      ],
      data: Uint8Array.of(5),
    }],
  });
  const unsigned = Buffer.concat([Buffer.from([2]), Buffer.alloc(128), Buffer.from(message.bytes)]);
  const fullySigned = signLegacyTransaction(message, [fan, station]).wire;
  const walletSigned = Buffer.concat([
    Buffer.from([2]),
    Buffer.from(fan.sign(message.bytes)),
    Buffer.alloc(64),
    Buffer.from(message.bytes),
  ]);
  let walletSignCount = 0;
  const walletSigns = async (_wire: Uint8Array): Promise<Uint8Array> => { walletSignCount += 1; return new Uint8Array(walletSigned); };
  const api: IcelanClaimApi = vi.fn(async (body) => {
    calls.push(body);
    return {
      wallet: walletAddress,
      transaction: "blockhash" in body ? unsigned.toString("base64") : Buffer.from(fullySigned).toString("base64"),
      source: "icelan-tasks",
    };
  });
  return { api, walletSigns, walletSignCount: () => walletSignCount, calls };
}

function rpcFixture({ simulationError = null }: { simulationError?: { code: number } | null } = {}) {
  const calls: string[] = [];
  const rpc = {
    genesisHash: async () => GENESIS.mainnet,
    latestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 100n }),
    blockHeight: async () => 1n,
    simulate: async (_wire: Uint8Array, options?: { sigVerify?: boolean }) => { calls.push(`simulate:${options?.sigVerify}`); return { error: simulationError, logs: [] }; },
    send: async () => { calls.push("send"); return "signature"; },
    status: async () => { calls.push("status"); return "confirmed" as const; },
    account: async () => null,
    rentExemption: async () => 0n,
    tokenAccount: async () => null,
  } satisfies RpcPort;
  return { rpc, calls };
}

const wallet = { address: address(fanAddress), walletName: "Test wallet", signTransaction: vi.fn(), onInvalidated: () => () => {} };

describe("wallet and station task-book claim flow", () => {
  it("checks mainnet, obtains a wallet signature, receives the station co-signature, simulates, sends once, and confirms", async () => {
    const api = fixtureApi();
    const { rpc, calls } = rpcFixture();
    const result = await claimTaskBook({ api: api.api, wallet: { ...wallet, signTransaction: api.walletSigns }, rpc, expectedGenesisHash: GENESIS.mainnet, sleep: async () => {} });
    expect(result.signature).toBeTruthy();
    expect(api.calls).toHaveLength(2);
    expect(api.calls[0]).toEqual({ blockhash });
    expect(api.calls[1]).toHaveProperty("signedTransaction");
    expect(api.walletSignCount()).toBe(1);
    expect(calls).toEqual(["simulate:true", "send", "status"]);
  });

  it("does not ask the wallet to sign or contact the cosigner when addresses differ", async () => {
    const api = fixtureApi(stationAddress);
    const { rpc, calls } = rpcFixture();
    await expect(claimTaskBook({ api: api.api, wallet: { ...wallet, signTransaction: api.walletSigns }, rpc, expectedGenesisHash: GENESIS.mainnet })).rejects.toThrow(/wallet linked/);
    expect(api.walletSignCount()).toBe(0);
    expect(api.calls).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it("does not submit a transaction when signature-verified simulation fails", async () => {
    const api = fixtureApi();
    const { rpc, calls } = rpcFixture({ simulationError: { code: 6203 } });
    await expect(claimTaskBook({ api: api.api, wallet: { ...wallet, signTransaction: api.walletSigns }, rpc, expectedGenesisHash: GENESIS.mainnet })).rejects.toThrow(/Nothing new to collect/);
    expect(calls).toEqual(["simulate:true"]);
  });

  it("skips the genesis pin when expectedGenesisHash is null", async () => {
    const api = fixtureApi();
    const { rpc } = rpcFixture();
    const result = await claimTaskBook({ api: api.api, wallet: { ...wallet, signTransaction: api.walletSigns }, rpc, expectedGenesisHash: null, sleep: async () => {} });
    expect(result.signature).toBeTruthy();
  });

  it("explains vault errors and an expired blockhash in fan words", () => {
    expect(explainClaimFailure({ code: 6203 })).toMatch(/Nothing new to collect/);
    expect(explainClaimFailure({ code: 6204 })).toMatch(/cap is already paid/);
    expect(explainClaimFailure({ code: 6206 })).toMatch(/token account could not be used/);
    expect(explainClaimFailure({ code: 6208 })).toMatch(/not set up to co-sign/);
    expect(explainClaimFailure({ code: 6210 })).toMatch(/collection limit for today/);
    expect(explainClaimFailure({ message: "Blockhash not found" })).toMatch(/timed out/);
    expect(explainClaimFailure({ message: "Attempt to debit an account but found no record of a prior credit" })).toMatch(/station could not pay/);
    expect(explainClaimFailure({ message: "other" }, ["Program failed"])).toMatch(/simulation failed/);
  });
});
