import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { HubApiError } from "../data/api";
import { fetchFanBoard, parseFanBoard, type FanBoard, type FanBoardEntry } from "../data/fan-board";
import { askErrorText, FanBoardView, lanesOf, rowsOf, type AskState, type LaneKey } from "./FanBoard";

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const html = (load: "loading" | "off" | "error" | "ready", board: FanBoard | null = null, lane: LaneKey = "backable", asks: Record<string, AskState> = {}) =>
  decode(renderToStaticMarkup(<FanBoardView board={board} load={load} lane={lane} asks={asks} onAsk={() => {}} onRetry={() => {}} />));
const text = (...args: Parameters<typeof html>) => html(...args).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const live = (viewers: number, game: string) => ({ source: "Data: Twitch", live: true, viewers, game });
const entries: FanBoardEntry[] = [
  { twitch: "kaicenat", slug: "kaicenat", name: "kaicenat", kind: "tracked", market: { address: "A", total: "200000000000", backers: "3", decimals: 6, closed: false }, asks: 0, performance: { source: "Data: Twitch", live: false, viewers: null, game: null } },
  { twitch: "radiolanlive", slug: "radiolanlive", name: "Radio LAN", kind: "featured", market: { address: "B", total: "85527609857", backers: "1", decimals: 6, closed: false }, asks: 0, performance: null },
  { twitch: "pixelpainter", slug: null, name: "PixelPainter", kind: "discovered", market: null, asks: 5, ready: true, performance: live(140, "Art") },
  { twitch: "tinycreator", slug: null, name: "Tiny", kind: "discovered", market: null, asks: 2, ready: false, performance: live(40, "Chess") },
  { twitch: "zebrachess", slug: null, name: "ZebraChess", kind: "discovered", market: null, asks: 0, ready: false, performance: live(1_900, "Chess") },
  { twitch: "ninja", slug: "ninja", name: "ninja", kind: "tracked", market: null, asks: 0, ready: false, performance: { source: "Data: Twitch", live: false, viewers: null, game: null } },
  { twitch: "artbig", slug: null, name: "ArtBig", kind: "discovered", market: null, asks: 0, ready: false, performance: live(1_500, "Art") },
  { twitch: "artsmall", slug: null, name: "ArtSmall", kind: "discovered", market: null, asks: 0, ready: false, performance: live(30, "Art") },
];
const board: FanBoard = {
  rankedBy: "rlan_backed",
  askThreshold: 5,
  queue: [{ twitch: "pixelpainter", asks: 5 }],
  network: "mainnet",
  generatedAt: 1,
  summary: { creators: 8, markets: 2, backers: 4, ready: 1, askedCreators: 2, asks: 7, discoveredAt: "2026-10-12T07:00:00.000Z" },
  entries,
};

describe("fan board lanes", () => {
  it("orders lanes Backable, Asked, Big channels, then categories by creator count, never by viewers", () => {
    expect(lanesOf(entries).map((l) => [l.label, l.count, l.ranked])).toEqual([
      ["Backable", 2, true], ["Asked", 2, true], ["Big channels", 1, false], ["Art", 3, false], ["Chess", 2, false],
    ]);
  });

  it("keeps the station order in ranked lanes and sorts the rest by name", () => {
    expect(rowsOf(entries, "backable").map((e) => e.twitch)).toEqual(["kaicenat", "radiolanlive"]);
    expect(rowsOf(entries, "asked").map((e) => e.twitch)).toEqual(["pixelpainter", "tinycreator"]);
    expect(rowsOf(entries, "game:Art").map((e) => e.name)).toEqual(["ArtBig", "ArtSmall", "PixelPainter"]);
    expect(rowsOf(entries, "game:Chess").map((e) => e.name), "1,900 watching does not jump ahead of 40").toEqual(["Tiny", "ZebraChess"]);
  });
});

describe("fan board screen", () => {
  it("opens on Backable: ranked rows, backing, Back links, no Twitch label when nothing Twitch is shown", () => {
    const page = html("ready", board);
    const copy = text("ready", board);
    expect(copy).toMatch(/Fan board/);
    expect(copy).toMatch(/at 5 asks/);
    expect(copy).toMatch(/2 markets · 1 in line · 7 asks · 8 creators/);
    expect(copy).toMatch(/Backable · ranked by \$RLAN backed/);
    expect(copy).toMatch(/Pick a lane above and ask for their market/);
    expect(copy).toMatch(/200\.0K \$RLAN · 3 backers/);
    expect(copy).toMatch(/85\.5K \$RLAN · 1 backer/);
    expect(page).toMatch(/href="#\/back\/kaicenat"/);
    expect(page).toMatch(/class="fan-rank num">1</);
    expect(copy).not.toMatch(/Data: Twitch/);
    expect(copy, "no eyebrow repeating the brand").not.toMatch(/Radio LAN Fan board/);
  });

  it("shows ask progress wherever a creator has asks, and labels Twitch once per lane", () => {
    const asked = text("ready", board, "asked");
    expect(asked).toMatch(/In line for a market · 5 asks · 140 watching · Art/);
    expect(asked).toMatch(/2 of 5 asks · 40 watching · Chess/);
    expect(asked.match(/Data: Twitch/g)?.length).toBe(1);
    const chess = text("ready", board, "game:Chess");
    expect(chess).toMatch(/Chess · no market yet · by name · Data: Twitch/);
    expect(chess).toMatch(/2 of 5 asks · 40 watching/);
    expect(chess).toMatch(/ZebraChess 1,900 watching/);
    expect(chess).not.toMatch(/0 of 5/);
    expect(html("ready", board, "game:Chess"), "lanes by name carry no rank numbers").not.toMatch(/fan-rank/);
  });

  it("says Offline for a big channel that is offline, not 'not read'", () => {
    const big = text("ready", board, "big");
    expect(big).toMatch(/ninja Offline/);
    expect(big).not.toMatch(/not read/);
  });

  it("uses short Ask buttons with full labels for screen readers", () => {
    const page = html("ready", board, "game:Art");
    expect(page).toMatch(/aria-label="Ask for a market for ArtBig"/);
    expect(text("ready", board, "game:Art")).toMatch(/ArtBig 1,500 watching Ask/);
  });

  it("uses no vote, stake, yield or earn wording", () => {
    for (const lane of ["backable", "asked", "big", "game:Art"] as const) {
      expect(text("ready", board, lane).toLowerCase()).not.toMatch(/\bvot(e|es|ing)\b|\bstak(e|ed|ing)\b|\byield\b|\bearn|\binvest|\bapy\b|\bprofit/);
    }
    for (const load of ["off", "error"] as const) expect(text(load).toLowerCase()).not.toMatch(/\bvote|\bstake|\bearn/);
  });

  it("shows ask states and plain errors", () => {
    expect(text("ready", board, "game:Art", { artbig: { status: "sending" } })).toMatch(/Asking…/);
    expect(text("ready", board, "game:Art", { artbig: { status: "done", already: true } })).toMatch(/Already asked/);
    expect(askErrorText(new HubApiError(401, "sign_in_required"))).toBe("Sign in to ask.");
    expect(askErrorText(new HubApiError(429, "daily_ask_limit"))).toMatch(/today's 10 asks/);
    expect(askErrorText(new HubApiError(409, "market_already_open"))).toMatch(/already has a market/);
  });

  it("has off, error and loading states", () => {
    expect(text("off")).toMatch(/not published on this hub yet/);
    expect(text("error")).toMatch(/didn't load/);
    expect(text("loading")).toMatch(/Fan board/);
  });
});

describe("fan board data", () => {
  it("rejects a board that is not ranked by backing, lacks a threshold, or has a bad row", () => {
    expect(parseFanBoard(board)).not.toBeNull();
    expect(parseFanBoard({ ...board, rankedBy: "viewers" })).toBeNull();
    expect(parseFanBoard({ ...board, askThreshold: 0 })).toBeNull();
    expect(parseFanBoard({ ...board, entries: [{ ...entries[0]!, market: { ...entries[0]!.market!, total: "-1" } }] })).toBeNull();
    expect(parseFanBoard({ ...board, entries: [{ ...entries[2]!, twitch: "Bad Login" }] })).toBeNull();
  });

  it("does not fetch while the flag is off and treats a 404 as off", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return new Response("{}", { status: 404 }); }) as unknown as typeof fetch;
    expect(await fetchFanBoard({ enabled: false, fetchImpl })).toBeNull();
    expect(calls).toBe(0);
    expect(await fetchFanBoard({ enabled: true, fetchImpl })).toBeNull();
    expect(calls).toBe(1);
  });
});
