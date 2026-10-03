import { describe, expect, it, vi } from "vitest";
import { readStation, stationAt } from "./station";

const NOW = Date.parse("2026-10-03T14:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const body = () => ({ enabled: true, generated_at: iso(NOW), station: { live: false, stale: false, latest_minute: iso(NOW - 60_000) }, board_status: "available", board_updated_at: iso(NOW - 10_000), tracked_total: 12, live_now: [{ login: "xqc", viewer_count: 1234, delta_viewers: 10 }], hours: 6, window: { from: iso(NOW - 6 * 3_600_000), to: iso(NOW), hours: 6 }, coverage: 1, recorded_minutes: 359, streamers: [{ login: "xqc", attention_share: 1, minutes_live: 4 }] });
const get = (value: unknown) => (async () => new Response(JSON.stringify(value))) as typeof fetch;
const read = (value: unknown) => readStation(get(value), NOW);

describe("station brief source and freshness", () => {
  it("retains the current macro read independently of Radio LAN being offline", async () => {
    const station = await read(body());
    expect(station).toMatchObject({ status: "ready", live: false, observedAt: NOW - 60_000, pulse: { generatedAt: NOW, trackedTotal: 12, board: { at: NOW - 10_000, live: [{ login: "xqc", viewers: 1234 }] }, history: { hours: 6, recordedMinutes: 359, coverage: 1, leader: { login: "xqc", minutesLive: 4 } } } });
  });
  it("does not convert a missing stale flag or a missing/future station timestamp into live status", async () => {
    for (const station of [{ live: true }, { live: true, stale: false }, { live: true, stale: false, latest_minute: iso(NOW + 60_000) }, { live: true, stale: false, latest_minute: iso(NOW - 300_001) }]) expect((await read({ ...body(), station })).status).toBe("unknown");
  });
  it("treats a stale board as unknown without erasing recorded history", async () => {
    const station = await read({ ...body(), board_updated_at: iso(NOW - 120_001) });
    expect(station.pulse?.board).toBeNull();
    expect(station.pulse?.history?.leader?.login).toBe("xqc");
  });
  it("rejects disabled, missing, future and expired macro generation times", async () => {
    for (const value of [{ ...body(), enabled: false }, { ...body(), generated_at: undefined }, { ...body(), generated_at: iso(NOW + 60_000) }, { ...body(), generated_at: iso(NOW - 120_001) }]) {
      expect(await read(value)).toEqual({ status: "unknown" });
    }
  });
  it("rejects bad or duplicate live rows instead of reporting an empty current board", async () => {
    for (const live_now of [[{ login: "javascript:bad", viewer_count: 1 }], [{ login: "xqc", viewer_count: -1 }], [...body().live_now, ...body().live_now]]) expect((await read({ ...body(), live_now })).pulse?.board).toBeNull();
    expect((await read({ ...body(), live_now: [] })).pulse?.board?.live).toEqual([]);
  });
  it("refuses impossible history while preserving valid current rows", async () => {
    for (const change of [{ coverage: 1.1 }, { recorded_minutes: -1 }, { hours: 24 }, { window: { ...body().window, from: iso(NOW + 1) } }, { streamers: [{ login: "xqc", attention_share: 2, minutes_live: 1 }] }]) {
      const station = await read({ ...body(), ...change });
      expect(station.pulse?.history).toBeNull();
      expect(station.pulse?.board?.live).toHaveLength(1);
    }
  });
  it("picks a positive recorded leader and keeps an empty history honest", async () => {
    expect((await read({ ...body(), streamers: [{ login: "agent00", attention_share: 0, minutes_live: 0 }, ...body().streamers] })).pulse?.history?.leader?.login).toBe("xqc");
    expect((await read({ ...body(), recorded_minutes: 0, streamers: [] })).pulse?.history?.leader).toBeNull();
  });
  it("falls back to unknown on HTTP, JSON and network failures", async () => {
    expect(await readStation((async () => new Response("{}", { status: 503 })) as typeof fetch, NOW)).toEqual({ status: "unknown" });
    expect(await readStation((async () => new Response("invalid")) as typeof fetch, NOW)).toEqual({ status: "unknown" });
    expect(await readStation((async () => { throw new Error("offline"); }) as typeof fetch, NOW)).toEqual({ status: "unknown" });
  });
  it("checks freshness after the response arrives, rather than before its source timestamp exists", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW - 20);
      const fetcher = (async () => { vi.setSystemTime(NOW); return new Response(JSON.stringify(body())); }) as typeof fetch;
      expect((await readStation(fetcher)).status).toBe("ready");
    } finally { vi.useRealTimers(); }
  });
  it("expires a cached station flag on the page clock while retaining separately checked macro evidence", async () => {
    const station = await read(body());
    expect(stationAt(station, NOW + 240_000).status).toBe("ready");
    expect(stationAt(station, NOW + 240_001)).toMatchObject({ status: "unknown", pulse: station.pulse });
  });
});
