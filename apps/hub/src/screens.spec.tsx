// Copy and honesty rules for every screen, ported from the #50 prototype tests. Screens render to static markup in
// node with the sample fixtures and with today's real state.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// The repo's arena client, the reference the hub must match (plan section 2 and 6).
import { seasonIndex as refSeasonIndex, withdrawAvailableAt as refWithdrawAvailableAt } from "../../../src/sinks/arena.js";
import { backingTarget, canSetUp, marketFor, PRIMARY_NAV, Ribbon, SampleBanner, snapshotFor } from "./app/App";
import type { FlowStep, Position, PreviewState } from "./app/preview";
import { parseHash } from "./app/route";
import { ARENA_MINT, ARENA_PROGRAM } from "./chain/config";
import { seasonIndex, withdrawAvailableAt } from "./chain/season";
import { sortListings, type Listing as ListingData, type Market as MarketData } from "./data/market";
import { buildSample, sampleListingDetail, sampleMarket, samplePositions } from "./data/sample";
import type { Station } from "./data/station";
import { buildToday } from "./data/today";
import type { HubSnapshot } from "./data/types";
import { fmt } from "./lib/format";
import { Back } from "./screens/Back";
import { LiveBack } from "./screens/LiveBack";
import { Board } from "./screens/Board";
import { Circle } from "./screens/Circle";
import { Claim } from "./screens/Claim";
import { COMMUNITY_COPY, gatedCommunityCatalog, sampleCommunityCatalog } from "./data/community";
import { Communities } from "./screens/Communities";
import { Lan } from "./screens/Lan";
import { Listing } from "./screens/Listing";
import { lockerIsOpen, lockerStatus, Market } from "./screens/Market";
import { ACTIVITIES, Play } from "./screens/Play";
import { Profile } from "./screens/Profile";
import { Positions } from "./screens/Positions";
import { StatsView } from "./screens/Stats";
import { YourPageView } from "./ui/YourPage";
import { EMBED_MIN_WIDTH, twitchEmbedSrc } from "./ui/Player";

const NOW = Date.parse("2026-10-02T13:00:00Z");
const station: Station = { status: "ready", live: false, observedAt: NOW };
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
    ["circle", <Circle snapshot={snapshot} load="ready" listings={market.listings} followed={sampleScenario ? ["radiolanlive", "crate-breed", "dusty-rhymes"] : []} selected="" onRetry={noop} />],
    ["back", <Back snapshot={snapshot} load="ready" preview={p} now={NOW} onRetry={noop} />],
    ["profile", <Profile snapshot={snapshot} load="ready" backer={false} wallet={null} onRetry={noop} />],
    ["claim", <Claim snapshot={snapshot} load="ready" onRetry={noop} />],
    ["communities", <Communities snapshot={snapshot} catalog={sampleScenario ? sampleCommunityCatalog(NOW) : gatedCommunityCatalog()} />],
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
    expect(all).toMatch(/This season is the game you are inside/);
    expect(all).toMatch(/Today's points sit against the published cap/);
    expect(all).toMatch(/The next action can light a collected mark/);
    expect(all).toMatch(/Today: 30 of 60 points · season: 230 of 300/);
    for (const a of ACTIVITIES) expect(all).toContain(`+${sample.season!.policy.weights[a.action]}`);
    expect(all).toContain("Show up. Take part. Keep your mark.");
    expect(all).toContain("Prompt replies and clips count only after the streamer accepts them.");
    expect(all).toContain(`Season ${sample.season!.number} · ${fmt(sample.season!.players)} players on the board`);
    expect(all).toMatch(/Meet superfans/);
    expect(all).toContain("Real Discord or X membership can unlock season-points eligibility");
  });

  it("puts the SAMPLE marker on the challenge primer before sample activity cards", () => {
    const page = html(<Play snapshot={sample} load="ready" now={NOW} joined onJoin={noop} onRetry={noop} toast={noop} />);
    expect(page.indexOf("h-challenge-brief")).toBeLessThan(page.indexOf("tag--sample"));
    expect(page).toContain("no wallet needed.");
    expect(page).toContain("the streamer accepts them");
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
    expect(markup).toContain("Season 12 · Radio LAN");
    expect(markup).not.toContain("tag--sample");
    expect(markup).not.toContain("This points season is a sample");
    expect(markup).toContain("Ask the guest or the room a question.");
    const emptyBoard: HubSnapshot = { ...current, season: { ...current.season!, players: 0, board: [] } };
    const board = html(<Board snapshot={emptyBoard} load="ready" joined onRetry={noop} />);
    expect(board).toContain("Season 12 · Radio LAN");
    expect(board).not.toContain("tag--sample");
    expect(board).toContain("Your points so far: 0");
    expect(markup).not.toContain("Solana devnet");
    expect(board).not.toContain("Solana devnet");
  });

  it("labels the live season 2 points pages as Solana devnet and leaves other seasons unlabeled", () => {
    const live = (number: number): HubSnapshot => ({
      ...today,
      scenario: "today",
      season: {
        ...sample.season!,
        number,
        poll: { id: "live-poll", question: "Which city should Radio LAN spotlight?", options: ["Atlanta", "Chicago"] },
        me: null,
        board: [],
        players: 0,
      },
    });
    const season2 = live(2);
    const play2 = html(<Play snapshot={season2} load="ready" now={NOW} joined={false} onJoin={noop} onRetry={noop} toast={noop} />);
    const board2 = html(<Board snapshot={season2} load="ready" joined={false} onRetry={noop} />);
    for (const page of [play2, board2]) {
      expect(page).toContain("Season 2");
      expect(page).toContain("Solana devnet");
      expect(page).not.toContain("Season 2 · Radio LAN");
      expect(page).toContain("Season 2 · Solana devnet · Radio LAN");
    }
    const season4 = live(4);
    const play4 = html(<Play snapshot={season4} load="ready" now={NOW} joined={false} onJoin={noop} onRetry={noop} toast={noop} />);
    const board4 = html(<Board snapshot={season4} load="ready" joined={false} onRetry={noop} />);
    expect(play4).toContain("Season 4 · Radio LAN");
    expect(board4).toContain("Season 4 · Radio LAN");
    expect(play4).not.toContain("Solana devnet");
    expect(board4).not.toContain("Solana devnet");
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
      fan: { handle: "fan-ab12cd34", since: 1, badges: ["first_play"], activityDays: 1, playedToday: true },
      season: { ...sample.season!, me: { ...sample.season!.me!, badges: ["first_play"], activityDays: 1, playedToday: true } },
    };
    const markup = text(<Profile snapshot={live} load="ready" backer={false} wallet={null} onRetry={noop} />);
    expect(markup).toContain("First play");
    expect(markup).toContain("Three days played (locked)");
    expect(markup).not.toContain("First poll");
    expect(html(<Profile snapshot={live} load="ready" backer={false} wallet={null} onRetry={noop} />)).not.toContain("who__avatar");
    const samplePage = html(<Profile snapshot={sample} load="ready" backer={false} wallet={null} onRetry={noop} />);
    expect(samplePage).toContain("Sample");
    expect(samplePage).toContain("First play");
    expect(samplePage).toContain("Three days played");
    expect(samplePage).not.toContain("who__avatar");
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
        // Collector marks may be called earned badges (operator, hub room objective).
        const found = money.exec(text(el).replace(/(?:No )?earned badges(?: yet)?/gi, "collected marks"));
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
    for (const key of ["#/", "#/s/radiolanlive", "#/lan", "#/play", "#/board", "#/circle", "#/communities", "#/positions", "#/me", "#/claim"]) expect(parseHash(key).onchain, key).toBe(false);
    expect(text(<Ribbon />)).toMatch(/^Solana devnet Test tokens only\. No real value\./);
    const back = html(<Back snapshot={sample} load="ready" preview={preview({ flow: "review" })} now={NOW} onRetry={noop} />);
    expect(back).toContain(`https://explorer.solana.com/address/${ARENA_PROGRAM}?cluster=devnet`);
    if (ARENA_MINT) expect(back).toContain(`https://explorer.solana.com/address/${ARENA_MINT}?cluster=devnet`);
    else expect(decode(back)).toMatch(/Token address<\/dt><dd><span class="addr"><span class="mono">Mint…1111<\/span><span class="tag tag--sample">Sample/);
    expect(decode(back)).toMatch(/Account deposit \(returned when you withdraw\)<\/dt><dd>0\.003654 SOL, returned when you withdraw everything/);
    expect(decode(back)).toMatch(/Less than half a cent/);
    expect(decode(back)).toContain("0.000005 SOL");
    // The review card already carries network, program, token and unlock: no second "On chain" copy beside it.
    expect(decode(back).match(/<dt>Network<\/dt>/g)?.length).toBe(1);
    expect(decode(back)).not.toContain("The radiolan-arena program has been live on mainnet");
    const amountStep = html(<Back snapshot={sample} load="ready" preview={preview({ flow: "edit" })} now={NOW} onRetry={noop} />);
    expect(decode(amountStep)).toContain("The radiolan-arena program has been live on mainnet since 2 Oct 2026. This build rehearses on devnet with test tokens.");
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

  it("keeps an unread schedule unknown while loading or after a read error", () => {
    const loading = text(<Back snapshot={today} load="loading" preview={preview({ scenario: "today" })} now={NOW} onRetry={noop} />);
    const failed = text(<Back snapshot={null} load="error" preview={preview({ scenario: "today" })} now={NOW} onRetry={noop} />);
    const liveLoading = text(<LiveBack target={null} slug="radiolanlive" name="Radio LAN" allowSetup={false} ready={false} />);
    const boardError = text(<LiveBack target={null} slug="radiolanlive" name="Radio LAN" allowSetup={false} ready boardError />);
    for (const page of [loading, failed, liveLoading, boardError]) {
      expect(page).toContain("The withdrawal date appears after this listing's on-chain schedule is read.");
      expect(page).not.toContain("No arena is open yet");
    }
    expect(boardError).toContain("this listing's arena is unknown");
  });

  it("retains the on-chain closed-arena simulation error 6304 copy", () => {
    const back = text(<Back snapshot={sample} load="ready" preview={preview({ flow: "failed", fail: "simulation" })} now={NOW} onRetry={noop} />);
    expect(back).toContain("The arena is closed to new backing (error 6304).");
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
    expect(board).toMatch(/Open lockers · 2 1 Crate Breed Fictional creator .*2 Dusty Rhymes Fictional creator/);
    expect(board).toMatch(/On Twitch, not listed yet · 2 channels, 1 live/);
    expect(boardHtml).toMatch(/<details class="mkt__more">/);
    expect(board).toMatch(/ninja .*Locker Closed · no listed market is open Twitch Live · 18,240 Fortnite Data: Twitch/);
    expect(board).not.toMatch(/Crate Breed Demo [^]*?Twitch No Twitch/);
    expect(boardHtml).not.toContain('class="mkt__rank num" aria-label="Backing rank 3"');
    expect(board).toMatch(/Read from Solana devnet 1 min ago\./);
    expect(boardHtml).toMatch(/title="[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC · slot 500,400 · Solana devnet"/);
    expect(board).toMatch(/A backing locker is your own position and comes back 1:1/);
    expect(board).toMatch(/It stays closed until a listed market is open/);
    expect(board).toMatch(/Backing adds no points\. How this works/);
    expect(boardHtml).toContain('href="#/how"');
    expect(boardHtml).toContain('title="Data: Twitch. Recorded by radiolanlive at ');
    expect(boardHtml.match(/>Fictional creator</g)?.length).toBe(2);
    expect(boardHtml).toContain(">Featured<");
  });

  it("shows a real locker only from a fresh, matching open arena read", () => {
    const source = market.listings[0]!;
    const realOpen: ListingData = { ...source, kind: "tracked", demo: false };
    const current: MarketData = { ...market, sample: undefined, stale: false, listings: [realOpen] };
    expect(lockerStatus(realOpen, current)).toBe("open");
    expect(lockerIsOpen(realOpen, current)).toBe(true);
    const page = html(<Market market={current} load="ready" onRetry={noop} station={station} now={NOW} />);
    expect(decode(page)).toContain("Open lockers · 1");
    expect(page).not.toContain('tag--sample');
  });

  it("keeps a closed arena and a listing with no arena closed on a fresh read", () => {
    const current: MarketData = { ...market, sample: undefined, stale: false };
    const hasClosedArena = { ...market.listings[0]!, backingOpen: false, arena: { ...market.listings[0]!.arena!, closed: true } };
    const noArena = market.listings.find((l) => l.slug === "ninja")!;
    expect(lockerStatus(hasClosedArena, current)).toBe("closed");
    expect(lockerStatus(noArena, current)).toBe("closed");
    const page = text(<Market market={{ ...current, listings: [noArena] }} load="ready" onRetry={noop} station={station} now={NOW} />);
    expect(page).toContain("Closed · no listed market is open");
  });

  it("does not trust a bare or contradictory backingOpen flag", () => {
    const current: MarketData = { ...market, sample: undefined, stale: false };
    const source = market.listings.find((l) => l.slug === "ninja")!;
    const bareFlag = { ...source, backingOpen: true };
    const contradictory = { ...market.listings[0]!, arena: { ...market.listings[0]!.arena!, closed: true } };
    const wrongPair = { ...market.listings[0]!, keys: { streamer: source.keys?.streamer ?? "11111111111111111111111111111111", mint: "So11111111111111111111111111111111111111112" } };
    expect(lockerStatus(bareFlag, current)).toBe("unavailable");
    expect(lockerStatus(contradictory, current)).toBe("unavailable");
    expect(lockerStatus(wrongPair, current)).toBe("unavailable");
  });

  it("does not present a stale or missing arena read as closed or open", () => {
    const source = market.listings[0]!;
    const realOpen: ListingData = { ...source, kind: "tracked", demo: false };
    const stale: MarketData = { ...market, sample: undefined, stale: true, listings: [realOpen] };
    const missing: MarketData = { ...stale, stale: false, observedAt: null };
    expect(lockerStatus(realOpen, stale)).toBe("stale");
    expect(lockerStatus(realOpen, missing)).toBe("unavailable");
    const stalePage = text(<Market market={stale} load="ready" onRetry={noop} station={station} now={NOW} />);
    const missingPage = text(<Market market={missing} load="ready" onRetry={noop} station={station} now={NOW} />);
    expect(stalePage).toContain("Locker status unavailable · last read is stale");
    expect(stalePage).not.toContain("Open lockers · 1");
    expect(missingPage).toContain("Locker status unavailable · no current read");
    expect(missingPage).not.toContain("Open lockers · 1");
  });

  it("keeps sample open lockers marked as sample fixtures", () => {
    const page = html(<Market market={market} load="ready" onRetry={noop} station={station} now={NOW} />);
    expect(lockerStatus(market.listings[0]!, market)).toBe("open");
    expect(page).toContain("tag--sample");
    expect(decode(page)).toContain("Fictional creators and backing for preview. No live locker is opened here.");
  });

  it("presents creator fees, RLAN, and the closed ICELAN vault as separate states", () => {
    expect(board).toContain("Creator fee terms are managed by ClawPump");
    expect(board).toContain("fee collection and release stay outside this interface");
    expect(board).not.toContain("75%");
    expect(board).not.toContain("25%");
    expect(board).toContain("Holder controls are not live in this hub");
    expect(boardHtml).toContain('href="https://clawpump.tech/tokens/CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy"');
    expect(board).toContain("Vault not created");
    expect(board).toContain("Collect stays disabled");
    expect(board).toContain("Season points stay free and separate");
    expect(board).not.toMatch(/ICELAN.{0,100}(?:open|available to collect)/i);
  });

  it("renders the stale state and an empty live board without inventing anything", () => {
    const stale = text(<Market market={{ ...market, stale: true }} load="ready" onRetry={noop} station={station} now={NOW} />);
    expect(stale).toMatch(/The station has not refreshed it since\. Refresh/);
    expect(marketFor({ ...preview({ scenario: "today" }), enabled: false }, NOW, null)).toBeNull();
    const empty = text(<Market market={{ network: "devnet", observedAt: null, slot: null, stale: false, generatedAt: 1, listings: [] }} load="ready" onRetry={noop} station={station} now={NOW} />);
    expect(empty).toMatch(/Solana devnet: no read yet/);
    expect(empty).toMatch(/No channels match the current read yet\./);
    expect(empty).not.toMatch(/Creators list themselves/);
    expect(empty).not.toContain("Sample");
  });

  it("says plainly whether the streamer has joined a listing, and never implies they were paid", () => {
    const tracked = sampleListingDetail(NOW, "ninja")!;
    const page = (claimed: boolean) => text(<Listing listing={{ ...tracked.listing, claimed }} observed={tracked} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="ninja" />);
    expect(page(false)).toContain("The streamer hasn't joined yet.");
    expect(page(false)).toContain("never goes to them");
    expect(page(true)).toContain("Streamer joined: they signed in with Twitch");
    expect(page(true)).not.toContain("hasn't joined");
  });

  it("offers category lanes and a collection meter on a full board, with no money words", () => {
    const mk = (slug: string, game: string, live = true) => ({ slug, name: slug, kind: "tracked" as const, demo: false, blurb: null, twitch: slug, keys: null, backingOpen: false, arena: null, performance: { live, viewers: live ? 100 : null, game, startedAt: null, rank: null, deltaViewers: null, provenance: "Data: Twitch. Recorded by Radio LAN." } });
    const full: MarketData = { ...emptyMarket, listings: [mk("aa", "Just Chatting"), mk("bb", "Just Chatting"), mk("cc", "Minecraft"), mk("dd", "Minecraft"), mk("ee", "Fortnite"), mk("ff", "Fortnite", false)] };
    const page = text(<Market market={full} load="ready" onRetry={noop} station={station} now={NOW} />);
    expect(page).toContain("Collect today's channels");
    expect(page).toContain("0 of 6 followed");
    expect(page).toContain("3 more to be a Scout");
    expect(page).toContain("All categories");
    expect(page).toMatch(/Just Chatting 2/);
    expect(page).toContain("add no points");
    expect(page).not.toMatch(/\b(pay|payout|earn|earned|money|price|pool|claim)\b/i);
    const small = text(<Market market={{ ...emptyMarket, listings: full.listings.slice(0, 2) }} load="ready" onRetry={noop} station={station} now={NOW} />);
    expect(small).not.toContain("Collect today's channels");
    expect(small).not.toContain("All categories");
  });

  it("draws a week of daily peaks on a channel that has them, with a text alternative, and nothing when it has none", () => {
    const tracked = sampleListingDetail(NOW, "ninja")!;
    const withWeek = { ...tracked.listing, performance: { live: true, viewers: 100, game: "Fortnite", startedAt: null, rank: 1, deltaViewers: null, week: [null, 120, null, 300, 80, null, 450], provenance: "Data: Twitch. Recorded by Radio LAN." } };
    const page = html(<Listing listing={withWeek} observed={tracked} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="ninja" />);
    expect(decode(page)).toContain("This week · daily peak audience");
    expect(decode(page)).toMatch(/aria-label="Daily peak audience, last 7 days: \w{3} no reading, \w{3} 120/);
    expect((page.match(/class="week__bar"/g) ?? []).length).toBe(7);
    const none = html(<Listing listing={{ ...withWeek, performance: { ...withWeek.performance, week: [null, null, null, null, null, null, null] } }} observed={tracked} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="ninja" />);
    expect(none).not.toContain("week__bars");
  });

  it("shows the stats page's free preview with its source, and a clear empty and error state", () => {
    const preview = { source: "Data: Twitch. Radio LAN analytics. Observed top channels only; small channels are not covered.", coverage: { firstSampleAt: 1, lastSampleAt: Math.floor(NOW / 1000), polls: 12, avgChannelsPerPoll: 274, retentionDays: 400 }, generatedAt: Math.floor(NOW / 1000), data: { window: { days: 1 }, channels: [{ rank: 1, login: "caseoh_", name: "CaseOh", game: "Just Chatting", language: "en", peakViewers: 87481, averageViewers: 50000, hoursWatched: 1234.5, airtimeHours: 6 }], categories: [{ rank: 1, game: "Just Chatting", hoursWatched: 9000.2, peakViewers: 200000, channels: 20 }] } };
    const page = text(<StatsView preview={preview} load="ready" onRetry={noop} />);
    expect(page).toContain("Twitch right now");
    expect(page).toContain("CaseOh");
    expect(page).toContain("87,481");
    expect(page).toContain("Data: Twitch. Radio LAN analytics.");
    expect(page).not.toMatch(/x402|pay-per-call/);
    expect(html(<StatsView preview={preview} load="ready" onRetry={noop} />)).toContain('href="#/s/caseoh"');
    expect(text(<StatsView preview={null} load="ready" onRetry={noop} />)).toContain("No stats yet");
    expect(text(<StatsView preview={null} load="error" onRetry={noop} />)).toContain("didn't load");
  });

  it("walks a streamer from linking a wallet to creating their arena, and never offers it before it can work", () => {
    const tracked = sampleListingDetail(NOW, "ninja")!.listing;
    const joined = { ...tracked, claimed: true, keys: null, backingOpen: false, arena: null };
    const noWallet = text(<YourPageView claim={{ slug: "ninja", wallet: null, ready: false, reason: "wallet_link_required" }} listing={joined} />);
    expect(noWallet).toContain("Your page");
    expect(noWallet).toContain("Link your wallet");
    expect(noWallet).toContain("Link a wallet first");
    expect(noWallet).not.toContain("Create your arena Create your arena");
    expect(html(<YourPageView claim={{ slug: "ninja", wallet: null, ready: false, reason: "wallet_link_required" }} listing={joined} />)).not.toContain("#/back/ninja");
    const ready = { ...joined, claimDerived: true, keys: { streamer: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", mint: "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy" } };
    const withWallet = html(<YourPageView claim={{ slug: "ninja", wallet: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", ready: true, reason: null }} listing={ready} />);
    expect(decode(withWallet)).toContain("Create your arena");
    expect(withWallet).toContain('href="#/back/ninja"');
    expect(decode(withWallet)).toContain("One signature from the linked wallet");
    const noMint = text(<YourPageView claim={{ slug: "ninja", wallet: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", ready: false, reason: "no_default_mint" }} listing={{ ...joined, claimDerived: false }} />);
    expect(noMint).toContain("no token set");
    const opened = text(<YourPageView claim={{ slug: "ninja", wallet: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", ready: true, reason: null }} listing={{ ...ready, backingOpen: true }} />);
    expect(opened).toContain("Your arena is open");
    const swapped = text(<YourPageView claim={{ slug: "ninja", wallet: "Other111111111111111111111111111111111111111", pinned: { streamer: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", mint: "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy" }, ready: true, reason: "wallet_differs_from_pinned" }} listing={ready} onRelease={() => {}} />);
    expect(swapped).toContain("tied to wallet 9xQe…VFin");
    expect(decode(swapped)).toContain("Connect 9xQe…VFin to create the arena");
    expect(decode(swapped)).not.toContain("One signature from the linked wallet");
    expect(swapped).toContain("anyone who backed it can always withdraw");
    expect(swapped).toContain("Release this page");
    expect(noWallet).not.toContain("Release this page");
    const money = /\b(pay|pays|paid|payout|payment|earn|earns|earned|money|claim|claims|claiming|pool|price|prices|trade|trading|sell|stock)\b/i;
    for (const t of [noWallet, withWallet, noMint, opened, swapped]) expect(money.exec(decode(t))).toBeNull();
  });

  it("offers the arena setup for the featured listing and for a listing whose pair came from its streamer's wallet, and for nothing else", () => {
    const tracked = sampleListingDetail(NOW, "ninja")!.listing;
    const keys = { streamer: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", mint: "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy" };
    expect(canSetUp({ ...tracked, kind: "featured" }, "radiolanlive")).toBe(true);
    expect(canSetUp(null, "radiolanlive")).toBe(true);
    expect(canSetUp(null, "someone")).toBe(false);
    expect(canSetUp({ ...tracked, keys, claimDerived: true }, "ninja")).toBe(true);
    expect(canSetUp({ ...tracked, keys }, "ninja")).toBe(false);
    expect(canSetUp({ ...tracked, keys: null, claimDerived: true }, "ninja")).toBe(false);
    expect(canSetUp(tracked, "ninja")).toBe(false);
  });

  it("has three places to start from, and keeps positions and the collection one tap away on Profile", () => {
    expect(PRIMARY_NAV.map(([, href, label]) => [label, href])).toEqual([["Discover", "#/"], ["Play", "#/play"], ["About", "#/lan"]]);
    const profile = html(<Profile snapshot={sample} load="ready" backer={false} wallet="So11111111111111111111111111111111111111112" onRetry={noop} />);
    expect(profile).toContain('href="#/positions"');
    expect(profile).toContain('href="#/claim"');
  });

  it("marks every screen of the sample season as made up, with a way back, and offers the sample only where a real season is empty", () => {
    const banner = text(<SampleBanner />);
    expect(banner).toContain("Sample season");
    expect(banner).toContain("made up");
    expect(banner).toContain("Nothing is real");
    expect(html(<SampleBanner />)).toContain('href="./#/"');
    const money = /\b(pay|pays|paid|payout|payment|earn|earns|earned|money|claim|claims|claiming|pool|price|prices|trade|trading|sell|stock)\b/i;
    expect(money.exec(banner)).toBeNull();
    const emptyLive = { ...sample, scenario: "today" as const, season: { ...sample.season!, board: [], players: 0, me: null } };
    const live = html(<Board snapshot={emptyLive} load="ready" joined={false} onRetry={noop} />);
    expect(live).toContain('href="?preview=sample#/board"');
    expect(decode(live)).toContain("Nobody has played this season yet.");
    expect(html(<Board snapshot={{ ...emptyLive, scenario: "sample" }} load="ready" joined={false} onRetry={noop} />)).not.toContain("?preview=sample");
    expect(html(<Board snapshot={sample} load="ready" joined onRetry={noop} />)).not.toContain("See a sample season");
  });

  it("offers streamers a badge to add to their channel on listings with a Twitch channel, and not on demos", () => {
    const tracked = sampleListingDetail(NOW, "ninja")!;
    const page = html(<Listing listing={tracked.listing} observed={tracked} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="ninja" />);
    expect(decode(page)).toContain("Add this to your channel");
    expect(page).toContain("/hub/api/badge/ninja.svg");
    const demo = sampleListingDetail(NOW, "crate-breed")!;
    expect(text(<Listing listing={demo.listing} observed={demo} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="crate-breed" />)).not.toContain("Add this to your channel");
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
    expect(other).toMatch(/Backing is not open/);
    expect(other).not.toMatch(/create their own arena/);
    expect(other).toMatch(/Viewers 18,240 \+120 since last read Playing Fortnite/);
    expect(other).toMatch(/Data: Twitch\. Recorded by radiolanlive at \S+\./);
    const lan = sampleListingDetail(NOW, "radiolanlive")!;
    const featured = text(<Listing listing={lan.listing} observed={lan} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="radiolanlive" />);
    expect(featured).toMatch(/Season · points Free · separate from backing/);
    expect(featured).toMatch(/Points come from activities on this site\. Backing does not add points/);
    expect(featured).not.toMatch(/never from backing or Twitch/);
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

describe("community membership", () => {
  it("shows needs-credentials gates on the live page and marks sample membership as fictional", () => {
    const live = html(<Communities snapshot={today} catalog={gatedCommunityCatalog()} />);
    const liveText = text(<Communities snapshot={today} catalog={gatedCommunityCatalog()} />);
    expect(live).not.toContain("tag--sample");
    expect(liveText).toContain(COMMUNITY_COPY.needsCredentials);
    expect(liveText).toContain(COMMUNITY_COPY.joinClick);
    expect(liveText).toContain(COMMUNITY_COPY.noFarm);
    expect(liveText).toContain(COMMUNITY_COPY.notTokens);
    expect(liveText).toContain(COMMUNITY_COPY.unpublished);
    expect(liveText).not.toContain("sample_lan");
    const previewPage = html(<Communities snapshot={sample} catalog={sampleCommunityCatalog(NOW)} />);
    const previewText = text(<Communities snapshot={sample} catalog={sampleCommunityCatalog(NOW)} />);
    expect(previewPage).toContain("tag--sample");
    expect(previewText).toContain(COMMUNITY_COPY.sampleNote);
    expect(previewText).toContain(COMMUNITY_COPY.notLive);
    expect(previewText).toContain("sample_lan");
    expect(previewText).toContain("+15 once, under the daily and season caps");
  });

  it("keeps native activities as the only Play actions and leaves listing points copy unchanged", () => {
    expect([...new Set(ACTIVITIES.map((a) => a.action))].sort()).toEqual(["accepted_work", "poll_response", "question"]);
    const play = text(<Play snapshot={today} load="ready" now={NOW} joined={false} onJoin={noop} onRetry={noop} toast={noop} />);
    expect(play).toContain("Real Discord or X membership can unlock season-points eligibility");
    expect(play).toContain("Fake joins are refused");
    const lan = sampleListingDetail(NOW, "radiolanlive")!;
    const featured = text(<Listing listing={lan.listing} observed={lan} load="ready" onRetry={noop} station={station} now={NOW} snapshot={sample} onJoin={noop} slug="radiolanlive" />);
    expect(featured).toMatch(/Points come from activities on this site\. Backing does not add points/);
  });
});
