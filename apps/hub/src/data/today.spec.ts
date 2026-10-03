// The live mapping: the API's state to the screens' snapshot, with nothing invented where the API has nothing.
import { describe, expect, it } from "vitest";

import type { ApiState } from "./api";
import { buildToday, EMPTY_TODAY, handleOf } from "./today";

const state: ApiState = {
  season: {
    number: "2",
    arena: "GwYjjFYcc4DV8hLE6bCAQiM3rjstGWNZ6p3icjR7ZnxU",
    network: "devnet",
    startsAt: 1_791_158_400,
    endsAt: 1_791_763_200,
    open: true,
    policy: { dailyCap: 25, weeklyCap: 100, weights: { question: 10, poll_response: 5, accepted_work: 20 } },
    players: 3,
    credited: 7,
  },
  me: { accountId: "ab12cd34".padEnd(64, "0"), createdAt: 1_791_200_000, joined: true, points: "15", today: "10", pending: 1, submissions: [{ id: "s1", action: "question", status: "credited", occurredAt: 1 }, { id: "s2", action: "accepted_work", status: "pending", occurredAt: 2 }] },
  generatedAt: 1_791_300_000,
};

describe("today's snapshot from the API", () => {
  it("is empty without the API: no season, no fan, no board, no arena", () => {
    expect(buildToday()).toEqual(EMPTY_TODAY);
    expect(buildToday(null)).toEqual(EMPTY_TODAY);
    expect(buildToday({ season: null, me: null, generatedAt: 1 })).toEqual(EMPTY_TODAY);
  });

  it("maps the season, the policy verbatim, the fan's standing, and leaves poll, prompt, board and rank unpublished", () => {
    const snap = buildToday(state);
    expect(snap.scenario).toBe("today");
    expect(snap.fan).toEqual({ handle: "fan-ab12cd34", since: 2 });
    expect(snap.season).toMatchObject({ number: 2, opensAt: 1_791_158_400_000, freezesAt: 1_791_763_200_000, players: 3, backers: 0, reward: { kind: "provisional" }, poll: null, prompt: null, board: [] });
    expect(snap.season?.policy).toEqual(state.season?.policy);
    expect(snap.season?.me).toEqual({ points: 15, rank: null, streakDays: 0, today: 10, submissions: [{ action: "question", status: "credited" }, { action: "accepted_work", status: "pending" }] });
    expect(snap.lastSeason).toBeNull();
    expect(snap.history).toEqual([]);
    expect(snap.arena).toBeNull();
  });

  it("shows an account that has not joined with no standing, and never the account id itself", () => {
    const snap = buildToday({ ...state, me: { ...state.me!, joined: false } });
    expect(snap.season?.me).toBeNull();
    expect(snap.fan?.handle).toBe(handleOf(state.me!.accountId));
    expect(JSON.stringify(snap)).not.toContain(state.me!.accountId);
  });
});
