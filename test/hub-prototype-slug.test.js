import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createHubApi } from "../src/hub/api.js";
import { createClaimStore } from "../src/hub/claims.js";
import { listing, registry } from "../src/hub/registry.js";
import { createHubStore } from "../src/hub/store.js";

const index = {
  status: () => ({ network: "devnet", observedAt: 1_700_000_000, slot: 1, stale: false }),
  listingArena: () => null,
  history: () => [],
  positionsOf: () => [],
};
const hostile = { slug: "constructor", name: "Constructor", kind: "tracked", twitch: "constructor_", streamer: null, mint: null, blurb: null };

describe("prototype slugs", () => {
  it("does not treat an inherited object property as a claim", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hub-proto-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const claims = createClaimStore({ dir });
    assert.equal(claims.has("constructor"), false);
    assert.equal(claims.get("constructor"), null);
    assert.equal(claims.retired("constructor"), null);
    assert.throws(() => claims.set("constructor", { subject: "1" }), /reserved slug/);
  });

  it("refuses a reserved slug in the operator registry", () => {
    assert.throws(() => listing(hostile), /bad slug/);
    assert.throws(() => registry([hostile]), /bad slug/);
  });

  it("drops a constructor listing instead of crashing the market and badge routes", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hub-proto-api-"));
    const store = createHubStore({ dir });
    const api = createHubApi({
      origins: "https://hub.example",
      store,
      now: () => 1_791_025_000,
      market: { registry: [hostile], index },
    });
    const server = createServer(api);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const market = await fetch(`${base}/hub/api/market/constructor`);
    const badge = await fetch(`${base}/hub/api/badge/constructor.svg`);
    assert.equal(market.status, 404);
    assert.equal(badge.status, 404);
  });
});
