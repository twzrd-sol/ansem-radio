import { describe, expect, it } from "vitest";

import { HubApiError } from "./api";
import { anyBackingOpen, fetchMarket, isMissingListing } from "./market";

describe("anyBackingOpen", () => {
  it("is false when the market is missing or has no listings array", () => {
    expect(anyBackingOpen(null)).toBe(false);
    expect(anyBackingOpen(undefined)).toBe(false);
    expect(anyBackingOpen({})).toBe(false);
    expect(anyBackingOpen({ listings: null })).toBe(false);
    expect(anyBackingOpen({ listings: [] })).toBe(false);
  });

  it("reads backingOpen from listings when they exist", () => {
    expect(anyBackingOpen({ listings: [{ backingOpen: false }] })).toBe(false);
    expect(anyBackingOpen({ listings: [{ backingOpen: false }, { backingOpen: true }] })).toBe(true);
  });
});

describe("listing load failures", () => {
  it("treats a 404 / no_such_listing as a missing page, not a broken one", () => {
    expect(isMissingListing(new HubApiError(404, "no_such_listing"))).toBe(true);
    expect(isMissingListing(new HubApiError(404, "not_found"))).toBe(true);
    expect(isMissingListing(new HubApiError(500, "hub_api_failed"))).toBe(false);
    expect(isMissingListing(new HubApiError(502, "bad_gateway"))).toBe(false);
    expect(isMissingListing(new Error("network"))).toBe(false);
  });
});

describe("fetchMarket", () => {
  it("refuses a 200 HTML shell so the tape does not treat it as a ready board", async () => {
    const html = "<!doctype html><html><body>hub</body></html>";
    await expect(
      fetchMarket(async () => new Response(html, { status: 200, headers: { "content-type": "application/json" } })),
    ).rejects.toBeInstanceOf(HubApiError);
    await expect(
      fetchMarket(async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })),
    ).rejects.toMatchObject({ status: 502, code: "bad_response" });
  });

  it("accepts a market with an listings array", async () => {
    const body = { network: "devnet", observedAt: null, slot: null, stale: false, generatedAt: 1, listings: [] };
    const market = await fetchMarket(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    expect(market.listings).toEqual([]);
  });
});
