import type { CurrentSeason } from "./types";

export type SeasonPhase = "upcoming" | "open" | "closed";
export const seasonPhase = (season: Pick<CurrentSeason, "opensAt" | "freezesAt">, now: number): SeasonPhase =>
  now < season.opensAt ? "upcoming" : now < season.freezesAt ? "open" : "closed";

/** A season whose current poll is a station placeholder: label it as a sample, never as a live scored season. */
export const isPlaceholderSeason = (season: Pick<CurrentSeason, "poll"> | null | undefined): boolean =>
  Boolean(season?.poll?.placeholder);

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
