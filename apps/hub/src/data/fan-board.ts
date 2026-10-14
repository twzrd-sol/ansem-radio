// The fan board from GET /hub/api/board. Markets rank by RLAN backed; creators without one rank by how many fans asked
// for a market. Twitch figures are a labelled display read and never change the order.
import { API_BASE, HubApiError } from "./api";
import { HUB_FAN_BOARD_ENABLED } from "./feature-flags";

export interface FanBoardMarket {
  address: string;
  total: string;
  backers: string;
  decimals: number;
  closed: boolean;
}

export interface FanBoardEntry {
  twitch: string;
  slug: string | null;
  name: string;
  kind: string;
  market: FanBoardMarket | null;
  asks: number;
  /** No market yet and at least `askThreshold` asks: in line for a market. */
  ready?: boolean;
  performance: { source?: string; live?: boolean; viewers?: number | null; game?: string | null } | null;
}

export interface FanBoard {
  rankedBy: "rlan_backed";
  askThreshold: number;
  queue: Array<{ twitch: string; asks: number }>;
  network: string;
  generatedAt: number;
  summary: { creators: number; markets: number; backers: number; ready: number; askedCreators: number; asks: number; discoveredAt: string | null };
  entries: FanBoardEntry[];
}

function isEntry(value: unknown): value is FanBoardEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as FanBoardEntry;
  if (typeof e.twitch !== "string" || !/^[a-z0-9_]{3,25}$/.test(e.twitch) || typeof e.name !== "string" || !Number.isInteger(e.asks)) return false;
  if (e.market !== null && (typeof e.market !== "object" || !/^\d+$/.test(e.market.total) || !/^\d+$/.test(e.market.backers) || !Number.isInteger(e.market.decimals))) return false;
  return true;
}

export function parseFanBoard(body: unknown): FanBoard | null {
  if (!body || typeof body !== "object") return null;
  const board = body as FanBoard;
  if (board.rankedBy !== "rlan_backed" || !Array.isArray(board.entries) || !board.summary || !Number.isInteger(board.askThreshold) || board.askThreshold < 1) return null;
  return board.entries.every(isEntry) ? board : null;
}

export async function fetchFanBoard({ fetchImpl = fetch, enabled = HUB_FAN_BOARD_ENABLED }: { fetchImpl?: typeof fetch; enabled?: boolean } = {}): Promise<FanBoard | null> {
  if (!enabled) return null;
  const response = await fetchImpl(`${API_BASE}/board`, { cache: "no-store", credentials: "same-origin" });
  if (response.status === 404) return null;
  const json = (await response.json().catch(() => ({ error: "bad_response" }))) as Record<string, unknown>;
  if (!response.ok) throw new HubApiError(response.status, String(json.error ?? "request_failed"));
  const board = parseFanBoard(json);
  if (!board) throw new HubApiError(500, "fan_board_shape");
  return board;
}
