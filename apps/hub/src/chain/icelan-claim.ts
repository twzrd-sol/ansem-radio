import { GENESIS_HASH, NETWORK_LABEL } from "./config";
import type { RpcPort } from "./rpc";
import { isFullySigned, signatureOf } from "./tx";
import type { ConnectedWallet } from "../data/wallet-session";

export interface IcelanClaimApi {
  (body: { blockhash: string } | { signedTransaction: string }): Promise<{
    wallet: string;
    transaction: string;
    source: string;
  }>;
}

const decode64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const encode64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const BLOCKHASH_GONE = /blockhash not found|BlockhashNotFound|blockhash expired|expired blockhash/i;

/** Fan-readable reason a claim simulation or send did not land. */
export function explainClaimFailure(error: { code?: number; message?: string } | null | undefined, logs: string[] = []): string {
  const text = [error?.message, ...logs].filter(Boolean).join("\n");
  if (error && typeof error.code === "number") {
    switch (error.code) {
      case 6203: return "Nothing new to collect. Your booked total is already in this wallet.";
      case 6204: return "The task-book cap is already paid. Nothing more can be collected.";
      case 6206: return "This wallet's ICELAN token account could not be used. Nothing was sent.";
      case 6208: return "The station is not set up to co-sign claims yet. Nothing was sent.";
      case 6201: return "This claim does not match the vault. Nothing was sent.";
      case 6202: return "The claim amount does not match the book. Refresh Collect and try again.";
      case 6209: return "The claim request was not valid. Nothing was sent.";
      default: break;
    }
  }
  if (BLOCKHASH_GONE.test(text)) return "The claim timed out before it could land. Start Collect again.";
  if (/insufficient funds|no record of a prior credit|insufficient lamports/i.test(text)) return "The station could not pay the network fee for this claim. Nothing was sent.";
  return "The claim simulation failed. Nothing was sent.";
}

/** Build, wallet-authorize, station-co-sign, simulate, submit once, and confirm a task-book claim. */
export async function claimTaskBook({ api, wallet, rpc, expectedGenesisHash, sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) }: {
  api: IcelanClaimApi;
  wallet: ConnectedWallet;
  rpc: RpcPort;
  /** `null` skips the genesis pin (local validator). Omitted uses the build's network genesis. */
  expectedGenesisHash?: string | null;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ signature: string }> {
  const genesisPin = expectedGenesisHash === undefined ? GENESIS_HASH : expectedGenesisHash;
  if (genesisPin != null && await rpc.genesisHash() !== genesisPin) throw new Error(`The RPC is not ${NETWORK_LABEL}. Nothing was signed.`);
  const lifetime = await rpc.latestBlockhash();
  const review = await api({ blockhash: lifetime.blockhash });
  if (review.wallet !== wallet.address) throw new Error("Connect the wallet linked to this account. Nothing was signed.");
  const walletSigned = await wallet.signTransaction(decode64(review.transaction));
  const coSigned = await api({ signedTransaction: encode64(walletSigned) });
  const wire = decode64(coSigned.transaction);
  if (!isFullySigned(wire)) throw new Error("The station did not co-sign the reviewed transaction. Nothing was sent.");
  const signature = signatureOf(wire);
  const simulation = await rpc.simulate(wire, { sigVerify: true });
  if (simulation.error) throw new Error(explainClaimFailure(simulation.error, simulation.logs));
  let sendError = "";
  try { await rpc.send(wire); } catch (error) {
    sendError = error instanceof Error ? error.message : String(error);
    if (BLOCKHASH_GONE.test(sendError)) throw new Error("The claim timed out before it could land. Start Collect again.");
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let status: "confirmed" | "failed" | "pending";
    try { status = await rpc.status(signature); } catch (error) {
      sendError ||= error instanceof Error ? error.message : String(error);
      break;
    }
    if (status === "confirmed") return { signature };
    if (status === "failed") throw new Error(`Claim transaction ${signature} failed on chain.`);
    await sleep(750);
  }
  throw new Error(`Claim ${sendError ? "may have been submitted" : "was submitted"} as ${signature}, but confirmation is still pending. Check this signature before retrying.${sendError ? ` RPC said: ${sendError}` : ""}`);
}
