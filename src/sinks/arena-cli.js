#!/usr/bin/env node
/**
 * Radio LAN arena on devnet. Sends only to devnet: every command checks the RPC's
 * genesis hash first. A mainnet step is a separate operator go and is not in this tool.
 *
 *   npm run arena -- status   --streamer S --mint M [--fan F]
 *   npm run arena -- whoami   --signer X                          the signer's public key, nothing else, no network
 *   npm run arena -- test-mint --signer X                         a Token-2022 test mint, 6 decimals, no freeze authority
 *   npm run arena -- wallet   --signer X --mint M [--owner O]     a new token account for O (default: the signer)
 *   npm run arena -- mint-to  --signer X --mint M --to ACCT --amount N
 *   npm run arena -- fund     --signer X --to ADDR --lamports N   devnet SOL from the signer
 *   npm run arena -- init     --signer STREAMER --mint M --season-seconds S [--season-start T]
 *   npm run arena -- deposit  --signer FAN --streamer S --mint M --from ACCT --amount N
 *   npm run arena -- request  --signer FAN --streamer S --mint M
 *   npm run arena -- withdraw --signer FAN --streamer S --mint M --to ACCT --amount N
 *   npm run arena -- close    --signer STREAMER --mint M          irreversible: releases every position
 *
 * --signer is either env:NAME (a 64-hex seed in that environment variable, e.g.
 * env:RADIOLAN_ATTRIBUTION_AUTHORITY_SEED, injected at runtime) or the path of a
 * Solana CLI keypair file. Keys are never printed. Amounts are base units (6 decimals: 1 token = 1000000).
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { encodeBase58 } from "../core/base58.js";
import { signerFromSeed } from "../core/ed25519.js";
import { DEVNET_GENESIS_HASH, compileLegacyMessage, createRpc, signTransaction } from "../core/solana.js";
import {
  ARENA_LEN,
  ARENA_PROGRAM_ID,
  MINT_LEN,
  POSITION_LEN,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_ACCOUNT_LEN,
  arenaAddress,
  closeArenaInstruction,
  createAccountInstruction,
  decodeArena,
  decodePosition,
  depositInstruction,
  initArenaInstruction,
  initializeAccountInstruction,
  initializeMintInstruction,
  mintToInstruction,
  positionAddress,
  requestWithdrawInstruction,
  seasonIndex,
  supportAddress,
  withdrawAvailableAt,
  tokenAmount,
  transferLamportsInstruction,
  withdrawInstruction,
} from "./arena.js";

export class CliError extends Error {}
const DEVNET_RPC = "https://api.devnet.solana.com";

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function need(args, name) {
  const value = option(args, name);
  if (value === undefined) throw new CliError(`missing ${name}`);
  return value;
}

/** A signer from env:NAME (64 hex) or a Solana CLI keypair file (its first 32 bytes are the seed). */
export function loadSigner(spec, env = process.env) {
  if (!spec) throw new CliError("missing --signer");
  if (spec.startsWith("env:")) {
    const value = env[spec.slice(4)];
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new CliError(`${spec.slice(4)} must be 64 lowercase hex characters (it is never printed)`);
    return signerFromSeed(new Uint8Array(Buffer.from(value, "hex")));
  }
  const bytes = JSON.parse(readFileSync(spec, "utf8"));
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new CliError(`${spec} is not a Solana keypair file`);
  const signer = signerFromSeed(Uint8Array.from(bytes.slice(0, 32)));
  if (encodeBase58(signer.publicKey) !== encodeBase58(Uint8Array.from(bytes.slice(32)))) throw new CliError(`${spec}: public key does not match its seed`);
  return signer;
}

async function requireDevnet(rpc) {
  const genesis = await rpc.genesisHash();
  if (genesis !== DEVNET_GENESIS_HASH) throw new CliError(`RPC is not devnet (genesis ${genesis}); this tool sends to devnet only`);
}

async function send(rpc, signers, instructions) {
  const message = compileLegacyMessage({ feePayer: signers[0].publicKey, recentBlockhash: await rpc.latestBlockhash(), instructions });
  const { wire } = signTransaction(message, signers);
  return rpc.sendAndConfirm(wire, { timeoutMs: 90_000, pollMs: 2_000 });
}

/** The cluster's clock (the time the program unlocks by), not this machine's. */
async function clusterTime(rpc) {
  const slot = await rpc.call("getSlot", [{ commitment: "confirmed" }]);
  return BigInt(await rpc.call("getBlockTime", [slot]));
}

async function rent(rpc, space) {
  return rpc.call("getMinimumBalanceForRentExemption", [space]);
}

const ours = (account, length) => account && account.owner === ARENA_PROGRAM_ID && account.data.length === length;

export async function status({ rpc, streamer, mint, fan }) {
  const arena = arenaAddress(streamer, mint).address;
  const account = await rpc.getAccount(arena);
  const out = { arena: encodeBase58(arena), exists: Boolean(ours(account, ARENA_LEN)) };
  if (!out.exists) return out;
  const a = decodeArena(account.data);
  const now = await clusterTime(rpc);
  Object.assign(out, { ...a, seasonStart: a.seasonStart.toString(), seasonSeconds: a.seasonSeconds.toString(), positions: a.positions.toString(), total: a.total.toString(), clusterTime: now.toString(), currentSeason: seasonIndex(a.seasonStart, a.seasonSeconds, now).toString() });
  if (fan) {
    const [p, s] = await Promise.all([rpc.getAccount(positionAddress(arena, fan).address), rpc.getAccount(supportAddress(arena, fan).address)]);
    const position = ours(p, POSITION_LEN) ? decodePosition(p.data) : null;
    out.position = position && { ...position, amount: position.amount.toString(), requestedSeason: position.requestedSeason.toString(), openedAt: position.openedAt.toString() };
    if (position) {
      out.position.availableAt = a.closed ? "now (arena closed)" : position.state === "requested" ? new Date(Number(withdrawAvailableAt(a.seasonStart, a.seasonSeconds, position.requestedSeason)) * 1000).toISOString() : null;
    }
    out.supportBalance = s && s.owner === TOKEN_2022_PROGRAM_ID ? tokenAmount(s.data).toString() : null;
  }
  return out;
}

export async function main(argv = process.argv.slice(2), env = process.env, { rpc = createRpc(option(argv, "--rpc") ?? DEVNET_RPC) } = {}) {
  const [command, ...args] = argv;
  try {
    let result;
    if (command === "whoami") {
      // Needed to put a demo key's public address in a registry file; the seed itself is never printed.
      result = { publicKey: encodeBase58(loadSigner(option(args, "--signer"), env).publicKey) };
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    await requireDevnet(rpc);
    if (command === "status") {
      result = await status({ rpc, streamer: need(args, "--streamer"), mint: need(args, "--mint"), fan: option(args, "--fan") });
    } else {
      const signer = loadSigner(option(args, "--signer"), env);
      const me = encodeBase58(signer.publicKey);
      if (command === "test-mint") {
        const mint = signerFromSeed(randomBytes(32));
        const signature = await send(rpc, [signer, mint], [
          createAccountInstruction({ payer: me, account: mint.publicKey, lamports: await rent(rpc, MINT_LEN), space: MINT_LEN, owner: TOKEN_2022_PROGRAM_ID }),
          initializeMintInstruction({ mint: mint.publicKey, decimals: 6, mintAuthority: me }),
        ]);
        result = { mint: encodeBase58(mint.publicKey), mintAuthority: me, signature };
      } else if (command === "wallet") {
        const account = signerFromSeed(randomBytes(32));
        const owner = option(args, "--owner") ?? me;
        const signature = await send(rpc, [signer, account], [
          createAccountInstruction({ payer: me, account: account.publicKey, lamports: await rent(rpc, TOKEN_ACCOUNT_LEN), space: TOKEN_ACCOUNT_LEN, owner: TOKEN_2022_PROGRAM_ID }),
          initializeAccountInstruction({ account: account.publicKey, mint: need(args, "--mint"), owner }),
        ]);
        result = { tokenAccount: encodeBase58(account.publicKey), owner, signature };
      } else if (command === "mint-to") {
        result = { signature: await send(rpc, [signer], [mintToInstruction({ mint: need(args, "--mint"), destination: need(args, "--to"), authority: me, amount: need(args, "--amount") })]) };
      } else if (command === "fund") {
        result = { signature: await send(rpc, [signer], [transferLamportsInstruction({ from: me, to: need(args, "--to"), lamports: need(args, "--lamports") })]) };
      } else if (command === "init") {
        const seasonStart = option(args, "--season-start") ?? (await clusterTime(rpc)).toString();
        const mint = need(args, "--mint");
        const signature = await send(rpc, [signer], [initArenaInstruction({ streamer: me, mint, seasonStart, seasonSeconds: need(args, "--season-seconds"), now: await clusterTime(rpc) })]);
        result = { arena: encodeBase58(arenaAddress(me, mint).address), signature };
      } else if (command === "deposit") {
        result = { signature: await send(rpc, [signer], [depositInstruction({ fan: me, streamer: need(args, "--streamer"), mint: need(args, "--mint"), source: need(args, "--from"), amount: need(args, "--amount") })]) };
      } else if (command === "request") {
        result = { signature: await send(rpc, [signer], [requestWithdrawInstruction({ fan: me, streamer: need(args, "--streamer"), mint: need(args, "--mint") })]) };
      } else if (command === "withdraw") {
        result = { signature: await send(rpc, [signer], [withdrawInstruction({ fan: me, streamer: need(args, "--streamer"), mint: need(args, "--mint"), destination: need(args, "--to"), amount: need(args, "--amount") })]) };
      } else if (command === "close") {
        result = { signature: await send(rpc, [signer], [closeArenaInstruction({ streamer: me, mint: need(args, "--mint") })]) };
      } else {
        throw new CliError("usage: status | whoami | test-mint | wallet | mint-to | fund | init | deposit | request | withdraw | close (see the file header)");
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
