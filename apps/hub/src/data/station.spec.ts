import { describe, expect, it, vi } from "vitest";
import { readStation, stationAt } from "./station";

const NOW = Date.parse("2026-10-03T14:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const body = (status: string, observedAt = iso(NOW - 60_000)) => ({ status, source: "Data: Twitch", observedAt });
const get = (value: unknown) => (async () => new Response(JSON.stringify(value))) as typeof fetch;
const read = (value: unknown) => readStation(get(value), NOW);

describe("station status source and freshness", () => {
  it("reads only the short-lived status route", async () => {
    const fetcher = vi.fn(get(body("offline")));
    const station = await readStation(fetcher, NOW);
    expect(fetcher).toHaveBeenCalledWith("/hub/api/station-status", { cache: "no-store", signal: expect.any(AbortSignal) });
    expect(station).toEqual({ status: "ready", live: false, observedAt: NOW - 60_000 });
  });
  it("accepts current live and offline states only when Twitch provenance and time are valid", async () => {
    expect(await read(body("live"))).toMatchObject({ status: "ready", live: true });
    expect(await read(body("offline"))).toMatchObject({ status: "ready", live: false });
    for (const value of [body("unknown"), { ...body("live"), source: "local witness" }, body("live", iso(NOW + 1)), body("live", iso(NOW - 120_001))]) {
      expect(await read(value)).toEqual({ status: "unknown" });
    }
  });
  it("expires a cached status when its observation becomes stale", async () => {
    const station = await read(body("live"));
    expect(stationAt(station, NOW + 59_999).status).toBe("ready");
    expect(stationAt(station, NOW + 60_001)).toEqual({ status: "unknown" });
  });
  it("falls back to unknown on HTTP, JSON and network failures", async () => {
    expect(await readStation((async () => new Response("{}", { status: 503 })) as typeof fetch, NOW)).toEqual({ status: "unknown" });
    expect(await readStation((async () => new Response("invalid")) as typeof fetch, NOW)).toEqual({ status: "unknown" });
    expect(await readStation((async () => { throw new Error("offline"); }) as typeof fetch, NOW)).toEqual({ status: "unknown" });
  });
});
