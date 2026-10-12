import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { fetchLeaderboard, parseLeaderboard, type LeaderboardPage } from "../data/leaderboard";
import { LeaderboardView } from "./Leaderboard";

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const html = (load: "loading" | "off" | "error" | "ready", board: LeaderboardPage | null = null) =>
  decode(renderToStaticMarkup(<LeaderboardView board={board} load={load} onRetry={() => {}} />));
const text = (load: "loading" | "off" | "error" | "ready", board: LeaderboardPage | null = null) =>
  html(load, board).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const board: LeaderboardPage = {
  ranking: "season_points",
  season: { number: "2", network: "devnet", open: true, twitchMarksScore: false },
  rows: [
    {
      rank: 1,
      login: "ninja",
      slug: "ninja",
      name: "ninja",
      points: "20",
      marks: { count: 1, scored: false },
      chat: { messages: 12, peakChatters: 3, source: "Data: Twitch" },
    },
  ],
  page: { limit: 25, after: null, next: null, total: 1 },
  empty: false,
  source: { points: "season credits", chat: "Data: Twitch" },
  generatedAt: 1,
};

describe("streamer board screen", () => {
  it("keeps Season 2 on Solana devnet and labels Twitch figures", () => {
    const copy = text("ready", board);
    expect(copy).toMatch(/Season 2 · Radio LAN/);
    expect(copy).toMatch(/Season 2 points are on Solana devnet/);
    expect(copy).toMatch(/the same credited actions and caps as the points board/);
    expect(copy).toMatch(/Data: Twitch/);
    expect(copy).toMatch(/unpriced/);
    expect(copy).toMatch(/Viewer counts and watch minutes score nothing/);
    expect(copy).not.toMatch(/backing is open|Backing is open|Support recorded|backers/i);
    expect(copy).not.toMatch(/Collect ·|Claim your/);
  });

  it("shows the off, empty, and error states without invented ranks", () => {
    expect(text("off")).toMatch(/This board is not on/);
    expect(text("ready", { ...board, rows: [], empty: true })).toMatch(/No channels match the current read yet/);
    expect(text("error")).toMatch(/The streamer board didn't load/);
    expect(text("ready", { ...board, rows: [], empty: true })).not.toMatch(/\b0\b points|\b1,000\b/);
  });

  it("does not invent a chat figure when the rollup is missing", () => {
    const markup = html("ready", { ...board, rows: [{ ...board.rows[0]!, chat: null, marks: { count: 0, scored: false } }] });
    expect(markup).toContain("No chat read");
    expect(markup).toContain("None");
  });
});

describe("streamer board client", () => {
  it("treats a 404 as the off flag and rejects a fabricated body", async () => {
    const skipped = await fetchLeaderboard({
      enabled: false,
      fetchImpl: async () => {
        throw new Error("leaderboard must not be fetched when the flag is off");
      },
    });
    expect(skipped).toBeNull();
    const off = await fetchLeaderboard({ enabled: true, fetchImpl: async () => new Response("{}", { status: 404 }) });
    expect(off).toBeNull();
    expect(parseLeaderboard({ ranking: "hours_watched", rows: [{ login: "x", points: "1" }] })).toBeNull();
    const page = await fetchLeaderboard({
      enabled: true,
      fetchImpl: async (url) => {
        expect(String(url)).toContain("/hub/api/leaderboard?limit=25");
        return new Response(JSON.stringify(board), { status: 200 });
      },
    });
    expect(page?.rows[0]?.login).toBe("ninja");
  });
});

describe("public lexicon on the streamer board", () => {
  it("keeps prohibited financial copy and backing-open claims out of the screen", () => {
    const body = readFileSync(new URL("./Leaderboard.tsx", import.meta.url), "utf8");
    const banned = [/\byield\b/i, /\binvest\b/i, /\bstak(e|ed|es|ing)\b/i, /\bairdrop\b/i, /\bgasless\b/i, /no dev buy/i, /\bprofit\b/i, /\$ICELAN/, /backing is open/i, /Backing is open/];
    for (const rule of banned) expect(rule.test(body), String(rule)).toBe(false);
  });
});
