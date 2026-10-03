// Copy and honesty rules for every screen, ported from the #50 prototype tests. Screens render to static markup in
// node with the sample fixtures and with today's real state.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// The repo's arena client, the reference the hub must match (plan section 2 and 6).
import { seasonIndex as refSeasonIndex, withdrawAvailableAt as refWithdrawAvailableAt } from "../../../src/sinks/arena.js";
import { backingTarget, marketFor, Ribbon, snapshotFor } from "./app/App";
import type { FlowStep, Position, PreviewState } from "./app/preview";
import { parseHash } from "./app/route";
import { ARENA_MINT, ARENA_PROGRAM } from "./chain/config";
import { seasonIndex, withdrawAvailableAt } from "./chain/season";
import { sortListings, type Market as MarketData } from "./data/market";
import { buildSample, sampleListingDetail, sampleMarket, samplePositions } from "./data/sample";
import type { Station } from "./data/station";
import { buildToday } from "./data/today";
import type { HubSnapshot } from "./data/types";
import { Back } from "./screens/Back";
import { Board } from "./screens/Board";
import { Claim } from "./screens/Claim";
import { Lan } from "./screens/Lan";
import { Listing } from "./screens/Listing";
import { Market } from "./screens/Market";
import { ACTIVITIES, Play } from "./screens/Play";
import { Profile } from "./screens/Profile";
import { Positions } from "./screens/Positions";
import { EMBED_MIN_WIDTH, twitchEmbedSrc } from "./ui/Player";

const NOW = Date.parse("2026-10-02T13:00:00Z");
const station: Station = { status: "ready", live: false };
const noop = () => {};

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (el: ReactElement) => decode(html(el).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/);

const preview = (over: Partial<PreviewState> = {}): PreviewState => ({ enabled: true, scenario: "sample", data: "ready", joined: true, position: "none", flow: "edit", fail: "cancelled", ...over });

const emptyMarket: MarketData = { network: "devnet", observedAt: null, slot: null, stale: false, generatedAt: Math.floor(NOW / 1000), listings: [] };
function screens(snapshot: HubSnapshot, p: PreviewState): Array<[string, ReactElement]> {
  const sampleScenario = p.scenario === "sample";
  const market = sampleScenario ? sampleMarket(NOW) : emptyMarket;
  const lan = sampleScenario ? sampleListingDetail(NOW, "radiolanlive")! : null;
  return [
    ["market", <Market market={market} load="ready" onRetry={noop} station={station} now={NOW} />],
    ["lan", <Lan snapshot={snapshot} load="ready" onRetry={noop} station={station} />],
    ["listing", <Listing listing={lan?.listing ?? null} observed={lan ?? market} load="ready" onRetry={noop} station={station} now={NOW} snapshot={snapshot} onJoin={noop} slug="radiolanlive" />],
    ["positions", <Positions listings={market.listings} now={NOW} wallet={null} sample={sampleScenario ? samplePositions(NOW) : null} load="ready" onRetry={noop} />],
    ["play", <Play snapshot={snapshot} load="ready" now={NOW} joined={p.joined} onJoin={noop} onRetry={noop} toast={noop} />],
    ["board", <Board snapshot={snapshot} load="ready" joined={p.joined} onRetry={noop} />],
    ["back", <Back snapshot={snapshot} load="ready" preview={p} now={NOW} onRetry={noop} />],
    ["profile", <Profile snapshot={snapshot} load="ready" backer={false} wallet={null} onRetry={noop} />],
    ["claim", <Claim snapshot={snapshot} load="ready" onRetry={noop} />],
  ];
}
const sample = buildSample(NOW);
const today = buildToday();

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?|css|html)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });

describe("copy rules (plan section 11)", () => {
  it("no yield, returns, staking or launch claims anywhere in the app source", () => {
    const banned = [/\byield/i, /\bapy\b/i, /\breturns\b/i, /\breturn on\b/i, /guarantee/i, /\binvest/i, /\bgasless\b/i, /no dev buy/i, /\bstak(e|ed|es|ing)\b/i, /earn by holding/i, /\bprofit/i, /\bairdrop/i, /0% founder/i, /staking rewards?/i];
    const files = [...sourceFiles("src"), "index.html"];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      for (const re of banned) expect(re.test(body), `${file} ${re}`).toBe(false);
    }
  });

  it("backing never promises points or odds, in any position and step", () => {
    for (const position of ["none", "active", "requested", "releasable"] as Position[]) {
      for (const flow of ["edit", "connect", "review", "signing", "done", "failed"] as FlowStep[]) {
        const all = text(<Back snapshot={sample} load="ready" preview={preview({ position, flow })} now={NOW} onRetry={noop} />);
        expect(all).toMatch(/Request withdrawal anytime\./);
        expect(all).toMatch(/Available after [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC/);
        for (const s of sentences(all).filter((x) => /\b(points?|odds|weight)\b/i.test(x))) expect(s, `${position}/${flow}`).toMatch(/\b(no|never|not)\b/i);
      }
    }
  });

  it("activities are native only, with caps, and Twitch chat never counts", () => {
    expect([...new Set(ACTIVITIES.map((a) => a.action))].sort()).toEqual(["accepted_work", "poll_response", "question"]);
    const all = text(<Play snapshot={sample} load="ready" now={NOW} joined onJoin={noop} onRetry={noop} toast={noop} />);
    expect(all).toMatch(/nothing from Twitch chat counts/);
    expect(all).toMatch(/capped per day and per season, across all activities/);
    expect(all).toMatch(/Today: 30 of 60 points · season: 230 of 300/);
    for (const a of ACTIVITIES) expect(all).toContain(`+${sample.season!.policy.weights[a.action]}`);
  });

  it("shows placeholder polls for preview without offering a points submission", () => {
    const current: HubSnapshot = {
      ...today,
      scenario: "today",
      fan: { handle: "fan-ab12cd34", since: 1 },
      season: {
        ...sample.season!,
        poll: { id: "placeholder-1", question: "Which sound opens the show?", options: ["Boom bap", "Drill"], placeholder: true },
        me: { points: 0, rank: null, streakDays: 0, today: 0, submissions: [] },
      },
    };
    const markup = html(<Play snapshot={current} load="ready" now={NOW} joined onJoin={noop} onRetry={noop} toast={noop} />);
    expect(markup).toContain("Answers here do not earn points");
    expect(markup).toContain("Preview only");
    expect(markup).toMatch(/disabled=""[^>]*>Preview only/);
  });

  it("does not mark today's poll answered when the fan answered yesterday's poll", () => {
    const season = sample.season!;
    const current: HubSnapshot = {
      ...sample,
      scenario: "today",
      season: {
        ...season,
        poll: { id: "today-poll", question: "Which city should Radio LAN spotlight?", options: ["Atlanta", "Chicago"] },
        me: { ...season.me!, submissions: [...season.me!.submissions, { action: "poll_response", status: "credited", pollId: "yesterday-poll" }] },
      },
    };
    const markup = html(<Play snapshot={current} load="ready" now={NOW} joined onJoin={noop} onRetry={noop} toast={noop} />);
    expect(markup).toContain("Which city should Radio LAN spotlight?");
    expect(markup).not.toContain("Answer counted. The next poll opens when the streamer posts one.");
  });

  it("shows live earned badges from credited play and keeps invented badges in SAMPLE only", () => {
    const live: HubSnapshot = {
      ...sample,
      scenario: "today",
      season: { ...sample.season!, me: { ...sample.season!.me!, badges: ["first_play"] } },
    };
    const markup = text(<Profile snapshot={live} load="ready" backer={false} wallet={null} onRetry={noop} />);
    expect(markup).toContain("First play");
    expect(markup).toContain("Three days played (locked)");
    expect(markup).not.toContain("First poll");
    expect(html(<Profile snapshot={sample} load="ready" backer={false} wallet={null} onRetry={noop} />)).toContain("Sample");
  });
});

describe("home load states", () => {
  it("shows the shared error block with retry when the snapshot fails", () => {
    const el = <Lan snapshot={null} load="error" station={station} onRetry={noop} />;
    const rendered = text(el);
    expect(rendered).toContain("Couldn't load");
    expect(rendered).toContain("Try again");
    expect(rendered).not.toContain("Free to play");
  });

  it("shows a skeleton while loading and no content early", () => {
    const el = <Lan snapshot={null} load="loading" station={station} onRetry={noop} />;
    const rendered = html(el);
    expect(rendered).toContain("skel");
    expect(rendered).not.toContain("Free to play");
  });
});

describe("vocabulary (plan section 11, operator 2026-10-02)", () => {
  it("leads with points and loyalty: no money words on any screen, in any state", () => {
    const money = /\b(pay|pays|paid|payout|payouts|payment|payments|earn|earns|earned|earning|money|claim|claims|claiming|claimable|pool|pools|price|prices|priced|trade|trades|trading|sell|sells|selling|stock|stocks)\b/i;
    const states = [preview(), preview({ joined: false }), preview({ scenario: "today" }), ...(["active", "requested", "releasable"] as Position[]).flatMap((position) => (["edit", "review", "done"] as FlowStep[]).map((flow) => preview({ position, flow })))];
    for (const p of states) {
      for (const [name, el] of screens(snapshotFor(p, NOW), p)) {
        const found = money.exec(text(el));
        expect(found?.[0], `${name} ${p.scenario}/${p.position}/${p.flow}`).toBeUndefined();
      }
    }
    expect(text(<Ribbon />)).not.toMatch(money);
  });
});

describe("fixtures and today's state", () => {
  it("today shows no fixture and no SAMPLE mark on any screen, in any backing step", () => {
    const fixtures = ["214", "crate_digger_07", "crate_breed", "Season 12", "Season 11", "Jayro Verse", "S7Pt", "1.25", "0.8 SOL"];
    for (const flow of ["edit", "connect", "review", "done"] as FlowStep[]) {
      for (const [name, el] of screens(today, preview({ scenario: "today", flow, position: "active" }))) {
        expect(html(el), name).not.toContain("tag--sample");
        for (const f of fixtures) expect(text(el).includes(f), `${name} shows ${f}`).toBe(false);
      }
    }
    expect(snapshotFor({ ...preview(), enabled: false }, NOW)).toEqual(today);
  });

  it("sample marks fixtures on every screen", () => {
    for (const p of [preview(), preview({ joined: false }), preview({ position: "requested", flow: "review" })]) {
      for (const [name, el] of screens(snapshotFor(p, NOW), p)) expect(html(el), name).toContain("tag--sample");
    }
  });

  it("money appears only once a season's pool is funded (plan section 4)", () => {
    const lan = sampleListingDetail(NOW, "radiolanlive")!;
    const stream = text(<Listing listing={lan.listing} observed={lan} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="radiolanlive" />);
    expect(stream).toMatch(/Your points so far/);
    expect(stream).toMatch(/Perks Not funded/);
    expect(stream).not.toMatch(/\d+(\.\d+)? (SOL|USDC)/);
    const claim = text(<Claim snapshot={sample} load="ready" onRetry={noop} />);
    expect(claim).toMatch(/3\.17%/);
    expect(claim).not.toMatch(/\d+(\.\d+)? SOL/);
    expect(html(<Claim snapshot={sample} load="ready" onRetry={noop} />)).toMatch(/<button[^>]*disabled=""[^>]*>Collect · not available yet/);
  });
});

describe("on-chain screens", () => {
  it("carry the devnet ribbon and link the program and mint", () => {
    expect(parseHash("#/back").onchain).toBe(true);
    expect(parseHash("#/back/crate-breed")).toMatchObject({ key: "back", arg: "crate-breed", onchain: true });
    for (const key of ["#/", "#/s/radiolanlive", "#/lan", "#/play", "#/board", "#/positions", "#/me", "#/claim"]) expect(parseHash(key).onchain, key).toBe(false);
    expect(text(<Ribbon />)).toMatch(/^DEVNET Test tokens with no real value\./);
    const back = html(<Back snapshot={sample} load="ready" preview={preview({ flow: "review" })} now={NOW} onRetry={noop} />);
    expect(back).toContain(`https://explorer.solana.com/address/${ARENA_PROGRAM}?cluster=devnet`);
    if (ARENA_MINT) expect(back).toContain(`https://explorer.solana.com/address/${ARENA_MINT}?cluster=devnet`);
    else expect(decode(back)).toMatch(/Test mint <span class="addr"><span class="mono">Mint…1111<\/span><span class="tag tag--sample">Sample/);
    expect(decode(back)).toMatch(/Account rent<\/dt><dd>0\.003654 SOL, returned when you withdraw everything/);
    // The review card already carries network, program, token and unlock: no second "On chain" copy beside it.
    expect(decode(back).match(/<dt>Network<\/dt>/g)?.length).toBe(1);
    expect(decode(back)).not.toContain("The radiolan-arena program has been live on mainnet");
    const amountStep = html(<Back snapshot={sample} load="ready" preview={preview({ flow: "edit" })} now={NOW} onRetry={noop} />);
    expect(decode(amountStep)).toContain("The radiolan-arena program has been live on mainnet since 2 Oct 2026. No arena is open on mainnet yet, so this flow uses devnet.");
    // The unlock rule is a subtitle under the action, not the page's loudest line; the review's way back says what it does.
    expect(back).toMatch(/<p class="rule-sub">Request withdrawal anytime\. Available after/);
    expect(back).not.toContain('class="rule"');
    expect(back).toMatch(/<button class="btn btn--ghost" type="button">Edit amount<\/button>/);
  });

  it("show no release date while no arena exists", () => {
    const back = text(<Back snapshot={today} load="ready" preview={preview({ scenario: "today" })} now={NOW} onRetry={noop} />);
    expect(back).toMatch(/No arena is open yet, so there is no date to show/);
    expect(back).not.toMatch(/Available after [A-Z][a-z]{2} \d/);
  });

  it("release dates follow the arena program's schedule, as src/sinks/arena.js computes it", () => {
    for (const seconds of [60n, 604_800n, 2_419_200n]) {
      const start = 1_790_985_600n;
      for (const now of [start - 1n, start, start + seconds - 1n, start + seconds, start + 10n * seconds + 5n]) {
        expect(seasonIndex(start, seconds, now)).toBe(refSeasonIndex(start, seconds, now));
      }
      for (const r of [0n, 1n, 12n]) expect(withdrawAvailableAt(start, seconds, r)).toBe(refWithdrawAvailableAt(start, seconds, r));
    }
  });
});

describe("Twitch embed (plan section 10)", () => {
  it("waits for a tap, needs 400 x 300, and links out on narrow screens", () => {
    const lan = sampleListingDetail(NOW, "radiolanlive")!;
    const stream = html(<Listing listing={lan.listing} observed={lan} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="radiolanlive" />);
    expect(stream).not.toContain("<iframe");
    expect(stream).toContain('href="https://www.twitch.tv/radiolanlive"');
    expect(stream).toContain("Play here");
    expect(EMBED_MIN_WIDTH).toBe(400);
    expect(twitchEmbedSrc("twzrd.xyz")).toBe("https://player.twitch.tv/?channel=radiolanlive&parent=twzrd.xyz&autoplay=true");
    expect(twitchEmbedSrc("twzrd.xyz", "ninja")).toBe("https://player.twitch.tv/?channel=ninja&parent=twzrd.xyz&autoplay=true");
    const css = readFileSync("src/styles/hub.css", "utf8");
    expect(css).toMatch(/\.player--live \{ min-height: 300px; \}/);
    expect(css).toMatch(/@container \(min-width: 400px\) \{ \.player__embed \{ display: inline-flex; \}/);
  });
});

describe("the Board (multi-streamer path, Stage 1)", () => {
  const market = sampleMarket(NOW);
  const board = text(<Market market={market} load="ready" onRetry={noop} station={station} now={NOW} />);
  const boardHtml = html(<Market market={market} load="ready" onRetry={noop} station={station} now={NOW} />);

  it("orders backable listings first by backing, then live channels by viewers", () => {
    expect(sortListings(market.listings).map((l) => l.slug)).toEqual(["radiolanlive", "crate-breed", "dusty-rhymes", "ninja", "xqc"]);
    expect(sortListings([...market.listings].reverse()).map((l) => l.slug)).toEqual(["radiolanlive", "crate-breed", "dusty-rhymes", "ninja", "xqc"]);
  });

  it("shows backing and Twitch figures as separate cells, each labelled, and never a price", () => {
    // The featured listing shows once, in its card; the backable group is ranked; Twitch-only rows are collapsed below.
    expect(board).toMatch(/Radio LAN Featured .*12,400 RLAN 37 backers · 2 leaving \+850 this season/);
    expect(boardHtml).not.toMatch(/mkt__name">Radio LAN/);
    expect(board).toMatch(/Backing open · 2 1 Crate Breed Demo .*2 Dusty Rhymes Demo/);
    expect(board).toMatch(/On Twitch, not listed yet · 2 channels, 1 live/);
    expect(boardHtml).toMatch(/<details class="mkt__more">/);
    expect(board).toMatch(/ninja .*Backing Not listed for backing Twitch Live · 18,240 Fortnite Data: Twitch/);
    expect(board).not.toMatch(/Crate Breed Demo [^]*?Twitch No Twitch/);
    expect(boardHtml).not.toContain('class="mkt__rank num" aria-label="Backing rank 3"');
    expect(board).toMatch(/Read from Solana devnet 1 min ago\./);
    expect(boardHtml).toMatch(/title="[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC · slot 500,400 · Solana devnet"/);
    expect(board).toMatch(/Backing adds no points\. How this works/);
    expect(boardHtml).toContain('href="#/how"');
    expect(boardHtml).toContain('title="Data: Twitch. Recorded by radiolanlive at ');
    expect(boardHtml.match(/>Demo</g)?.length).toBe(2);
    expect(boardHtml).toContain(">Featured<");
  });

  it("renders the stale state and an empty live board without inventing anything", () => {
    const stale = text(<Market market={{ ...market, stale: true }} load="ready" onRetry={noop} station={station} now={NOW} />);
    expect(stale).toMatch(/The station has not refreshed it since\. Refresh/);
    expect(marketFor({ ...preview({ scenario: "today" }), enabled: false }, NOW, null)).toBeNull();
    const empty = text(<Market market={{ network: "devnet", observedAt: null, slot: null, stale: false, generatedAt: 1, listings: [] }} load="ready" onRetry={noop} station={station} now={NOW} />);
    expect(empty).toMatch(/Solana devnet: no read yet/);
    expect(empty).toMatch(/Backing open · 0 No creator has an arena open for backing yet/);
    expect(empty).not.toContain("Sample");
  });

  it("keeps the listing's two panels apart: backing is on chain, the channel is Twitch, points are free", () => {
    const demo = sampleListingDetail(NOW, "crate-breed")!;
    const page = text(<Listing listing={demo.listing} observed={demo} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="crate-breed" />);
    expect(page).toMatch(/Demo listing · fictional/);
    expect(page).toMatch(/Backing On chain .*Backed, RLAN 4,210 −300 this season Backers 19 Wallets, not people Leaving 0 Withdrawal requests/);
    expect(page).not.toMatch(/Channel Data: Twitch/);
    expect(page).not.toMatch(/Your points so far/);
    expect(page).toContain("Back Crate Breed");
    const tracked = sampleListingDetail(NOW, "ninja")!;
    const other = text(<Listing listing={tracked.listing} observed={tracked} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="ninja" />);
    expect(other).toMatch(/Not listed for backing yet\. A creator is backable only after they create their own arena with their own key/);
    expect(other).toMatch(/Viewers 18,240 \+120 since last read Playing Fortnite/);
    expect(other).toMatch(/Data: Twitch\. Recorded by radiolanlive at \S+\./);
    const lan = sampleListingDetail(NOW, "radiolanlive")!;
    const featured = text(<Listing listing={lan.listing} observed={lan} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="radiolanlive" />);
    expect(featured).toMatch(/Season · points Free · separate from backing/);
    expect(featured).toMatch(/Points come from activities on this site and never from backing or Twitch/);
  });

  it("lists a wallet's positions with the arena's release rule, totals them, and points to the free season elsewhere", () => {
    const page = text(<Positions listings={market.listings} now={NOW} wallet={null} sample={samplePositions(NOW)} load="ready" onRetry={noop} />);
    expect(page).toMatch(/Radio LAN.*Active\. Withdraw by requesting it\. 250 RLAN Active/);
    expect(page).toMatch(/Crate Breed.*Withdrawal requested; available after [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC, in .* 100 RLAN Requested/);
    expect(page).toMatch(/Committed, all listings 350 RLAN 2 positions/);
    expect(page).toMatch(/Season points are free and separate: backing never adds points/);
    const empty = text(<Positions listings={[]} now={NOW} wallet={null} sample={{ ...samplePositions(NOW), positions: [] }} load="ready" onRetry={noop} />);
    expect(empty).toMatch(/No positions/);
  });

  it("points a backing screen at the listing's own pair, with the build mint only as the featured fallback", () => {
    const lan = market.listings[0]!;
    expect(backingTarget(lan, null)).toEqual(lan.keys);
    expect(backingTarget({ ...lan, keys: null }, "Mint7estRLAN1111111111111111111111111111111")).toEqual({ streamer: "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb", mint: "Mint7estRLAN1111111111111111111111111111111" });
    expect(backingTarget({ ...market.listings[3]!, keys: null }, "Mint7estRLAN1111111111111111111111111111111")).toBeNull();
    expect(backingTarget(null, "Mint7estRLAN1111111111111111111111111111111")).toBeNull();
  });
});
