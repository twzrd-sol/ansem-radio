// Leak canary: fails if any tracked file carries key material, or if the .gitignore guard is weakened.
// Public keys, program ids, signatures and commitments are fine; seeds, keypairs and tokens are not.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SKIP_EXT = /\.(so|png|jpe?g|gif|ico|woff2?|ttf|pdf|lock)$/i;
const SKIP_FILE = new Set(["package-lock.json"]);

// Files allowed to contain seed-shaped fields, with the reason. Anything else that matches fails.
const SEED_ALLOWLIST = new Map([
  ["test/fixtures/attribution-v1.json", "regression pin with throwaway seeds (01…, 02…); see its _note"],
]);

const PATTERNS = [
  { name: "Solana keypair array", re: /\[\s*(\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/ },
  { name: "Twitch OAuth token", re: /\boauth:[A-Za-z0-9]{20,}/ },
  { name: "secrets-manager token", re: /\bdp\.(st|pt|sa|ct)\.[A-Za-z0-9]{10,}/ },
  { name: "PEM private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
];
const SEED_FIELD = /"[A-Za-z_]*(seed|secret|private_key)[A-Za-z_]*"\s*:\s*"[0-9A-Fa-f]{64,}"/;
const KEY_FILENAME = /(^|\/)(id|fee-payer|[A-Za-z0-9_.-]*keypair[A-Za-z0-9_.-]*)\.json$/;

function trackedFiles() {
  const out = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  assert.equal(out.status, 0, "git ls-files must work");
  return out.stdout.split("\0").filter(Boolean);
}

test("no tracked file is named like a keypair", () => {
  const bad = trackedFiles().filter((f) => KEY_FILENAME.test(f));
  assert.deepEqual(bad, []);
});

test("no tracked file contains key material", () => {
  const hits = [];
  for (const f of trackedFiles()) {
    if (SKIP_EXT.test(f) || SKIP_FILE.has(f)) continue;
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const { name, re } of PATTERNS) if (re.test(text)) hits.push(`${f}: ${name}`);
    if (SEED_FIELD.test(text) && !SEED_ALLOWLIST.has(f)) hits.push(`${f}: seed-shaped field outside the allowlist`);
  }
  assert.deepEqual(hits, []);
});

test("the .gitignore guard for key files is intact", () => {
  const ignore = readFileSync(".gitignore", "utf8").split("\n").map((l) => l.trim());
  for (const pat of ["*keypair*.json", "fee-payer.json", "id.json", "*.pem"]) {
    assert.ok(ignore.includes(pat), `.gitignore must keep '${pat}'`);
  }
});

test("the seed allowlist names only files that still exist and carry a reason", () => {
  const tracked = new Set(trackedFiles());
  for (const [f, reason] of SEED_ALLOWLIST) {
    assert.ok(tracked.has(f), `${f} is allowlisted but not tracked`);
    assert.ok(reason.length > 10, `${f} needs a reason`);
  }
});
