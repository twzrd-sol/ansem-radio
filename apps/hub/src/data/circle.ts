// Provider-neutral creator–audience loop: season challenges (poll / question / accepted
// work only) and superfan circles. Points stay season policy. SAMPLE affinity never
// mixes into today's snapshot.
import type { Listing } from "./market";
import { nextSeasonAction, seasonPhase } from "./season";
import type { Action, CurrentSeason, HubSnapshot, PlayBadge } from "./types";

export type ChallengeId = "poll" | "question" | "prompt" | "clip";
export type ChallengeStatus = "upcoming" | "join" | "open" | "waiting" | "done" | "capped" | "frozen" | "locked";

export interface ChallengeDef {
  id: ChallengeId;
  action: Action;
  title: string;
  blurb: string;
}

/** Named challenge paths. Point values come from the published season policy, never from Twitch. */
export const CHALLENGE_DEFS: readonly ChallengeDef[] = [
  { id: "poll", action: "poll_response", title: "Live poll", blurb: "The streamer posts a poll during the show. Pick an answer." },
  { id: "question", action: "question", title: "Ask a question", blurb: "Ask the guest or the room. The streamer picks which ones to answer on stream." },
  { id: "prompt", action: "accepted_work", title: "Answer the prompt", blurb: "Reply to the streamer's published prompt. It counts once the streamer accepts it." },
  { id: "clip", action: "accepted_work", title: "Clip or note", blurb: "Send a moment from the show or a short note, your own work only. It counts once the streamer accepts and co-signs it." },
];

export interface SeasonChallenge extends ChallengeDef {
  points: number;
  status: ChallengeStatus;
  featured: boolean;
}

export interface StandingGap {
  points: number;
  rank: number | null;
  players: number;
  leaderHandle: string | null;
  leaderPoints: number | null;
  /** Points behind the board leader; 0 when this fan leads; null when there is no standing to compare. */
  behind: number | null;
  nextAction: string;
  joined: boolean;
}

export interface Superfan {
  handle: string;
  points: number;
  rank: number | null;
  badges: PlayBadge[];
  streakDays: number;
  me: boolean;
}

export type CircleSource = "season-board" | "sample-affinity" | "empty";

export interface CreatorCircle {
  slug: string;
  name: string;
  source: CircleSource;
  /** True only for SAMPLE fixtures. Today never marks a circle fictional. */
  fictional: boolean;
  fans: Superfan[];
}

export interface ChallengeDone {
  poll: boolean;
  question: boolean;
  prompt: boolean;
  clip: boolean;
}

/** Fictional SAMPLE handles who share a demo creator. Keys are listing slugs. Never read on today. */
export const SAMPLE_AFFINITY: Record<string, readonly string[]> = {
  "crate-breed": ["crate_breed", "dusty_rhymes", "lyric_hazel", "crate_digger_07"],
  "dusty-rhymes": ["dusty_rhymes", "qwonbeat", "crate_digger_07"],
};

const STATION_SLUG = "radiolanlive";
const STATION_NAME = "Radio LAN";

function marksOf(season: CurrentSeason, handle: string, meHandle: string | null, me?: CurrentSeason["me"]): { badges: PlayBadge[]; streakDays: number } {
  if (meHandle && handle === meHandle) {
    return { badges: me?.badges ?? [], streakDays: me?.streakDays ?? 0 };
  }
  const row = season.boardDetails?.find((entry) => entry.handle === handle);
  return { badges: row?.badges ?? [], streakDays: row?.streakDays ?? 0 };
}

export function seasonFans(season: CurrentSeason, meHandle: string | null): Superfan[] {
  const seen = new Set<string>();
  const fans: Superfan[] = [];
  season.board.forEach(([handle, points], index) => {
    seen.add(handle);
    fans.push({
      handle,
      points,
      rank: index + 1,
      me: Boolean(meHandle && handle === meHandle),
      ...marksOf(season, handle, meHandle, season.me),
    });
  });
  if (season.me && meHandle && !seen.has(meHandle)) {
    fans.push({
      handle: meHandle,
      points: season.me.points,
      rank: season.me.rank,
      badges: season.me.badges ?? [],
      streakDays: season.me.streakDays,
      me: true,
    });
  }
  return fans;
}

function fansNamed(season: CurrentSeason | null, names: readonly string[], meHandle: string | null): Superfan[] {
  if (!season) return [];
  const byHandle = new Map(seasonFans(season, meHandle).map((fan) => [fan.handle, fan]));
  return names.flatMap((handle) => {
    const known = byHandle.get(handle);
    return known ? [known] : [];
  });
}

export function standingGap(snapshot: HubSnapshot, now: number): StandingGap | null {
  const season = snapshot.season;
  if (!season) return null;
  const me = season.me;
  const leader = season.board[0];
  const meHandle = snapshot.fan?.handle ?? null;
  const leads = Boolean(me && leader && (meHandle === leader[0] || me.rank === 1));
  const behind = me && leader ? (leads ? 0 : Math.max(0, leader[1] - me.points)) : null;
  return {
    points: me?.points ?? 0,
    rank: me?.rank ?? null,
    players: season.players,
    leaderHandle: leader?.[0] ?? null,
    leaderPoints: leader?.[1] ?? null,
    behind,
    nextAction: nextSeasonAction(season, now),
    joined: Boolean(me),
  };
}

function challengeStatus(def: ChallengeDef, season: CurrentSeason | null, now: number, joined: boolean, done: ChallengeDone): ChallengeStatus {
  if (!season) return "locked";
  const phase = seasonPhase(season, now);
  if (phase === "upcoming") return "upcoming";
  if (phase === "closed") return "frozen";
  if (!joined) return "join";
  if (season.me && (season.me.today >= season.policy.dailyCap || season.me.points >= season.policy.weeklyCap)) return "capped";
  if (done[def.id]) return "done";
  if (def.id === "poll") {
    if (!season.poll) return "waiting";
    if (season.poll.placeholder) return "waiting";
  }
  if (def.id === "prompt" && !season.prompt) return "waiting";
  return "open";
}

/** The challenge the next published action points at. Placeholder polls are never featured. */
export function featuredChallengeId(season: CurrentSeason | null, now: number, joined: boolean, done: ChallengeDone): ChallengeId | null {
  if (!season || !joined) return null;
  const phase = seasonPhase(season, now);
  if (phase !== "open") return null;
  if (season.me && (season.me.today >= season.policy.dailyCap || season.me.points >= season.policy.weeklyCap)) return null;
  if (!done.question) return "question";
  if (season.poll && !season.poll.placeholder && !done.poll) return "poll";
  if (!done.clip) return "clip";
  if (season.prompt && !done.prompt) return "prompt";
  return null;
}

export function seasonChallenges(season: CurrentSeason | null, now: number, joined: boolean, done: ChallengeDone): SeasonChallenge[] {
  const featured = featuredChallengeId(season, now, joined, done);
  return CHALLENGE_DEFS.map((def) => {
    const placeholderPoll = def.id === "poll" && Boolean(season?.poll?.placeholder);
    const points = season ? (placeholderPoll ? 0 : season.policy.weights[def.action]) : 0;
    return { ...def, points, status: challengeStatus(def, season, now, joined, done), featured: def.id === featured };
  });
}

export function creatorCircles(snapshot: HubSnapshot, listings: readonly Listing[], followed: readonly string[]): CreatorCircle[] {
  const season = snapshot.season;
  const meHandle = snapshot.fan?.handle ?? null;
  const fictional = snapshot.scenario === "sample";
  const featured = listings.find((listing) => listing.kind === "featured");
  const stationSlug = featured?.slug ?? STATION_SLUG;
  const stationName = featured?.name ?? STATION_NAME;
  const circles: CreatorCircle[] = [];
  if (season) {
    circles.push({
      slug: stationSlug,
      name: stationName,
      source: "season-board",
      fictional,
      fans: seasonFans(season, meHandle),
    });
  }
  const extras = fictional
    ? listings.filter((listing) => listing.demo)
    : listings.filter((listing) => followed.includes(listing.slug) && listing.slug !== stationSlug);
  for (const listing of extras) {
    if (fictional && listing.demo) {
      const names = SAMPLE_AFFINITY[listing.slug] ?? [];
      circles.push({
        slug: listing.slug,
        name: listing.name,
        source: "sample-affinity",
        fictional: true,
        fans: fansNamed(season, names, meHandle),
      });
      continue;
    }
    circles.push({ slug: listing.slug, name: listing.name, source: "empty", fictional: false, fans: [] });
  }
  return circles;
}

export function circleBySlug(circles: readonly CreatorCircle[], slug: string): CreatorCircle | null {
  if (slug && circles.some((circle) => circle.slug === slug)) return circles.find((circle) => circle.slug === slug) ?? null;
  return circles[0] ?? null;
}

export function emptyCircleCopy(circle: CreatorCircle | null, hasSeason: boolean): { title: string; text: string } {
  if (!circle && !hasSeason) {
    return {
      title: "No superfan circle yet",
      text: "A circle appears when a season opens. Follow a creator on Discover to keep them on your list. Following adds no points.",
    };
  }
  if (circle?.source === "empty") {
    return {
      title: `No season circle for ${circle.name} yet`,
      text: "Season points are Radio LAN site play. Other fans of this creator appear here when they join the same season. Following adds no points.",
    };
  }
  return {
    title: "No credited points on this board yet",
    text: "Play a season challenge to appear here. Points come from the published poll, question, and accepted work.",
  };
}
