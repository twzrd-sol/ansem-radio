import { useEffect, useState } from "react";
import { watchVisible } from "./refresh";

/** A short-lived live/offline observation from Twitch, with no viewer or performance history. */
export type Station =
  | { status: "loading" | "unknown" }
  | { status: "ready"; live: boolean; observedAt: number };

const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
export const freshRead = (at: number, now: number, age = 120_000) => Number.isFinite(at) && Number.isFinite(now) && at <= now && now - at <= age;

/** Expire a cached station flag as the page clock advances, including after resuming a suspended tab. */
export function stationAt(station: Station, now: number): Station {
  return station.status === "ready" && !freshRead(station.observedAt, now) ? { status: "unknown" } : station;
}

export async function readStation(fetcher: typeof fetch = fetch, clock?: number): Promise<Station> {
  try {
    const res = await fetcher("/hub/api/station-status", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { status: "unknown" };
    const body = object(await res.json());
    const observedAt = typeof body?.observedAt === "string" ? Date.parse(body.observedAt) : NaN;
    const now = clock ?? Date.now();
    if (!body || body.source !== "Data: Twitch" || !freshRead(observedAt, now)) return { status: "unknown" };
    if (body.status === "live") return { status: "ready", live: true, observedAt };
    if (body.status === "offline") return { status: "ready", live: false, observedAt };
    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

export function useStation(enabled = true): Station {
  const [station, setStation] = useState<Station>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const stop = watchVisible(async () => { const s = await readStation(); if (alive) setStation(s); });
    return () => {
      alive = false;
      stop();
    };
  }, [enabled]);
  return station;
}
