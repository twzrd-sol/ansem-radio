// The backing board (docs/DECISION_20261002_MULTI_STREAMER_PATH.md, Stage 1): what the station's market routes
// serve, the client that reads them, and the few derivations the screens share. Backing is the only metric tied
// to something a fan owns; a Twitch row is display only and travels as its own object with its provenance line.
import { useCallback, useEffect, useState } from "react";

import { withdrawAvailableAt } from "../chain/season";
import { API_BASE, HubApiError } from "./api";
import { watchVisible } from "./refresh";

export type ListingKind = "featured" | "tracked" | "demo";

/** Stamped on every aggregate: where and when it was true. A screen never shows a number without these. */
export interface Observed {
  network: string;
  observedAt: string | null;
  slot: number | null;
  stale: boolean;
  generatedAt: number;
}

/** One arena as the index read it. Amounts are base units as decimal strings; `requested` is a count, never a sum. */
export interface ListingArena {
  address: string;
  streamer: string;
  mint: string;
  decimals: number;
  closed: boolean;
  seasonStart: string;
  seasonSeconds: string;
  season: string;
  total: string;
  backers: string;
  requested: number;
  /** Total since the first snapshot at or after this season opened; null until one exists. */
  netFlow: string | null;
}

/** Twitch's public figures about a channel, recorded by the station. Display only. */
export interface Performance {
  live: boolean;
  viewers: number | null;
  game: string | null;
  startedAt: string | null;
  rank: number | null;
  deltaViewers: number | null;
  /** Daily peak audience for the last seven UTC days, oldest first; null where the station has no reading. */
  week?: Array<number | null>;
  provenance: string;
}

export interface HistoryPoint {
  at: string;
  slot: number;
  total: string;
  backers: string;
  requested: number;
}

export interface Listing {
  slug: string;
  name: string;
  kind: ListingKind;
  demo: boolean;
  blurb: string | null;
  twitch: string | null;
  /** True once the streamer signed in with Twitch to make the page theirs; absent in older reads. */
  claimed?: boolean;
  /** True when the station derived this listing's backing pair from the streamer's own linked wallet. */
  claimDerived?: boolean;
  /** The registry pair an arena would derive from; null when the listing has no backing configured. */
  keys: { streamer: string; mint: string } | null;
  backingOpen: boolean;
  arena: ListingArena | null;
  performance: Performance | null;
  history?: HistoryPoint[];
}

export interface Market extends Observed {
  listings: Listing[];
  /** Fixtures for design review; every screen that shows them carries a SAMPLE mark. */
  sample?: boolean;
}
export interface ListingDetail extends Observed {
  listing: Listing;
}
export interface FanPosition {
  arena: string;
  address: string;
  state: "active" | "requested";
  amount: string;
  requestedSeason: string;
  openedAt: string;
  schedule: { seasonStart: string; seasonSeconds: string; closed: boolean } | null;
  slug: string | null;
}
export interface FanPositions extends Observed {
  fan: string;
  positions: FanPosition[];
}

export const isAddress = (text: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const read = async <T>(fetchImpl: Fetch, path: string): Promise<T> => {
  const response = await fetchImpl(`${API_BASE}${path}`, { credentials: "same-origin", cache: "no-store" });
  const json = (await response.json().catch(() => ({ error: "bad_response" }))) as Record<string, unknown>;
  if (!response.ok) throw new HubApiError(response.status, String(json.error ?? "request_failed"), typeof json.detail === "string" ? json.detail : undefined);
  return json as T;
};

export const fetchMarket = (fetchImpl: Fetch = fetch) => read<Market>(fetchImpl, "/market");
export const fetchListing = (slug: string, fetchImpl: Fetch = fetch) => read<ListingDetail>(fetchImpl, `/market/${encodeURIComponent(slug)}`);
export const fetchPositions = (fan: string, fetchImpl: Fetch = fetch) => {
  if (!isAddress(fan)) return Promise.reject(new HubApiError(400, "fan_address_required"));
  return read<FanPositions>(fetchImpl, `/market/positions?fan=${fan}`);
};

/** The board's order: listings fans can back first, most backed first; then live channels by viewers; then name. */
export function sortListings(listings: Listing[]): Listing[] {
  const backed = (l: Listing) => (l.arena ? BigInt(l.arena.total) : -1n);
  return [...listings].sort((a, b) => {
    if (a.backingOpen !== b.backingOpen) return a.backingOpen ? -1 : 1;
    const ba = backed(a);
    const bb = backed(b);
    if (ba !== bb) return ba > bb ? -1 : 1;
    const va = a.performance?.live ? a.performance.viewers ?? 0 : -1;
    const vb = b.performance?.live ? b.performance.viewers ?? 0 : -1;
    if (va !== vb) return vb - va;
    return a.name.localeCompare(b.name);
  });
}

/** A watchlist ranks currently live followed creators first, regardless of backing availability. */
export function followingListings(listings: Listing[], followed: readonly string[]): Listing[] {
  const slugs = new Set(followed);
  return listings.filter((l) => slugs.has(l.slug)).sort((a, b) => {
    const live = Number(Boolean(b.performance?.live)) - Number(Boolean(a.performance?.live));
    return live || (b.performance?.viewers ?? 0) - (a.performance?.viewers ?? 0) || a.name.localeCompare(b.name);
  });
}

/** How a fan should read one of their positions now: a request whose season ended is releasable. */
export function positionStatus(p: FanPosition, nowSeconds: bigint): { state: "active" | "requested" | "releasable"; releaseAt: number | null } {
  if (!p.schedule) return { state: p.state, releaseAt: null };
  if (p.schedule.closed) return { state: "releasable", releaseAt: null };
  if (p.state === "active") return { state: "active", releaseAt: null };
  const at = withdrawAvailableAt(BigInt(p.schedule.seasonStart), BigInt(p.schedule.seasonSeconds), BigInt(p.requestedSeason));
  return { state: nowSeconds >= at ? "releasable" : "requested", releaseAt: Number(at) * 1000 };
}

/** Points on a sparkline: the history scaled into a box; null when there is nothing to draw. */
export function sparkline(points: Array<{ total: string }>, width = 200, height = 48): string | null {
  if (points.length < 2) return null;
  const values = points.map((p) => Number(BigInt(p.total)));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
}

type Load = "loading" | "error" | "ready";

/** The live market, refreshed every minute while the tab is visible. Off in a design preview. */
export function useMarket(enabled: boolean, fetchImpl: Fetch = fetch): { load: Load; market: Market | null; refresh: () => Promise<void> } {
  const [load, setLoad] = useState<Load>("loading");
  const [market, setMarket] = useState<Market | null>(null);
  const refresh = useCallback(async () => {
    try {
      setMarket(await fetchMarket(fetchImpl));
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, [fetchImpl]);
  useEffect(() => {
    if (!enabled) return;
    return watchVisible(refresh);
  }, [enabled, refresh]);
  return { load, market, refresh };
}

/** One listing with its history. */
export function useListing(slug: string | null, enabled: boolean, fetchImpl: Fetch = fetch): { load: Load; detail: ListingDetail | null; refresh: () => Promise<void> } {
  const [load, setLoad] = useState<Load>("loading");
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const refresh = useCallback(async () => {
    if (!slug) return;
    try {
      setDetail(await fetchListing(slug, fetchImpl));
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, [slug, fetchImpl]);
  useEffect(() => {
    if (!enabled || !slug) return;
    setLoad("loading");
    return watchVisible(refresh);
  }, [enabled, slug, refresh]);
  return { load, detail, refresh };
}
