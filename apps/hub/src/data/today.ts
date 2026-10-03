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
    fan: me ? { handle: handleOf(me.accountId), since: s ? Number(s.number) : 0 } : null,
    season: s
      ? {
          number: Number(s.number),
          opensAt: s.startsAt * 1000,
          freezesAt: s.endsAt * 1000,
          players: s.players,
          backers: 0,
          reward: { kind: "provisional" },
          policy: s.policy,
          poll: null,
          prompt: null,
          board: [],
          me: me?.joined ? { points: Number(me.points), rank: null, streakDays: 0, today: Number(me.today), submissions: me.submissions.map(({ action, status }) => ({ action, status })) } : null,
        }
      : null,
  };
}
