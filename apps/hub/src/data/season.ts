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

/** Play and the points Board share this eyebrow. Season 2 is the devnet points season, even on the mainnet creator board. */
export function pointsSeasonEyebrow(season: Pick<CurrentSeason, "number" | "poll">): string {
  if (season.number === 2) return `Season 2 · Solana devnet · Radio LAN`;
  return `Season ${season.number} · Radio LAN`;
}

/** The published points schedule, not the backing arena's withdrawal schedule. */
export function seasonCalendar(season: Pick<CurrentSeason, "number" | "opensAt" | "freezesAt">): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const event = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Radio LAN//Seasons//EN", "BEGIN:VEVENT",
    `UID:season-${season.number}-${season.opensAt}@radiolan`, `DTSTAMP:${stamp(season.opensAt)}`,
    `DTSTART:${stamp(season.opensAt)}`, `DTEND:${stamp(season.freezesAt)}`,
    `SUMMARY:Radio LAN season ${season.number}`, "DESCRIPTION:Free activities on Radio LAN. Join when the season opens.",
    "URL:https://twzrd.xyz/hub/#/play", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(event)}`;
}
