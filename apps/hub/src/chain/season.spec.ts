import { describe, expect, it } from "vitest";

import { HUB_SEASON_EPOCH, HUB_SEASON_SECONDS, matchesHubSchedule, mostRecentMondayUtc } from "./season";

const WEEK = 604_800n;
const MONDAY = 1_790_553_600n;

describe("matchesHubSchedule", () => {
  it("accepts a 7-day season whose start is a Monday 00:00 UTC", () => {
    expect(HUB_SEASON_SECONDS).toBe(WEEK);
    expect(HUB_SEASON_EPOCH).toBe(MONDAY);
    expect(matchesHubSchedule(MONDAY, WEEK)).toBe(true);
    expect(matchesHubSchedule(MONDAY + WEEK, WEEK)).toBe(true);
    expect(matchesHubSchedule(MONDAY - WEEK, WEEK)).toBe(true);
    expect(matchesHubSchedule(mostRecentMondayUtc(MONDAY + 3n * 86_400n), WEEK)).toBe(true);
  });

  it("refuses a different length or an off-phase start, without inventing a season", () => {
    expect(matchesHubSchedule(MONDAY, 60n)).toBe(false);
    expect(matchesHubSchedule(MONDAY, 86_400n)).toBe(false);
    expect(matchesHubSchedule(MONDAY + 86_400n, WEEK)).toBe(false);
    expect(matchesHubSchedule(1_790_000_000n, WEEK)).toBe(false);
  });
});
