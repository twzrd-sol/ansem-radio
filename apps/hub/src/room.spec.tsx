import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NETWORK, RLAN_MINT } from "./chain/config";
import { hasBacking } from "./data/backer";
import { HubProvider } from "./data/hub";
import { type FanPositions } from "./data/market";
import type { PlayBadge } from "./data/types";
import { buildSample, sampleMarket } from "./data/sample";
import { buildToday } from "./data/today";
import { nextSeasonAction } from "./data/season";
import { Board } from "./screens/Board";
import { Circle } from "./screens/Circle";
import { lockerIsOpen, Market } from "./screens/Market";
import { doneFrom, Play } from "./screens/Play";
import { Profile } from "./screens/Profile";
import { EarnedBadges, nextBadge } from "./ui/Collector";
import { SeasonCard } from "./ui/SeasonCard";
import { CHAT_LOOP_COPY, CHAT_SIGN_IN_COPY, Player, twitchChatPopout, twitchChatSrc } from "./ui/Player";

const now = Date.parse("2026-10-06T21:17:00Z");
const noop = () => {};
const live = buildToday({
  season: { number: "2", arena: "test", network: "devnet", startsAt: now / 1000 - 60, endsAt: now / 1000 + 60, open: true, policy: { dailyCap: 25, weeklyCap: 100, weights: { question: 10, poll_response: 5, accepted_work: 20 } }, players: 2, credited: 1, board: [["fan-12345678", "10"], ["fan-abcdefab", "5"]], boardDetails: [{ handle: "fan-12345678", badges: [{ id: "first_play", earnedAt: 1 }], streakDays: 1 }] },
  me: { accountId: "12345678".padEnd(64, "0"), joined: true, points: "10", today: "10", rank: 1, pending: 0, submissions: [], badges: [{ id: "first_play", earnedAt: 1 }], activityDays: 1, playedToday: true, streakDays: 1, firstSeason: 1 },
  history: [{ season: 1, players: 2, points: 15, rank: 2, eligiblePoints: 30, reward: { kind: "provisional" } }], generatedAt: now / 1000,
});

describe("one Radio LAN room", () => {
  it("marks the signed-in fan inside the top board, with supported badges and a real streak", () => {
    const html = renderToStaticMarkup(<Board snapshot={live} load="ready" joined onRetry={noop} />);
    expect(html).toContain("You are here");
    expect(html).toContain("row--me");
    expect(html).toContain("First play");
    expect(html).toContain("1-day active streak");
    expect(html).not.toContain("Three days played");
    expect(html).not.toContain("tag--sample");
    expect(html).toContain("Active linked RLAN support can boost eligible site credit, within caps");
    expect(html).toContain("Season standing, not redeemable");
    expect(html).toContain("Joined fans rank by credited site play");
    expect(html).toContain("2 joined players");
  });
  it("keeps badges and provisional history when a new season has not been joined", () => {
    const snapshot = { ...live, season: { ...live.season!, me: null } };
    const html = renderToStaticMarkup(<Profile snapshot={snapshot} load="ready" backer wallet={null} onRetry={noop} />);
    expect(html).toContain("First play");
    expect(html).toContain("Season 1 recap");
    expect(html).toContain("No anchored receipts yet");
    expect(html).not.toContain("Signed at close and recorded");
    expect(html).not.toContain("First poll");
    expect(html).not.toContain("collector-mark--backer");
    const earned = renderToStaticMarkup(<EarnedBadges record={live.fan!} />);
    expect(earned).not.toContain("Three days played");
    expect(earned).not.toContain("locked");
  });
  it("reopens native play cards on another UTC day so fans can build a real three-day record", () => {
    const season = { ...live.season!, me: { ...live.season!.me!, submissions: [{ action: "question" as const, status: "credited" as const, occurredAt: now }, { action: "accepted_work" as const, status: "pending" as const, occurredAt: now }] } };
    expect(doneFrom(season, now).question).toBe(true);
    expect(doneFrom(season, now).clip).toBe(true);
    expect(doneFrom(season, now + 86_400_000).question).toBe(false);
    expect(doneFrom(season, now + 86_400_000).clip).toBe(false);
  });
  it("only offers a third-day badge when credited play can add another distinct day", () => {
    expect(nextBadge({ badges: [] })).toBe("First play");
    expect(nextBadge({ badges: ["first_play"], activityDays: 2, playedToday: false })).toBe("Three days played");
    expect(nextBadge({ badges: ["first_play"], activityDays: 2, playedToday: true })).toBeNull();
    expect(nextBadge({ badges: ["first_play", "three_days"], activityDays: 3, playedToday: false })).toBeNull();
  });
  it("lists radiolanlive without a live-show player or chat popout", () => {
    const html = renderToStaticMarkup(<HubProvider value={{ status: "ready", snapshot: live }}><Player station={{ status: "unknown" }} /></HubProvider>);
    expect(html).toContain("Radio LAN channel listing");
    expect(html).toContain("Listed Twitch channel. Not a live show.");
    expect(html).toContain("View on Twitch");
    expect(html).not.toContain("Play here");
    expect(html).not.toContain("Official Twitch chat");
    expect(html).not.toContain("<iframe");
    expect(twitchChatSrc("twzrd.xyz")).toBe("https://www.twitch.tv/embed/radiolanlive/chat?parent=twzrd.xyz&darkpopout");
    expect(twitchChatSrc("a&b.example", "a/b")).toContain("a%2Fb/chat?parent=a%26b.example");
    expect(readFileSync("vite.config.ts", "utf8")).toContain("frame-src https://player.twitch.tv https://www.twitch.tv");
  });
  it("still offers an embed and chat popout on other listed channels", () => {
    const html = renderToStaticMarkup(<HubProvider value={{ status: "ready", snapshot: live }}><Player station={{ status: "unknown" }} channel="ninja" /></HubProvider>);
    expect(html).toContain("Open player");
    expect(html).toContain("Official Twitch chat · ninja");
    expect(html).toContain("Your season");
    expect(html).not.toContain("Your locker");
    expect(html).not.toContain("<iframe");
  });
  it("leads the chat panel with Twitch's pop-out and says Twitch signs you in separately from the hub", () => {
    const html = renderToStaticMarkup(<HubProvider value={{ status: "ready", snapshot: live }}><Player station={{ status: "unknown" }} channel="kaicenat" /></HubProvider>);
    expect(twitchChatPopout("kaicenat")).toBe("https://www.twitch.tv/popout/kaicenat/chat?popout=");
    expect(twitchChatPopout("a/b")).toBe("https://www.twitch.tv/popout/a%2Fb/chat?popout=");
    expect(html).toContain('href="https://www.twitch.tv/popout/kaicenat/chat?popout="');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Chat on Twitch");
    expect(html).toContain("Show chat here");
    expect(html).toContain(CHAT_SIGN_IN_COPY);
    expect(html.indexOf("Chat on Twitch")).toBeLessThan(html.indexOf("Show chat here"));
    expect(html).not.toContain(CHAT_LOOP_COPY);
    expect(html).toContain("Read the room live: chat on Twitch, or show it here.");
    const signedOut = renderToStaticMarkup(<HubProvider value={{ status: "ready", snapshot: { ...live, fan: null, season: { ...live.season!, me: null } } }}><Player station={{ status: "unknown" }} channel="kaicenat" /></HubProvider>);
    expect(signedOut).toContain('<a href="#/me">Sign in with a passkey</a>');
    expect(signedOut).toContain("Watching and chat need no sign-in.");
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/signs you in(to)? (to )?Twitch with your passkey|same account/i);
    expect(CHAT_SIGN_IN_COPY).not.toMatch(/certif|verified by Twitch/i);
  });
  it("labels live season cards as devnet while only a placeholder poll is non-scoring", () => {
    const season = { ...live.season!, network: "devnet" as const, poll: { id: "placeholder", question: "Preview", options: ["A", "B"], placeholder: true } };
    const html = renderToStaticMarkup(<SeasonCard season={season} now={now} onJoin={noop} />);
    expect(html).toContain("Solana devnet");
    expect(html).not.toContain("tag--sample");
    expect(html).toContain("Other site activities remain available");
    const sample = renderToStaticMarkup(<SeasonCard season={season} now={now} onJoin={noop} sample />);
    expect(sample).toContain("tag--sample");
  });
  it("leads with the station even when no locker is open, and labels fictional previews", () => {
    const marketSample = sampleMarket(now);
    const market = { ...marketSample, sample: false, listings: marketSample.listings.map((l) => ({ ...l, backingOpen: false, arena: l.arena ? { ...l.arena, closed: true } : null })) };
    const html = renderToStaticMarkup(<Market market={market} load="ready" station={{ status: "unknown" }} now={now} onRetry={noop} />);
    expect(html.indexOf('class="feature"')).toBeLessThan(html.indexOf('class="mkt__controls"'));
    expect(html).toContain("Closed · this locker is not taking backing");
    expect(html).not.toContain("Open lockers");
    expect(html).toContain(RLAN_MINT);
    // The Buy button goes through the counted /go/ path (Cloudflare redirects it to the ClawPump page).
    expect(html).toContain('href="/go/buy"');
    expect(lockerIsOpen(market.listings[0]!, market)).toBe(false);
    expect(lockerIsOpen(marketSample.listings[0]!, marketSample)).toBe(true);
    const sample = renderToStaticMarkup(<Profile snapshot={buildSample(now)} load="ready" backer={false} wallet={null} onRetry={noop} />);
    expect(sample).toContain("Fictional collector designs");
    expect(sample).toContain("tag--sample");
    expect(sample).toContain("First poll");
    expect(sample).toContain("First play");
    expect(sample).not.toContain("who__avatar");
  });
  it("keeps the official listing-only poster while the hub is still loading", () => {
    const html = renderToStaticMarkup(<HubProvider value={{ status: "loading" }}><Player station={{ status: "unknown" }} /></HubProvider>);
    expect(html).toContain("Listed Twitch channel. Not a live show.");
    expect(html).not.toContain("Official Twitch chat");
    expect(html).not.toContain("station-room__side");
    expect(html).not.toContain("<iframe");
  });
  it("shows the sample board as fictional social ranking with real-system marks only on credited rows", () => {
    const snapshot = buildSample(now);
    const html = renderToStaticMarkup(<Board snapshot={snapshot} load="ready" joined onRetry={noop} />);
    expect(html).toContain("tag--sample");
    expect(html).toContain("You are here");
    expect(html).toContain("crate_digger_07");
    expect(html).toContain("First play");
    expect(html).toContain("Three days played");
    expect(html).toContain("3-day active streak");
    expect(html).toContain("4-day active streak");
    expect(html).not.toContain("First poll");
    const play = renderToStaticMarkup(<Play snapshot={snapshot} load="ready" now={now} joined onJoin={noop} onRetry={noop} toast={noop} />);
    expect(play).toContain("Free activities with published point values");
    expect(play).toContain("Season 12 · Open");
    expect(play).not.toMatch(/Can light|collector record|Collector profile|Next action|Your locker|broadcast console/);
    expect(nextSeasonAction(snapshot.season!, now)).toBe("Send your own clip or note for review. It counts only after acceptance.");
  });

  it("lets a signed-in fan meet other superfans without SAMPLE looking live", () => {
    const liveCircle = renderToStaticMarkup(<Circle snapshot={live} load="ready" listings={sampleMarket(now).listings} followed={["ninja"]} selected="" onRetry={noop} />);
    expect(liveCircle).toContain("fan-12345678");
    expect(liveCircle).toContain("You are here");
    expect(liveCircle).toContain("First play");
    expect(liveCircle).not.toContain("tag--sample");
    expect(liveCircle).not.toContain("crate_breed");
    const ninjaCircle = renderToStaticMarkup(<Circle snapshot={live} load="ready" listings={sampleMarket(now).listings} followed={["ninja"]} selected="ninja" onRetry={noop} />);
    expect(ninjaCircle).toContain("No season circle for ninja yet");
    expect(ninjaCircle).toContain("Season points are Radio LAN site play");
    expect(ninjaCircle).not.toContain("tag--sample");
    const sampleCircle = renderToStaticMarkup(<Circle snapshot={buildSample(now)} load="ready" listings={sampleMarket(now).listings} followed={["crate-breed"]} selected="crate-breed" onRetry={noop} />);
    expect(sampleCircle).toContain("tag--sample");
    expect(sampleCircle).toContain("Fictional fans of a fictional creator");
    expect(sampleCircle).toContain("crate_breed");
    expect(sampleCircle).toContain("Crate Breed");
  });
  it("names the badge a credited action can light without scoring a placeholder poll", () => {
    const season = { ...live.season!, me: { ...live.season!.me!, badges: ["first_play"] as PlayBadge[], activityDays: 2, playedToday: false }, poll: { id: "placeholder", question: "Preview", options: ["A", "B"], placeholder: true } };
    const html = renderToStaticMarkup(<Play snapshot={{ ...live, season }} load="ready" now={now} joined onJoin={noop} onRetry={noop} toast={noop} />);
    expect((html.match(/Badge: Three days played/g) ?? []).length).toBe(3);
    expect(html).toContain("Answers here do not earn points");
    expect(nextSeasonAction(season, now)).toBe("Ask the guest or the room a question.");
  });
});

describe("optional Backer evidence", () => {
  const wallet = "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb";
  const data: FanPositions = { fan: wallet, network: NETWORK, observedAt: new Date(now).toISOString(), stale: false, slot: 1, generatedAt: now / 1000, positions: [{ arena: "test", address: "test", state: "active", amount: "1", openedAt: "1", requestedSeason: "0", slug: null, schedule: null }] };
  it("requires positive chain-read backing for this wallet and network", () => {
    expect(hasBacking(data, wallet, now)).toBe(true);
    expect(hasBacking({ ...data, positions: [{ ...data.positions[0]!, state: "requested" }] }, wallet, now)).toBe(true);
    for (const candidate of [null, { ...data, stale: true }, { ...data, network: "wrong" }, { ...data, fan: "other" }, { ...data, observedAt: null }, { ...data, positions: [] }, { ...data, positions: [{ ...data.positions[0]!, amount: "0" }] }, { ...data, positions: [{ ...data.positions[0]!, amount: "garbage" }] }]) expect(hasBacking(candidate, wallet, now)).toBe(false);
    expect(hasBacking(data, null, now)).toBe(false);
    expect(hasBacking(data, wallet, now + 120_001)).toBe(false);
    expect(hasBacking(data, wallet, now - 1)).toBe(false);
  });
});

describe("who backing is open for (review of #217)", () => {
  it("names only lockers that pass the fresh-read check, and nothing on a stale board", async () => {
    const { openForNames } = await import("./screens/Market");
    const now = Date.parse("2026-10-08T00:00:00Z");
    const fresh = sampleMarket(now);
    const names = openForNames(fresh);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => fresh.listings.some((l) => l.name === n && l.backingOpen && l.arena && !l.arena.closed))).toBe(true);
    expect(openForNames({ ...fresh, stale: true })).toEqual([]);
    expect(openForNames(null)).toEqual([]);
    const flagOnly = { ...fresh, listings: fresh.listings.map((l) => ({ ...l, arena: null, backingOpen: true })) };
    expect(openForNames(flagOnly)).toEqual([]);
  });
  it("keeps the locker cell on a row whose flag says open but has no arena, and hides it only when neither is set", async () => {
    const { Market } = await import("./screens/Market");
    const now = Date.parse("2026-10-08T00:00:00Z");
    const base = sampleMarket(now);
    const row = { ...base.listings.find((l) => l.kind !== "featured")!, arena: null, backingOpen: true, performance: null };
    const flagged = renderToStaticMarkup(<Market market={{ ...base, sample: false, listings: [row] }} load="ready" station={{ status: "unknown" }} now={now} onRetry={() => {}} />);
    expect(flagged).toContain("Locker status unavailable");
    expect(flagged).not.toContain("None of these channels has a locker yet");
    const bare = renderToStaticMarkup(<Market market={{ ...base, sample: false, listings: [{ ...row, backingOpen: false }] }} load="ready" station={{ status: "unknown" }} now={now} onRetry={() => {}} />);
    expect(bare).toContain("None of these channels has a locker yet");
  });
});
