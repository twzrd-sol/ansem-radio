import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSponsorStore } from "../src/x402/sponsor-store.js";

test("a failed order write leaves no order or update behind in memory", (t) => {
  if (process.getuid?.() === 0) return t.skip("root ignores directory permissions");
  const dir = mkdtempSync(join(tmpdir(), "sponsor-store-"));
  t.after(() => { chmodSync(dir, 0o700); rmSync(dir, { recursive: true, force: true }); });
  const store = createSponsorStore({ path: join(dir, "orders.json") });
  store.createQuote({ id: "q1", status: "open" });
  chmodSync(dir, 0o500);
  assert.throws(() => store.createOrder({ id: "o1", payment_hash: "h1" }));
  assert.equal(store.order("o1"), null, "the order is not kept after a failed write");
  assert.throws(() => store.updateQuote("q1", { status: "paid" }));
  assert.equal(store.quote("q1").status, "open", "a failed update is not kept");
  chmodSync(dir, 0o700);
  store.createOrder({ id: "o1", payment_hash: "h1" });
  assert.equal(store.order("o1").id, "o1", "a retry succeeds instead of reporting a duplicate");
});
