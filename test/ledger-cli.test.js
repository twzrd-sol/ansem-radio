import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runLedgerCli } from "../src/ledger/ledger-cli.js";
import { USDC_MINT } from "../src/ledger/receipt.js";

const exampleText = readFileSync(new URL("../docs/examples/ledger.example.json", import.meta.url), "utf8");
const example = () => JSON.parse(exampleText);

function run(argv, { text = exampleText, env = {}, fetchImpl } = {}) {
  const out = [];
  const err = [];
  const options = {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    env,
    readText: async () => {
      if (text instanceof Error) throw text;
      return text;
    },
    fetchImpl,
  };
  return runLedgerCli(argv, options).then((code) => ({ code, out: out.join(""), err: err.join("") }));
}

// A chain that credits every declared recipient exactly what its receipt says (or `skew` off).
function chainFor(skew = 0n) {
  const doc = example();
  const amounts = new Map(doc.receipts.map((receipt) => [receipt.tx, [receipt.to_address, BigInt(receipt.amount)]]));
  return async (_url, options) => {
    const [tx] = JSON.parse(options.body).params;
    const [owner, amount] = amounts.get(tx);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          blockTime: 1790000000,
          meta: { err: null, preTokenBalances: [], postTokenBalances: [{ owner, mint: USDC_MINT, uiTokenAmount: { amount: String(amount + skew) } }] },
        },
      }),
    };
  };
}

test("usage errors exit 2 and print usage", async () => {
  for (const argv of [[], ["check"], ["nope", "x.json"], ["check", "x.json", "--fast"]]) {
    const result = await run(argv);
    assert.equal(result.code, 2, argv.join(" "));
    assert.match(result.err, /usage: ledger-cli\.js check\|recap <ledger\.json> \[--verify\]/);
    assert.equal(result.out, "");
  }
});

test("check prints the totals and one line per receipt", async () => {
  const result = await run(["check", "ledger.json"]);
  assert.equal(result.code, 0);
  assert.match(result.out, /^EXAMPLE Radio LAN session fund: 3 receipts · funded 75\.00 · spent 40\.00 · remaining 35\.00 USDC\n/);
  assert.equal(result.out.trim().split("\n").length, 4);
  assert.match(result.out, /r_[0-9a-f]{16} support {9}40\.00 USDC {2}pending/);
  assert.equal(result.err, "");
});

test("an invalid or unreadable file exits 1 with a coded reason, never a stack, value or path", async () => {
  const bad = example();
  bad.receipts[0].login = "someviewer";
  const invalid = await run(["check", "/nonexistent/ledger.json"], { text: JSON.stringify(bad) });
  assert.equal(invalid.code, 1);
  assert.equal(invalid.err, "receipt_invalid: receipts[0].login: unknown field\n");

  const garbled = await run(["check", "x.json"], { text: "{ nope" });
  assert.equal(garbled.code, 1);
  assert.equal(garbled.err, "ledger_invalid: not valid JSON\n");

  const missing = await run(["check", "/nonexistent/ledger.json"], { text: Object.assign(new Error("ENOENT /nonexistent/ledger.json"), { code: "ENOENT" }) });
  assert.equal(missing.code, 1);
  assert.equal(missing.err, "ledger_unreadable\n");
  assert.equal(missing.err.includes("private"), false);
});

test("--verify without an RPC says nothing was checked and does not fail", async () => {
  const result = await run(["check", "ledger.json", "--verify"]);
  assert.equal(result.code, 0);
  assert.match(result.err, /SOLANA_RPC_URL is not set: nothing was checked against Solana\./);
  assert.match(result.out, /unverified \(rpc_not_configured\)/);
});

test("--verify against a matching chain reports verified and exits 0", async () => {
  const result = await run(["check", "ledger.json", "--verify"], { env: { SOLANA_RPC_URL: "https://rpc.example/?api-key=SECRET" }, fetchImpl: chainFor() });
  assert.equal(result.code, 0);
  assert.equal(result.out.match(/ verified\n/g).length, 3);
  assert.equal(result.err, "");
  assert.equal((result.out + result.err).includes("SECRET"), false);
});

test("--verify where the chain disagrees exits 1 and shows the on-chain amount", async () => {
  const result = await run(["check", "ledger.json", "--verify"], { env: { SOLANA_RPC_URL: "https://rpc.example" }, fetchImpl: chainFor(-1n) });
  assert.equal(result.code, 1);
  assert.match(result.out, /mismatch \(amount_differs, chain shows 49999999 base units\)/);
});

test("recap prints the shareable text, and exits 1 if the chain disagrees", async () => {
  const plain = await run(["recap", "ledger.json"]);
  assert.equal(plain.code, 0);
  assert.match(plain.out, /^EXAMPLE Radio LAN session fund — receipts\n/);
  assert.match(plain.out, /Checked against Solana: 0 of 3 receipts/);

  const verified = await run(["recap", "ledger.json", "--verify"], { env: { SOLANA_RPC_URL: "https://rpc.example" }, fetchImpl: chainFor() });
  assert.equal(verified.code, 0);
  assert.match(verified.out, /Checked against Solana: 3 of 3 receipts/);
  assert.equal(verified.out.match(/verified on Solana/g).length, 3);

  const disagreeing = await run(["recap", "ledger.json", "--verify"], { env: { SOLANA_RPC_URL: "https://rpc.example" }, fetchImpl: chainFor(5n) });
  assert.equal(disagreeing.code, 1);
  assert.match(disagreeing.out, /3 do not match/);
});
