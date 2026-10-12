/** Frontend mirrors of the station feature flags. Off unless the Vite build is told they are on. */
export const HUB_LEADERBOARD_FLAG = "VITE_HUB_LEADERBOARD";
export const HUB_ANALYTICS_FLAG = "VITE_HUB_ANALYTICS";

export function hubLeaderboardEnabled(env: { VITE_HUB_LEADERBOARD?: string } = { VITE_HUB_LEADERBOARD: import.meta.env.VITE_HUB_LEADERBOARD }): boolean {
  return env.VITE_HUB_LEADERBOARD === "1";
}

export function hubAnalyticsEnabled(env: { VITE_HUB_ANALYTICS?: string } = { VITE_HUB_ANALYTICS: import.meta.env.VITE_HUB_ANALYTICS }): boolean {
  return env.VITE_HUB_ANALYTICS === "1";
}

export const HUB_LEADERBOARD_ENABLED = hubLeaderboardEnabled();
export const HUB_ANALYTICS_ENABLED = hubAnalyticsEnabled();
