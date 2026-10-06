import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHubStore } from "../src/hub/store.js";

// A failed disk write must not leave an account or session in memory that the file does not have.
test("a failed write leaves no account or session behind in memory", (t) => {
  if (process.getuid?.() === 0) return t.skip("root ignores directory permissions");
  const dir = mkdtempSync(join(tmpdir(), "hub-store-"));
  t.after(() => { chmodSync(dir, 0o700); rmSync(dir, { recursive: true, force: true }); });
  const store = createHubStore({ dir });
  chmodSync(dir, 0o500);
  const account = { id: "a1", userHandle: "u1", credentials: [{ credentialId: "c1" }] };
  assert.throws(() => store.createAccount(account));
  assert.equal(store.account("a1"), null, "the account is not kept after a failed write");
  assert.equal(store.accountByCredential("c1"), null, "the credential is not kept either");
  assert.throws(() => store.createSession({ id: "s1", accountId: "a1" }));
  assert.equal(store.session("s1"), null, "the session is not kept after a failed write");
  chmodSync(dir, 0o700);
  store.createAccount(account);
  assert.equal(store.account("a1").id, "a1", "a retry after the disk recovers succeeds instead of reporting a duplicate");
  assert.throws(() => { chmodSync(dir, 0o500); store.updateAccount("a1", { handle: "x" }); });
  chmodSync(dir, 0o700);
  assert.equal(store.account("a1").handle, undefined, "a failed update is not kept");
});

// ---- submissions.jsonl tail recovery -------------------------------------

const submissionsPath = (dir) => join(dir, "submissions.jsonl");
const countSubmissions = (dir) => readFileSync(submissionsPath(dir), "utf8").split("\n").filter((l) => l.trim()).length;

test("a malformed interior submission line still throws with its file line number", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(submissionsPath(dir), `${JSON.stringify({ id: "r1" })}\n{oops\n${JSON.stringify({ id: "r2" })}\n`);
  assert.throws(
    () => createHubStore({ dir }),
    (cause) => cause instanceof SyntaxError && /submissions\.jsonl:2/.test(cause.message),
  );
});

test("a malformed newline-terminated submission tail throws instead of being discarded", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(submissionsPath(dir), `${JSON.stringify({ id: "r1" })}\n{oops\n`);
  assert.throws(() => createHubStore({ dir }));
  assert.equal(readFileSync(submissionsPath(dir), "utf8").endsWith("\n"), true, "the file is not truncated on a hard error");
});

test("an invalid unterminated final fragment is discarded and truncated before later appends", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(submissionsPath(dir), `${JSON.stringify({ id: "r🌻1" })}\n{"id":"torn`);
  const store = createHubStore({ dir });
  assert.deepEqual(store.submissions().map((r) => r.id), ["r🌻1"], "only the fragment is not kept");
  assert.equal(readFileSync(submissionsPath(dir), "utf8"), `${JSON.stringify({ id: "r🌻1" })}\n`, "the valid UTF-8 record stays intact on disk");
  store.addSubmission({ id: "r2" });
  assert.equal(readFileSync(submissionsPath(dir), "utf8"), `${JSON.stringify({ id: "r🌻1" })}\n${JSON.stringify({ id: "r2" })}\n`, "the next append lands after the truncated tail");
});

test("an unterminated JSON array is not accepted as a submission record", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(submissionsPath(dir), `${JSON.stringify({ id: "r1" })}\n[]`);
  const store = createHubStore({ dir });
  assert.deepEqual(store.submissions().map((r) => r.id), ["r1"]);
  assert.equal(readFileSync(submissionsPath(dir), "utf8"), `${JSON.stringify({ id: "r1" })}\n`);
});

test("a valid unterminated final record loads and survives restart with the next append", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(submissionsPath(dir), `${JSON.stringify({ id: "r1" })}\n${JSON.stringify({ id: "r2" })}`);
  const store = createHubStore({ dir });
  assert.deepEqual(store.submissions().map((r) => r.id), ["r1", "r2"], "an unterminated but complete record loads");
  assert.equal(readFileSync(submissionsPath(dir), "utf8").endsWith("\n"), false, "loading did not rewrite the file");
  store.addSubmission({ id: "r3" });
  assert.equal(readFileSync(submissionsPath(dir), "utf8"), `${JSON.stringify({ id: "r1" })}\n${JSON.stringify({ id: "r2" })}\n${JSON.stringify({ id: "r3" })}\n`, "the next append first closes the unterminated line");
  createHubStore({ dir });
  assert.equal(countSubmissions(dir), 3, "a restart after the append sees all three records");
});

test("existing blank lines in submissions.jsonl keep loading as before the tail rule", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(submissionsPath(dir), `${JSON.stringify({ id: "r1" })}\n\n   \n${JSON.stringify({ id: "r2" })}\n`);
  const store = createHubStore({ dir });
  assert.deepEqual(store.submissions().map((r) => r.id), ["r1", "r2"], "blank and whitespace-only lines are skipped");
  assert.equal(countSubmissions(dir), 2);
});

test("a failed session delete or expiry leaves the session in memory as on disk", (t) => {
  if (process.getuid?.() === 0) return t.skip("root ignores directory permissions");
  const dir = mkdtempSync(join(tmpdir(), "hub-store-"));
  t.after(() => { chmodSync(dir, 0o700); rmSync(dir, { recursive: true, force: true }); });
  const store = createHubStore({ dir });
  store.createSession({ id: "s1", accountId: "a1", expiresAt: 10 });
  chmodSync(dir, 0o500);
  assert.throws(() => store.deleteSession("s1"));
  assert.equal(store.session("s1")?.id, "s1", "a failed delete keeps the session");
  assert.throws(() => store.expireSessions(100));
  assert.equal(store.session("s1")?.id, "s1", "a failed expiry keeps the session");
  chmodSync(dir, 0o700);
  store.expireSessions(100);
  assert.equal(store.session("s1"), null);
});
