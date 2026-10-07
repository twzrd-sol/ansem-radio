import { useEffect, useState } from "react";
import { NETWORK } from "../chain/config";
import { fetchPositions, type FanPositions } from "./market";
import { watchVisible } from "./refresh";

/** Fail closed on mismatched or stale reads. A wallet connection alone is not backing. */
export function hasBacking(data: FanPositions | null, wallet: string | null, now = Date.now()): boolean {
  if (!data || !wallet || data.fan !== wallet || data.network !== NETWORK || data.stale || !data.observedAt) return false;
  const age = now - Date.parse(data.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 120_000) return false;
  return data.positions.some((p) => {
    try { return (p.state === "active" || p.state === "requested") && BigInt(p.amount) > 0n; } catch { return false; }
  });
}

export function useBacker(wallet: string | null, enabled: boolean) {
  const [data, setData] = useState<FanPositions | null>(null);
  useEffect(() => {
    if (!enabled || !wallet) return;
    let cancelled = false;
    const refresh = async () => {
      const positions = await fetchPositions(wallet).catch(() => null);
      if (!cancelled) setData(positions);
    };
    const stop = watchVisible(refresh);
    return () => { cancelled = true; stop(); };
  }, [wallet, enabled]);
  return enabled && hasBacking(data, wallet);
}
