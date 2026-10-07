import { ACTIONS } from "./points.js";

const DAY = 86_400;

/** Collector evidence is credited native play, across seasons. Provider observations and backing are excluded. */
export function playRecord(submissions, now) {
  const rows = submissions.filter((s) => s.status === "credited" && ACTIONS.includes(s.action) && s.source !== "twitch" && Number.isFinite(s.occurredAt) && s.occurredAt >= 0 && s.occurredAt <= now).sort((a, b) => a.occurredAt - b.occurredAt);
  const badges = [];
  const days = new Set();
  for (const row of rows) {
    if (days.size === 0) badges.push({ id: "first_play", earnedAt: row.occurredAt });
    const day = Math.floor(row.occurredAt / DAY);
    if (!days.has(day) && days.size === 2) badges.push({ id: "three_days", earnedAt: row.occurredAt });
    days.add(day);
  }
  const today = Math.floor(now / DAY);
  let day = days.has(today) ? today : today - 1;
  let streakDays = 0;
  while (days.has(day)) { streakDays++; day--; }
  return { badges, activityDays: days.size, playedToday: days.has(today), streakDays, firstSeason: rows.length ? Number(rows[0].season) : null };
}
