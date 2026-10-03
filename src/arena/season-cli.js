#!/usr/bin/env node
/** Local plans only. Reads public config/signed events; never signs, fetches or sends. */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { settleSeason, settlementBalances, verifySeasonReceipt } from "./season.js";

const MAX_BYTES = 256 * 1024 * 1024;
const HELP = `Usage:
  npm run arena:season -- settle <input.json> <new-output.json> [--now <unix-seconds>]
  npm run arena:season -- verify <snapshot.json> <account-id-hex>
  npm run arena:season -- balances <snapshot.json> --now <unix-seconds> [--paid <reported-account-ids.json>]

Input: {"config": {...}, "events": [{"event": {...}, "signature": "..."}]}
Output: an immutable-by-convention settlement plan, NOT funded money or an on-chain claim.
Verify checks arithmetic/inclusion, NOT creator approval of the manifest or on-chain funding.
Balances uses reported claims only; it is never proof that a transfer occurred.
Files are limited to 256 MiB. New plans use exclusive creation and mode 0600.
`;
function readJson(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new TypeError("input must be a regular JSON file, at most 256 MiB");
  return JSON.parse(readFileSync(path, "utf8"));
}
function seconds(text) {
  if (!/^(0|[1-9][0-9]*)$/.test(text ?? "") || !Number.isSafeInteger(Number(text))) throw new TypeError("expected integer Unix seconds");
  return Number(text);
}
function options(args, allowed) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!allowed.includes(flag) || Object.hasOwn(out, flag) || args[i + 1] === undefined) throw new TypeError("invalid or duplicate option");
    out[flag] = args[i + 1];
  }
  return out;
}
export function run(args, print = (s) => process.stdout.write(`${s}\n`)) {
  if (!args.length || (args.length === 1 && args[0] === "--help")) { print(HELP); return; }
  const [command, path, third, ...rest] = args;
  if (command === "settle") {
    if (!path || !third) throw new TypeError("settle needs input and a new output path");
    const opts = options(rest, ["--now"]), input = readJson(path);
    if (!input || Object.keys(input).sort().join() !== "config,events") throw new TypeError("input must contain only config and events");
    const snapshot = settleSeason(input.config, input.events, opts["--now"] === undefined ? {} : { now: seconds(opts["--now"]) });
    const json = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (Buffer.byteLength(json) > MAX_BYTES) throw new RangeError("plan exceeds 256 MiB");
    writeFileSync(third, json, { flag: "wx", mode: 0o600 });
    print(JSON.stringify({ planOnly: true, output: third, root: snapshot.manifest.root,
      fanCount: snapshot.manifest.fanCount, allocatedBaseUnits: snapshot.manifest.allocatedBaseUnits,
      dustBaseUnits: snapshot.manifest.dustBaseUnits }));
  } else if (command === "verify") {
    if (!path || !third || rest.length) throw new TypeError("verify needs snapshot and account id");
    const snapshot = readJson(path);
    settlementBalances(snapshot); // Validate the entire allocation roster, not only one leaf.
    const receipt = snapshot.receipts.find((r) => r.accountId === third);
    if (!receipt || !verifySeasonReceipt(snapshot.manifest, receipt)) throw new TypeError("receipt not found or invalid");
    print(JSON.stringify({ planOnly: true, inclusionValid: true, accountId: receipt.accountId,
      amountBaseUnits: receipt.amountBaseUnits, root: snapshot.manifest.root }));
  } else if (command === "balances") {
    if (!path) throw new TypeError("balances needs snapshot and an explicit clock");
    const opts = options(args.slice(2), ["--now", "--paid"]);
    if (opts["--now"] === undefined) throw new TypeError("balances needs --now");
    print(JSON.stringify(settlementBalances(readJson(path), opts["--paid"] ? readJson(opts["--paid"]) : [], { now: seconds(opts["--now"]) })));
  } else throw new TypeError("unknown command; use --help");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { run(process.argv.slice(2)); } catch (e) { process.stderr.write(`arena-season: ${e.message}\n`); process.exitCode = 1; }
}
