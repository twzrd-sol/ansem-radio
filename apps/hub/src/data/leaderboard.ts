// The streamer board from GET /hub/api/leaderboard. Rank is season points. Chat is a labelled Twitch read, not a score.
import { API_BASE, HubApiError } from "./api";
import { HUB_LEADERBOARD_ENABLED } from "./feature-flags";

export interface LeaderboardMarks {
  count: number;
  scored: boolean;
}

export interface LeaderboardChat {
  messages: number;
  peakChatters: number | null;
  source: "Data: Twitch";
}

export interface LeaderboardRow {
  rank: number;
  login: string;
  slug: string;
  name: string;
  points: string;
  marks: LeaderboardMarks;
  chat: LeaderboardChat | null;
}

export interface LeaderboardPage {
  ranking: "season_points";
  season: { number: string; network: string; open: boolean; twitchMarksScore: boolean } | null;
  rows: LeaderboardRow[];
  page: { limit: number; after: string | null; next: string | null; total: number };
  empty: boolean;
  source: { points: string; chat: string | null };
  generatedAt: number;
}

export type LeaderboardLoad =
  | { status: "off" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; board: LeaderboardPage };

function isRow(value: unknown): value is LeaderboardRow {
  if (!value || typeof value !== "object") return false;
  const row = value as LeaderboardRow;
  return typeof row.login === "string" && typeof row.points === "string" && Number.isInteger(row.rank) && row.marks != null && typeof row.marks.count === "number";
}

export function parseLeaderboard(body: unknown): LeaderboardPage | null {
  if (!body || typeof body !== "object") return null;
  const page = body as LeaderboardPage;
  if (page.ranking !== "season_points" || !Array.isArray(page.rows) || !page.page || !page.source) return null;
  if (!page.rows.every(isRow)) return null;
  return page;
}

export async function fetchLeaderboard({ after = null, limit = 25, fetchImpl = fetch, enabled = HUB_LEADERBOARD_ENABLED }: { after?: string | null; limit?: number; fetchImpl?: typeof fetch; enabled?: boolean } = {}): Promise<LeaderboardPage | null> {
  if (!enabled) return null;
  const query = new URLSearchParams({ limit: String(limit) });
  if (after) query.set("after", after);
  const response = await fetchImpl(`${API_BASE}/leaderboard?${query}`, { cache: "no-store", credentials: "same-origin" });
  if (response.status === 404) return null;
  const json = (await response.json().catch(() => ({ error: "bad_response" }))) as Record<string, unknown>;
  if (!response.ok) throw new HubApiError(response.status, String(json.error ?? "request_failed"), typeof json.detail === "string" ? json.detail : undefined);
  const page = parseLeaderboard(json);
  if (!page) throw new HubApiError(500, "leaderboard_shape");
  return page;
}
