import { fmt } from "../lib/format";
import type { CurrentSeason } from "./types";

export type SeasonPhase = "upcoming" | "open" | "closed";
export const seasonPhase = (season: Pick<CurrentSeason, "opensAt" | "freezesAt">, now: number): SeasonPhase =>
  now < season.opensAt ? "upcoming" : now < season.freezesAt ? "open" : "closed";

/** The next free site action for a joined or unjoined fan. Backing is never the next action. */
export function nextSeasonAction(season: CurrentSeason, now: number): string {
  const me = season.me;
  const phase = seasonPhase(season, now);
  if (phase === "upcoming") return "Wait for the published opening.";
  if (phase === "closed") return "Read your season record.";
  if (!me) return "Join this season. Play is free.";
  if (me.points >= season.policy.weeklyCap) return "Your season points cap is reached. Read your record and watch for the next published season.";
  if (me.today >= season.policy.dailyCap) return "Your daily points cap is reached. Come back after 00:00 UTC.";
  const today = Math.floor(now / 86_400_000);
  const asked = me.submissions.some((s) => s.action === "question" && (s.occurredAt === undefined || Math.floor(s.occurredAt / 86_400_000) === today));
  const polled = me.submissions.some((s) => s.action === "poll_response" && s.pollId === season.poll?.id);
  if (!asked) return "Ask the guest or the room a question.";
  if (season.poll && !season.poll.placeholder && !polled) return "Answer today's poll.";
  return "Send your own clip or note for review. It counts only after acceptance.";
}

/** A poll placeholder is non-scoring; other native activities in the season remain real. */
export const isPlaceholderSeason = (season: Pick<CurrentSeason, "poll"> | null | undefined): boolean =>
  Boolean(season?.poll?.placeholder);

/** The label follows the published season network, independently of the creator-board network. */
export const pointsSeasonNetworkLabel = (season: Pick<CurrentSeason, "network">): string | null =>
  season.network === "mainnet" ? "Solana mainnet" : season.network === "devnet" ? "Solana devnet" : null;

/** One calm line naming the points season's network, for the fine print of Play and the board; null when the API gave none. */
export const pointsSeasonNetworkLine = (season: Pick<CurrentSeason, "network">): string | null => {
  const network = pointsSeasonNetworkLabel(season);
  return network ? `Points season on ${network} · free to play` : null;
};

/** The page eyebrow: season and station. The network is stated once on the season card and in the standing's fine print. */
export function pointsSeasonEyebrow(season: Pick<CurrentSeason, "number" | "network">): string {
  return `Season ${season.number} · Radio LAN`;
}

/**
 * Joined accounts vs published board rows. `players` is everyone who joined (including 0 points).
 * Board rows are the fans with credited site play. Credited-activity totals are never a people count.
 */
export function seasonStandingLabel(season: Pick<CurrentSeason, "players" | "board">): string {
  return `${fmt(season.players)} joined · ${fmt(season.board.length)} on the board`;
}

/** The published points schedule, not the backing arena's withdrawal schedule. */
export function seasonCalendar(season: Pick<CurrentSeason, "number" | "opensAt" | "freezesAt">): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const event = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Radio LAN//Seasons//EN", "BEGIN:VEVENT",
    `UID:season-${season.number}-${season.opensAt}@radiolan`, `DTSTAMP:${stamp(season.opensAt)}`,
    `DTSTART:${stamp(season.opensAt)}`, `DTEND:${stamp(season.freezesAt)}`,
    `SUMMARY:Radio LAN season ${season.number}`, "DESCRIPTION:Free activities on Radio LAN. Join when the season opens.",
    "URL:https://radiolan.live/hub/#/play", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(event)}`;
}
