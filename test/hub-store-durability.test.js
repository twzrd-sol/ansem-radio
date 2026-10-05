import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
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
