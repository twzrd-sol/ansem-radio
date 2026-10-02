/**
 * Per-minute aggregation of the timeline (docs/twitch/TIMELINE_DESIGN.md).
 * Input: normalized attention and channel events, viewer and follower samples,
 * and connection ticks. Output: one plain object per UTC minute with counts only.
 * Keyed participant ids are used inside a minute to count distinct chatters and
 * are never written out.
 */

export function minuteOf(time) {
  const ms = typeof time === "number" ? time : Date.parse(time);
  if (!Number.isFinite(ms)) throw new TypeError("a valid time is required");
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString().slice(0, 16) + "Z";
}

function emptyBucket(minute) {
  return {
    minute,
    live: null,
    viewers: null,
    followers_total: null,
    tracked_live: null,
    tracked_viewers: null,
    chat_messages: 0,
    chatters: new Set(),
    follows: 0,
    subscriptions: 0,
    gift_subs: 0,
    bits: 0,
    raids_in: 0,
    raid_viewers_in: 0,
    raids_out: 0,
    raid_viewers_out: 0,
    redemptions: 0,
    points_spent: 0,
    prediction_events: 0,
    prediction_points: 0,
    poll_events: 0,
    hype_train_level: 0,
    ad_seconds: 0,
    shoutouts_in: 0,
    shoutouts_out: 0,
    covered_seconds: 0,
  };
}

export function createMinuteAggregator() {
  const buckets = new Map();
  let live = null;

  const bucket = (time) => {
    const minute = minuteOf(time);
    if (!buckets.has(minute)) buckets.set(minute, emptyBucket(minute));
    return buckets.get(minute);
  };

  function attention(event) {
    const b = bucket(event.observed_at);
    const meta = event.metadata ?? {};
    switch (event.signal) {
      case "chat":
        b.chat_messages += 1;
        if (event.participant_id) b.chatters.add(event.participant_id);
        break;
      case "follow":
        b.follows += 1;
        break;
      case "subscription":
        if (meta.twitch_kind === "subgift") b.gift_subs += Number(meta.gifts) || 1;
        else b.subscriptions += 1;
        break;
      case "cheer":
        b.bits += Number(meta.bits) || 0;
        break;
      case "raid":
        b.raids_in += 1;
        b.raid_viewers_in += Number(meta.viewers) || 0;
        break;
      case "redemption":
        b.redemptions += 1;
        b.points_spent += Number(meta.cost) || 0;
        break;
      default:
        break;
    }
  }

  function channel(event) {
    const b = bucket(event.observed_at);
    const t = event.totals ?? {};
    if (event.kind === "stream_online") live = true;
    if (event.kind === "stream_offline") live = false;
    if (event.kind === "stream_online" || event.kind === "stream_offline") b.live = live;
    if (event.kind.startsWith("prediction_")) {
      b.prediction_events += 1;
      b.prediction_points = Math.max(b.prediction_points, Number(t.points_total) || 0);
    }
    if (event.kind.startsWith("poll_")) b.poll_events += 1;
    if (event.kind.startsWith("hype_train_")) b.hype_train_level = Math.max(b.hype_train_level, Number(t.level) || 0);
    if (event.kind === "ad_break") b.ad_seconds += Number(t.duration_seconds) || 0;
    if (event.kind === "raid_out") {
      b.raids_out += 1;
      b.raid_viewers_out += Number(t.viewers) || 0;
    }
    if (event.kind === "shoutout_in") b.shoutouts_in += 1;
    if (event.kind === "shoutout_out") b.shoutouts_out += 1;
  }

  return Object.freeze({
    /** A normalized item: { kind: "attention" | "channel", event }. */
    observe(item) {
      if (item?.kind === "attention") attention(item.event);
      else if (item?.kind === "channel") channel(item.event);
    },

    /** Helix samples. `liveNow` true/false/null; viewers only while live. */
    sample(time, { liveNow = null, viewers = null, followersTotal = null, trackedLive = null, trackedViewers = null } = {}) {
      const b = bucket(time);
      if (liveNow !== null) {
        live = Boolean(liveNow);
        b.live = live;
      }
      if (viewers !== null) b.viewers = viewers;
      if (followersTotal !== null) b.followers_total = followersTotal;
      if (trackedLive !== null) b.tracked_live = trackedLive;
      if (trackedViewers !== null) b.tracked_viewers = trackedViewers;
    },

    /** Called on a fixed interval; connected seconds become the minute's coverage. */
    tick(time, { connected, seconds }) {
      const b = bucket(time);
      if (b.live === null && live !== null) b.live = live;
      if (connected) b.covered_seconds = Math.min(60, b.covered_seconds + seconds);
    },

    /** Remove and return every finished minute (strictly before `time`), oldest first. */
    flush(time) {
      const current = minuteOf(time);
      const done = [...buckets.keys()].filter((minute) => minute < current).sort();
      return done.map((minute) => {
        const b = buckets.get(minute);
        buckets.delete(minute);
        const { chatters, covered_seconds, ...rest } = b;
        return Object.freeze({ ...rest, distinct_chatters: chatters.size, coverage: Math.round((covered_seconds / 60) * 100) / 100 });
      });
    },

    pending: () => buckets.size,
  });
}
