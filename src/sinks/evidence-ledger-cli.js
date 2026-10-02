#!/usr/bin/env node
/**
 * Radio LAN attribution log on the evidence-ledger program.
 *
 *   npm run attribution -- status                       read-only, anyone
 *   npm run attribution -- verify <receipt.json>        read-only, anyone
 *   npm run attribution -- init                         devnet only, needs keys
 *   npm run attribution -- anchor --log <file> --out <dir>   devnet only, needs keys
 *
 * Keys come from RADIOLAN_ATTRIBUTION_AUTHORITY_SEED (pays and anchors) and
 * RADIOLAN_ATTRIBUTION_LOG_SEED (signs heads), 64 hex each, injected at runtime
 * (the secrets manager project radiolan, config dev). They are never printed. Sending
 * refuses any cluster but devnet: a mainnet step needs a separate operator go.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { LOG_ID } from "../attribution/claim.js";
import { headFromJSON, headToJSON } from "../attribution/head.js";
import { loadAttributionLog } from "../attribution/log.js";
import { verifyReceipt } from "../attribution/receipt.js";
import { decodeBase58, encodeBase58 } from "../core/base58.js";
import { signerFromSeed } from "../core/ed25519.js";
import { keccak256 } from "../core/keccak.js";
import { DEVNET_GENESIS_HASH, compileLegacyMessage, createRpc, signTransaction } from "../core/solana.js";
import {
  PROGRAM_ID,
  SCHEME_RFC9162,
  anchorHeadInstructions,
  computeUnitLimitInstruction,
  decodeLedger,
  decodeRootEntry,
  initLedgerInstruction,
  ledgerAddress,
  rootAddress,
  verifyInclusionInstruction,
} from "./evidence-ledger.js";

export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const RPC_URLS = { devnet: "https://api.devnet.solana.com", mainnet: "https://api.mainnet-beta.solana.com" };
const GENESIS = { devnet: DEVNET_GENESIS_HASH, mainnet: MAINNET_GENESIS_HASH };
const hex = (bytes) => Buffer.from(bytes).toString("hex");

export class CliError extends Error {}

function seedFrom(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new CliError(`${name} must be set to 64 lowercase hex characters (it is never printed)`);
  }
  return new Uint8Array(Buffer.from(value, "hex"));
}

export function keysFrom(env) {
  return {
    authority: signerFromSeed(seedFrom(env, "RADIOLAN_ATTRIBUTION_AUTHORITY_SEED")),
    logKey: signerFromSeed(seedFrom(env, "RADIOLAN_ATTRIBUTION_LOG_SEED")),
  };
}

async function requireCluster(rpc, network) {
  const genesis = await rpc.genesisHash();
  if (genesis !== GENESIS[network]) throw new CliError(`RPC is not ${network} (genesis ${genesis})`);
}

/** The ledger account for our log id, decoded, or null if nobody has created it. */
export async function readLedger(rpc, logId = LOG_ID) {
  const { address } = ledgerAddress(logId);
  const account = await rpc.getAccount(address);
  if (!account) return { address: encodeBase58(address), ledger: null };
  if (account.owner !== PROGRAM_ID) throw new CliError(`ledger account is owned by ${account.owner}`);
  const ledger = decodeLedger(account.data);
  if (hex(ledger.logIdHash) !== hex(keccak256(logId))) throw new CliError("ledger log id hash does not match");
  return { address: encodeBase58(address), ledger };
}

/** Squatting check: the ledger must be scheme 2 with exactly our authority and head key. */
export function assertOurs(ledger, keys) {
  const problems = [];
  if (ledger.scheme !== SCHEME_RFC9162) problems.push(`scheme ${ledger.scheme}`);
  if (ledger.authority !== encodeBase58(keys.authority.publicKey)) problems.push(`authority ${ledger.authority}`);
  if (ledger.trustedSigner !== encodeBase58(keys.logKey.publicKey)) problems.push(`trusted signer ${ledger.trustedSigner}`);
  if (problems.length > 0) {
    throw new CliError(`${LOG_ID} is held by someone else (${problems.join(", ")}); pick a new log id and record why`);
  }
}

async function send(rpc, payer, instructions, options) {
  const message = compileLegacyMessage({
    feePayer: payer.publicKey,
    recentBlockhash: await rpc.latestBlockhash(),
    instructions,
  });
  const { wire } = signTransaction(message, [payer]);
  return rpc.sendAndConfirm(wire, options);
}

export async function status({ rpc, env }) {
  const genesis = await rpc.genesisHash();
  const network = Object.entries(GENESIS).find(([, hash]) => hash === genesis)?.[0] ?? "unknown";
  const program = await rpc.getAccount(PROGRAM_ID);
  const { address, ledger } = await readLedger(rpc);
  const out = {
    network,
    program: PROGRAM_ID,
    program_exists: program !== null,
    log_id: LOG_ID,
    ledger: address,
    ledger_exists: ledger !== null,
  };
  if (ledger) Object.assign(out, { scheme: ledger.scheme, authority: ledger.authority, trusted_signer: ledger.trustedSigner, last_tree_size: ledger.lastSeq, heads: ledger.count });
  if (env.RADIOLAN_ATTRIBUTION_AUTHORITY_SEED || env.RADIOLAN_ATTRIBUTION_LOG_SEED) {
    const keys = keysFrom(env);
    out.our_authority = encodeBase58(keys.authority.publicKey);
    out.our_trusted_signer = encodeBase58(keys.logKey.publicKey);
    out.our_authority_lamports = await rpc.getBalance(keys.authority.publicKey);
  }
  return out;
}

export async function init({ rpc, env, sendOptions }) {
  await requireCluster(rpc, "devnet");
  const keys = keysFrom(env);
  const before = await readLedger(rpc);
  if (before.ledger) {
    assertOurs(before.ledger, keys);
    return { ledger: before.address, created: false };
  }
  const signature = await send(
    rpc,
    keys.authority,
    [initLedgerInstruction({ payer: keys.authority.publicKey, authority: keys.authority.publicKey, trustedSigner: keys.logKey.publicKey, logId: LOG_ID })],
    sendOptions,
  );
  const after = await readLedger(rpc);
  if (!after.ledger) throw new CliError(`init ${signature} confirmed but the ledger is missing`);
  assertOurs(after.ledger, keys);
  return { ledger: after.address, created: true, signature };
}

export async function anchor({ rpc, env, logLines, outDir, now = () => Math.floor(Date.now() / 1000), sendOptions }) {
  await requireCluster(rpc, "devnet");
  const keys = keysFrom(env);
  const { address, ledger } = await readLedger(rpc);
  if (!ledger) throw new CliError("no ledger yet; run init first");
  assertOurs(ledger, keys);

  const log = loadAttributionLog(logLines, { network: "devnet", headSigner: keys.logKey, now });
  if (log.size <= ledger.lastSeq && ledger.count > 0) {
    throw new CliError(`log has ${log.size} entries; the ledger already anchored size ${ledger.lastSeq}`);
  }
  const head = log.signHead();
  const signature = await send(
    rpc,
    keys.authority,
    anchorHeadInstructions({ authority: keys.authority.publicKey, payer: keys.authority.publicKey, trustedSigner: keys.logKey.publicKey, head }),
    sendOptions,
  );

  const rootPda = rootAddress(decodeBase58(address), head.treeSize).address;
  const rootAccount = await rpc.getAccount(rootPda);
  const entry = rootAccount && decodeRootEntry(rootAccount.data);
  if (!entry || hex(entry.root) !== hex(head.root) || entry.signedTimestamp !== head.timestamp) {
    throw new CliError(`anchor ${signature} confirmed but the root account does not match the head`);
  }

  const result = {
    network: "devnet",
    log_id: LOG_ID,
    ledger: address,
    root_account: encodeBase58(rootPda),
    signature,
    published_slot: entry.publishedSlot,
    trusted_signer: encodeBase58(keys.logKey.publicKey),
    head: headToJSON(head),
  };
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "anchor.json"), `${JSON.stringify(result, null, 2)}\n`);
    for (let index = 0; index < log.size; index += 1) {
      if (log.entry(index).erased) continue;
      writeFileSync(join(outDir, `receipt-${index}.json`), `${JSON.stringify(log.receipt(index), null, 2)}\n`);
    }
  }
  return result;
}

/**
 * Check a receipt end to end against the chain: the head key is read from the
 * ledger account (not from the receipt), the receipt verifies offline under
 * it, the head's root is the one anchored at its size, and the program's own
 * verify_inclusion accepts the entry (simulated, nothing lands).
 */
export async function verify({ rpc, receipt, network }) {
  const claimNetwork = /\nnetwork: (devnet|mainnet)\n/.exec(receipt?.text ?? "")?.[1];
  const target = network ?? claimNetwork;
  if (!target) throw new CliError("cannot tell the receipt's network");
  await requireCluster(rpc, target);

  const { address, ledger } = await readLedger(rpc);
  if (!ledger) throw new CliError(`${LOG_ID} has no ledger on ${target}`);
  if (ledger.scheme !== SCHEME_RFC9162) throw new CliError(`ledger scheme ${ledger.scheme}`);

  const offline = verifyReceipt(receipt, decodeBase58(ledger.trustedSigner), { network: target });
  if (!offline.ok) throw new CliError(`receipt does not verify: ${offline.reason}`);
  const head = headFromJSON(receipt.head);

  const rootPda = rootAddress(decodeBase58(address), head.treeSize).address;
  const rootAccount = await rpc.getAccount(rootPda);
  if (!rootAccount) throw new CliError(`no head of size ${head.treeSize} is anchored for ${LOG_ID}`);
  const anchored = decodeRootEntry(rootAccount.data);
  if (hex(anchored.root) !== hex(head.root) || anchored.signedTimestamp !== head.timestamp) {
    throw new CliError("the anchored head at this size differs from the receipt's head");
  }

  const feePayer = decodeBase58(ledger.authority);
  const message = compileLegacyMessage({
    feePayer,
    recentBlockhash: new Uint8Array(32),
    instructions: [
      computeUnitLimitInstruction(),
      verifyInclusionInstruction({
        logId: LOG_ID,
        treeSize: head.treeSize,
        entry: new Uint8Array(Buffer.from(receipt.commitment, "hex")),
        index: receipt.index,
        path: receipt.path.map((node) => new Uint8Array(Buffer.from(node, "hex"))),
      }),
    ],
  });
  const { wire } = signTransaction(message, [{ publicKey: feePayer, sign: () => new Uint8Array(64) }]);
  const simulated = await rpc.simulate(wire);
  if (simulated.err) {
    // Only an instruction error is the program's verdict. Anything else (for
    // example the authority account no longer exists to pay the simulated fee)
    // means the check did not run, which is not a failed proof.
    const ran = Object.hasOwn(Object(simulated.err), "InstructionError");
    throw new CliError(
      ran
        ? `the program rejected inclusion: ${JSON.stringify(simulated.err)}`
        : `the on-chain check could not run: ${JSON.stringify(simulated.err)}`,
    );
  }

  return {
    ok: true,
    network: target,
    log_id: LOG_ID,
    ledger: address,
    trusted_signer: ledger.trustedSigner,
    root_account: encodeBase58(rootPda),
    anchored_slot: anchored.publishedSlot,
    tree_size: head.treeSize,
    index: receipt.index,
    claim_id: offline.claim_id,
    action: offline.claim.action,
    work: offline.claim.work ?? null,
    checks: ["receipt_offline", "head_key_from_chain", "anchored_root_matches", "program_verify_inclusion"],
  };
}

function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...args] = argv;
  const rpcUrl = option(args, "--rpc");
  try {
    let result;
    if (command === "status") {
      result = await status({ rpc: createRpc(rpcUrl ?? env.RADIOLAN_SOLANA_RPC_URL ?? RPC_URLS.devnet), env });
    } else if (command === "init") {
      result = await init({ rpc: createRpc(rpcUrl ?? RPC_URLS.devnet), env });
    } else if (command === "anchor") {
      const logPath = option(args, "--log");
      if (!logPath) throw new CliError("anchor needs --log <file>");
      const logLines = readFileSync(logPath, "utf8").split("\n").filter((line) => line.trim() !== "");
      result = await anchor({ rpc: createRpc(rpcUrl ?? RPC_URLS.devnet), env, logLines, outDir: option(args, "--out") });
    } else if (command === "verify") {
      const path = args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--rpc" && args[i - 1] !== "--network");
      if (!path) throw new CliError("verify needs a receipt file");
      const receipt = JSON.parse(readFileSync(path, "utf8"));
      const network = option(args, "--network");
      const claimNetwork = /\nnetwork: (devnet|mainnet)\n/.exec(receipt?.text ?? "")?.[1];
      result = await verify({ rpc: createRpc(rpcUrl ?? RPC_URLS[network ?? claimNetwork ?? "devnet"]), receipt, network });
    } else {
      throw new CliError("usage: status | verify <receipt.json> | init | anchor --log <file> --out <dir>  [--rpc URL]");
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
