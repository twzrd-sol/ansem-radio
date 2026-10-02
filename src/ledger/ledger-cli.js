/**
 * Check a session-fund ledger file, or print its shareable recap. Read-only; sends nothing.
 *   node src/ledger/ledger-cli.js check <ledger.json> [--verify]
 *   node src/ledger/ledger-cli.js recap <ledger.json> [--verify]
 * --verify asks Solana whether each receipt's amount reached its recipient. It needs SOLANA_RPC_URL in
 * the environment (the secrets manager run -- ...); without it nothing is checked and the output says so.
 * Exit codes: 0 fine, 1 the file is invalid, unreadable, or the chain disagrees with a receipt, 2 usage.
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { loadLedger, toPublicLedger } from "./ledger.js";
import { LedgerError } from "./receipt.js";
import { formatRecap } from "./recap.js";
import { createSolanaVerifier } from "./verify.js";

const USAGE = "usage: ledger-cli.js check|recap <ledger.json> [--verify]";

export async function runLedgerCli(argv, {
  stdout = (text) => process.stdout.write(text),
  stderr = (text) => process.stderr.write(text),
  env = process.env,
  readText = (file) => readFile(file, "utf8"),
  fetchImpl = globalThis.fetch,
} = {}) {
  const [command, file, ...flags] = argv;
  if (!["check", "recap"].includes(command) || !file || flags.some((flag) => flag !== "--verify")) {
    stderr(`${USAGE}\n`);
    return 2;
  }

  let ledger;
  try {
    ledger = loadLedger(JSON.parse(await readText(file)));
  } catch (error) {
    const reason = error instanceof LedgerError ? error.message : error instanceof SyntaxError ? "ledger_invalid: not valid JSON" : "ledger_unreadable";
    stderr(`${reason}\n`);
    return 1;
  }

  const verifications = new Map();
  const verifier = createSolanaVerifier({ rpcUrl: env.SOLANA_RPC_URL, fetchImpl });
  if (flags.includes("--verify")) {
    if (!verifier.enabled) stderr("SOLANA_RPC_URL is not set: nothing was checked against Solana.\n");
    for (const receipt of ledger.receipts) verifications.set(receipt.id, await verifier.verify(receipt));
  }
  const view = toPublicLedger(ledger, verifications);
  const mismatched = view.summary.mismatched > 0;

  if (command === "recap") {
    stdout(`${formatRecap(view)}\n`);
    return mismatched ? 1 : 0;
  }
  const { summary } = view;
  stdout(`${view.campaign.title}: ${summary.receipts} receipts · funded ${summary.funded.usdc} · spent ${summary.spent.usdc} · remaining ${summary.remaining.usdc} USDC\n`);
  for (const warning of summary.warnings) stdout(`warning: ${warning}\n`);
  for (const receipt of view.receipts) {
    const { status, reason, chain_amount: chainAmount } = receipt.verification;
    const detail = chainAmount === undefined ? (reason ? ` (${reason})` : "") : ` (${reason}, chain shows ${chainAmount} base units)`;
    stdout(`  ${receipt.id} ${receipt.kind.padEnd(8)} ${receipt.amount_usdc.padStart(12)} USDC  ${status}${detail}\n`);
  }
  return mismatched ? 1 : 0;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) process.exitCode = await runLedgerCli(process.argv.slice(2));
