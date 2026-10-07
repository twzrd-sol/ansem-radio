// The real state: what the hub API serves (apps/hub/src/data/api.ts), mapped to the screens' snapshot. Without
// the API (no session, no season) nothing here is made up: no season, no board, no fan, no arena.
import type { ApiState } from "./api";
import type { HubSnapshot } from "./types";

export const EMPTY_TODAY: HubSnapshot = { scenario: "today", season: null, lastSeason: null, upcoming: [], fan: null, history: [], arena: null };

/** A short public handle from the opaque account id; the id itself is never shown. */
export const handleOf = (accountId: string) => `fan-${accountId.slice(0, 8)}`;

export function buildToday(state: ApiState | null = null): HubSnapshot {
  if (!state) return EMPTY_TODAY;
  const me = state.me;
  const s = state.season;
  return {
    ...EMPTY_TODAY,
    history: state.history ?? [],
    lastSeason: state.lastSeason ? { number: state.lastSeason.number, players: state.lastSeason.players, eligiblePoints: state.lastSeason.eligiblePoints, reward: { kind: "provisional" }, me: state.lastSeason.me, top: state.lastSeason.top } : null,
    fan: me ? { handle: handleOf(me.accountId), since: me.firstSeason ?? 0, badges: (me.badges ?? []).map((badge) => badge.id), activityDays: me.activityDays, playedToday: me.playedToday, streakDays: me.streakDays } : null,
    season: s
      ? {
          number: Number(s.number),
          opensAt: s.startsAt * 1000,
          freezesAt: s.endsAt * 1000,
          players: s.players,
          backers: 0,
          reward: { kind: "provisional" },
          policy: s.policy,
          poll: s.poll ? { id: s.poll.id, question: s.poll.question, options: s.poll.options, placeholder: s.poll.placeholder } : null,
          prompt: null,
          board: (s.board ?? []).map(([handle, points]) => [handle, Number(points)] as [string, number]),
          boardDetails: s.boardDetails?.map((row) => ({ ...row, badges: row.badges.map((badge) => badge.id) })),
          me: me?.joined ? { points: Number(me.points), rank: me.rank ?? null, streakDays: me.streakDays ?? 0, activityDays: me.activityDays, playedToday: me.playedToday, today: Number(me.today), submissions: me.submissions.map(({ action, status, occurredAt, pollId }) => ({ action, status, occurredAt: occurredAt * 1000, ...(pollId ? { pollId } : {}) })), badges: (me.badges ?? []).map((badge) => badge.id) } : null,
        }
      : null,
  };
}
