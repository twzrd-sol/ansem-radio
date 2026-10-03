import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { encodeBase58 } from "../src/core/base58.js";
import { eventPreimage } from "../src/arena/season.js";

test("CLI settles an unfunded plan, verifies it, reserves unpaid shares and never overwrites the plan", () => {
  const creator = generateKeyPairSync("ed25519");
  const publicKey = encodeBase58(creator.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  const arena = encodeBase58(new Uint8Array(32).fill(42)), accountId = "01".repeat(32);
  const config = { network: "devnet", arena, creator: publicKey, season: "1", arenaSeasonStart: 100, arenaSeasonSeconds: 100, startsAt: 100, endsAt: 200,
    claimDeadline: 300, asset: "USDC", budgetBaseUnits: "1000000",
    policy: { dailyCap: 10, weeklyCap: 20, weights: { question: 1, poll_response: 2, accepted_work: 3 } } };
  const event = { type: "credit", source: "arena_native", network: "devnet", arena, season: "1", accountId,
    actionId: "02".repeat(32), action: "question", occurredAt: 110 };
  const directory = mkdtempSync(join(tmpdir(), "arena-plan-test-"));
  const input = join(directory, "input.json"), output = join(directory, "plan.json"), claims = join(directory, "reported.json");
  writeFileSync(input, JSON.stringify({ config, events: [{ event, signature: sign(null, eventPreimage(event), creator.privateKey).toString("hex") }] }), { mode: 0o600 });
  const cli = new URL("../src/arena/season-cli.js", import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const result = run("settle", input, output, "--now", "200");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).planOnly, true);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  const original = readFileSync(output, "utf8");
  assert.equal(run("settle", input, output, "--now", "200").status, 1);
  assert.equal(readFileSync(output, "utf8"), original);
  const verified = run("verify", output, accountId);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).inclusionValid, true);
  assert.equal(run("verify", output, "03".repeat(32)).status, 1);
  const balances = run("balances", output, "--now", "200");
  assert.equal(JSON.parse(balances.stdout).reservedBaseUnits, "1000000");
  writeFileSync(claims, JSON.stringify([accountId]), { mode: 0o600 });
  assert.equal(JSON.parse(run("balances", output, "--now", "200", "--paid", claims).stdout).reportedPaidBaseUnits, "1000000");
  assert.equal(run("balances", output).status, 1);
  assert.equal(run("settle", input, join(directory, "early.json"), "--now", "199").status, 1);
  assert.equal(run("settle", input, join(directory, "bad.json"), "--now", "2e2").status, 1);
});
