import { useEffect, useState } from "react";
import { watchVisible } from "./refresh";

/** Display observations only. Current status and recorded history have independent evidence. */
export interface StationPulse {
  generatedAt: number;
  trackedTotal: number | null;
  board: { at: number; live: Array<{ login: string; viewers: number | null }> } | null;
  history: { hours: 6; from: number; to: number; coverage: number; recordedMinutes: number; leader: { login: string; minutesLive: number } | null } | null;
}
/** Nothing in this read reaches native points, rewards, identity links or chain instructions. */
export type Station = ({ status: "loading" | "unknown" } | { status: "ready"; live: boolean; observedAt?: number }) & { pulse?: StationPulse };

const LOGIN = /^[a-z0-9_]{3,25}$/;
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const stamp = (v: unknown) => typeof v === "string" ? Date.parse(v) : NaN;
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export const freshRead = (at: number, now: number, age = 120_000) => Number.isFinite(at) && Number.isFinite(now) && at <= now && now - at <= age;

function currentBoard(body: Record<string, unknown>, now: number): StationPulse["board"] {
  const at = stamp(body.board_updated_at);
  if (body.board_status !== "available" || !freshRead(at, now) || !Array.isArray(body.live_now) || body.live_now.length > 100) return null;
  const live: NonNullable<StationPulse["board"]>["live"] = [];
  const seen = new Set<string>();
  for (const value of body.live_now) {
    const row = object(value);
    if (!row || typeof row.login !== "string" || !LOGIN.test(row.login) || seen.has(row.login) || (row.viewer_count !== null && !count(row.viewer_count))) return null;
    seen.add(row.login);
    live.push({ login: row.login, viewers: row.viewer_count as number | null });
  }
  return { at, live: live.sort((a, b) => (b.viewers ?? -1) - (a.viewers ?? -1) || a.login.localeCompare(b.login)) };
}

function recordedHistory(body: Record<string, unknown>, generatedAt: number): StationPulse["history"] {
  const window = object(body.window);
  const from = stamp(window?.from), to = stamp(window?.to);
  if (body.hours !== 6 || window?.hours !== 6 || !Number.isFinite(from) || to !== generatedAt || to - from !== 6 * 3_600_000 || typeof body.coverage !== "number" || !Number.isFinite(body.coverage) || body.coverage < 0 || body.coverage > 1 || !count(body.recorded_minutes) || body.recorded_minutes > 360 || !Array.isArray(body.streamers) || body.streamers.length > 100) return null;
  let leader: NonNullable<StationPulse["history"]>["leader"] = null;
  let best = 0;
  const seen = new Set<string>();
  for (const value of body.streamers) {
    const row = object(value);
    if (!row || typeof row.login !== "string" || !LOGIN.test(row.login) || seen.has(row.login) || typeof row.attention_share !== "number" || !Number.isFinite(row.attention_share) || row.attention_share < 0 || row.attention_share > 1 || !count(row.minutes_live) || row.minutes_live > 360) return null;
    seen.add(row.login);
    if (body.recorded_minutes > 0 && row.minutes_live > 0 && (row.attention_share > best || (row.attention_share === best && best > 0 && row.login.localeCompare(leader!.login) < 0))) {
      best = row.attention_share;
      leader = { login: row.login, minutesLive: row.minutes_live };
    }
  }
  return { hours: 6, from, to, coverage: body.coverage, recordedMinutes: body.recorded_minutes, leader };
}

/** Expire a cached station flag as the page clock advances, including after resuming a suspended tab. */
export function stationAt(station: Station, now: number): Station {
  return station.status === "ready" && station.observedAt !== undefined && !freshRead(station.observedAt, now, 300_000) ? { status: "unknown", pulse: station.pulse } : station;
}

export async function readStation(fetcher: typeof fetch = fetch, clock?: number): Promise<Station> {
  try {
    const res = await fetcher("/macro/state?hours=6", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { status: "unknown" };
    const body = object(await res.json());
    const now = clock ?? Date.now();
    const generatedAt = stamp(body?.generated_at);
    if (!body || body.enabled !== true || !freshRead(generatedAt, now)) return { status: "unknown" };
    const pulse: StationPulse = { generatedAt, trackedTotal: count(body.tracked_total) && body.tracked_total > 0 ? body.tracked_total : null, board: currentBoard(body, now), history: recordedHistory(body, generatedAt) };
    const station = object(body.station);
    const observedAt = stamp(station?.latest_minute);
    return station && typeof station.live === "boolean" && station.stale === false && freshRead(observedAt, now, 300_000) ? { status: "ready", live: station.live, observedAt, pulse } : { status: "unknown", pulse };
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
