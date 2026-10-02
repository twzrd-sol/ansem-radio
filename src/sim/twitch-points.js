/**
 * Twitch Channel Points rules the simulator uses, as published. Earn rates:
 * https://help.twitch.tv/s/article/viewer-channel-point-guide (retrieved 2026-10-01),
 * which says "These rates are subject to change." Predictions:
 * https://help.twitch.tv/s/article/channel-points-predictions (retrieved 2026-10-01).
 *
 * Channel Points have no monetary value and cannot be exchanged outside Twitch
 * (Channel Points Acceptable Use Policy).
 */

export const EARN = Object.freeze({
  watch_points: 10, // "each 5 mins of live watch time"
  watch_every_minutes: 5,
  bonus_points: 50, // "each 15 mins ... (Click to redeem)"
  bonus_every_minutes: 15,
  raid: 250, // "for joining a raid"
  follow: 300, // "upon new follow ... only once"
  streak: Object.freeze({ 2: 300, 3: 350, 4: 400, 5: 450 }), // 5 means 5 or more
  streak_min_stream_minutes: 10,
  streak_min_gap_minutes: 30,
  first_cheer: 350, // "first Cheer on the channel per 30 days"
  first_gift: 500, // "first subscription gift ... per 30 days", not anonymous
  sub_multiplier: Object.freeze({ 0: 1, 1: 1.2, 2: 1.4, 3: 2 }), // "multiplier for watching"
});

export const PREDICTION = Object.freeze({
  min_outcomes: 2,
  max_outcomes: 10, // [VERIFY] the 2021 terms say two; the API and help say 2 to 10
  min_window_seconds: 30,
  max_window_seconds: 1800,
  min_stake: 10, // "as few as 10 points"
  max_stake: 250_000, // "The maximum number of points a viewer can use"
  // "Viewers who guess correctly will win a proportionate share of the Channel Points pool." "Points round down."
});

export const MAX_CUSTOM_REWARDS = 50;

export function streakBonus(streak) {
  if (streak < 2) return 0;
  return EARN.streak[Math.min(streak, 5)];
}
