import { describe, expect, it } from "vitest";

import { fetchAnalyticsPreview } from "./analytics";
import { hubAnalyticsEnabled, hubLeaderboardEnabled, HUB_ANALYTICS_ENABLED, HUB_LEADERBOARD_ENABLED } from "./feature-flags";

describe("hub feature flags", () => {
  it("keeps leaderboard and analytics off unless the Vite flag is 1", () => {
    expect(HUB_LEADERBOARD_ENABLED).toBe(false);
    expect(HUB_ANALYTICS_ENABLED).toBe(false);
    expect(hubLeaderboardEnabled({})).toBe(false);
    expect(hubAnalyticsEnabled({})).toBe(false);
    expect(hubLeaderboardEnabled({ VITE_HUB_LEADERBOARD: "0" })).toBe(false);
    expect(hubAnalyticsEnabled({ VITE_HUB_ANALYTICS: "0" })).toBe(false);
    expect(hubLeaderboardEnabled({ VITE_HUB_LEADERBOARD: "1" })).toBe(true);
    expect(hubAnalyticsEnabled({ VITE_HUB_ANALYTICS: "1" })).toBe(true);
  });

  it("does not fetch analytics preview when the flag is off", async () => {
    const preview = await fetchAnalyticsPreview(async () => {
      throw new Error("analytics must not be fetched when the flag is off");
    }, false);
    expect(preview).toBeNull();
  });
});
