import { describe, expect, it } from "vitest";

import { buildSample, sampleMarket } from "./sample";
import { buildToday } from "./today";
import {
  SAMPLE_AFFINITY,
  circleBySlug,
  creatorCircles,
  emptyCircleCopy,
  featuredChallengeId,
  seasonChallenges,
  seasonFans,
  standingGap,
} from "./circle";

const NOW = Date.parse("2026-10-02T13:00:00Z");
const sample = buildSample(NOW);
const live = buildToday({
  season: {
    number: "2",
    arena: "test",
    network: "devnet",
    startsAt: NOW / 1000 - 60,
    endsAt: NOW / 1000 + 60,
    open: true,
    policy: { dailyCap: 25, weeklyCap: 100, weights: { question: 10, poll_response: 5, accepted_work: 20 } },
    players: 2,
    credited: 1,
    board: [["fan-12345678", "10"], ["fan-abcdefab", "5"]],
    boardDetails: [{ handle: "fan-12345678", badges: [{ id: "first_play", earnedAt: 1 }], streakDays: 1 }],
  },
  me: { accountId: "12345678".padEnd(64, "0"), joined: true, points: "10", today: "10", rank: 1, pending: 0, submissions: [], badges: [{ id: "first_play", earnedAt: 1 }], activityDays: 1, playedToday: true, streakDays: 1, firstSeason: 1 },
  generatedAt: NOW / 1000,
});

describe("season standing and featured challenges", () => {
  it("measures the signed-in fan against the published board without inventing a leader", () => {
    const sampleGap = standingGap(sample, NOW)!;
    expect(sampleGap).toMatchObject({ points: 230, rank: 18, players: 214, leaderHandle: "crate_breed", leaderPoints: 455, behind: 225, joined: true });
    expect(sampleGap.nextAction).toContain("clip or note");
    const liveGap = standingGap(live, NOW)!;
    expect(liveGap).toMatchObject({ points: 10, rank: 1, behind: 0, leaderHandle: "fan-12345678", joined: true });
    expect(standingGap(buildToday(), NOW)).toBeNull();
  });

  it("features the next published site action and never a placeholder poll", () => {
    const done = { poll: false, question: false, prompt: false, clip: false };
    expect(featuredChallengeId(live.season, NOW, true, done)).toBe("question");
    expect(featuredChallengeId(sample.season, NOW, true, { poll: true, question: true, prompt: false, clip: false })).toBe("clip");
    const placeholder = { ...live.season!, poll: { id: "p", question: "Preview", options: ["A", "B"], placeholder: true } };
    expect(featuredChallengeId(placeholder, NOW, true, { ...done, question: true })).toBe("clip");
    expect(featuredChallengeId(live.season, NOW, false, done)).toBeNull();
    const challenges = seasonChallenges(placeholder, NOW, true, { ...done, question: true });
    expect(challenges.find((c) => c.id === "poll")).toMatchObject({ points: 0, status: "waiting", featured: false });
    expect(challenges.find((c) => c.id === "clip")).toMatchObject({ points: 20, status: "open", featured: true });
  });
});

describe("superfan circles", () => {
  it("uses the season board for Radio LAN and keeps SAMPLE affinity off today", () => {
    const todayCircles = creatorCircles(live, sampleMarket(NOW).listings, ["ninja", "radiolanlive"]);
    expect(todayCircles.map((c) => [c.slug, c.source, c.fictional])).toEqual([
      ["radiolanlive", "season-board", false],
      ["ninja", "empty", false],
    ]);
    expect(todayCircles[0]!.fans.map((f) => f.handle)).toEqual(["fan-12345678", "fan-abcdefab"]);
    expect(todayCircles[0]!.fans[0]).toMatchObject({ me: true, badges: ["first_play"], streakDays: 1, points: 10 });
    expect(todayCircles[1]!.fans).toEqual([]);
    expect(todayCircles.some((c) => c.source === "sample-affinity")).toBe(false);
    for (const handle of Object.values(SAMPLE_AFFINITY).flat()) {
      expect(todayCircles[0]!.fans.some((f) => f.handle === handle)).toBe(false);
    }
  });

  it("adds fictional creator circles only on SAMPLE, from board handles that already exist", () => {
    const circles = creatorCircles(sample, sampleMarket(NOW).listings, []);
    expect(circles.every((c) => c.fictional)).toBe(true);
    const breed = circleBySlug(circles, "crate-breed")!;
    expect(breed.source).toBe("sample-affinity");
    expect(breed.fans.map((f) => f.handle)).toEqual(["crate_breed", "dusty_rhymes", "lyric_hazel", "crate_digger_07"]);
    expect(breed.fans.at(-1)).toMatchObject({ me: true, points: 230, rank: 18 });
    expect(emptyCircleCopy({ slug: "ninja", name: "ninja", source: "empty", fictional: false, fans: [] }, true).text).toContain("Season points are Radio LAN site play");
    expect(seasonFans(live.season!, "fan-12345678")[0]!.me).toBe(true);
  });
});
