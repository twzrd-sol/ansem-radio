/**
 * EventSub notification -> attention event (one person did something) or channel
 * event (the channel changed), per docs/twitch/TIMELINE_DESIGN.md. Pure; no I/O.
 *
 * Dropped at this boundary, always: chat and cheer message text, redemption
 * user_input, logins and display names, and any "top predictors" or "top
 * contributions" list. A person appears only as the keyed user-hmac id, and only
 * when a participant key is set (same pseudonym as the IRC path).
 */

import { createAttentionEvent } from "../core/attention-event.js";
import { createChannelEvent } from "../core/channel-event.js";
import { hashParticipant } from "./twitch-irc.js";

/** Subscriptions the timeline creates, with versions current on 2026-10-01 (DEV_DOCS_DIGEST.md section 2). */
export const TIMELINE_SUBSCRIPTIONS = Object.freeze([
  { type: "stream.online", version: "1" },
  { type: "stream.offline", version: "1" },
  { type: "channel.update", version: "2" },
  { type: "channel.follow", version: "2", moderator: true },
  { type: "channel.subscribe", version: "1" },
  { type: "channel.subscription.gift", version: "1" },
  { type: "channel.subscription.message", version: "1" },
  // channel.bits.use covers cheers and Power-ups; channel.cheer would double count.
  { type: "channel.bits.use", version: "1" },
  { type: "channel.raid", version: "1", direction: "to" },
  { type: "channel.raid", version: "1", direction: "from" },
  { type: "channel.prediction.begin", version: "1" },
  { type: "channel.prediction.progress", version: "1" },
  { type: "channel.prediction.lock", version: "1" },
  { type: "channel.prediction.end", version: "1" },
  { type: "channel.poll.begin", version: "1" },
  { type: "channel.poll.progress", version: "1" },
  { type: "channel.poll.end", version: "1" },
  { type: "channel.channel_points_custom_reward_redemption.add", version: "1" },
  { type: "channel.channel_points_automatic_reward_redemption.add", version: "2" },
  { type: "channel.hype_train.begin", version: "2" },
  { type: "channel.hype_train.progress", version: "2" },
  { type: "channel.hype_train.end", version: "2" },
  { type: "channel.goal.begin", version: "1" },
  { type: "channel.goal.progress", version: "1" },
  { type: "channel.goal.end", version: "1" },
  { type: "channel.ad_break.begin", version: "1" },
  { type: "channel.shoutout.create", version: "1", moderator: true },
  { type: "channel.shoutout.receive", version: "1", moderator: true },
]);

/** The `condition` object for one subscription on the broadcaster's own channel. */
export function subscriptionCondition(spec, broadcasterId) {
  if (spec.type === "channel.raid") {
    return spec.direction === "from" ? { from_broadcaster_user_id: broadcasterId } : { to_broadcaster_user_id: broadcasterId };
  }
  return spec.moderator
    ? { broadcaster_user_id: broadcasterId, moderator_user_id: broadcasterId }
    : { broadcaster_user_id: broadcasterId };
}

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

function outcomesFrom(list, fields) {
  return (Array.isArray(list) ? list : []).slice(0, 10).map((item) => ({
    label: String(item?.title ?? "outcome"),
    totals: Object.fromEntries(fields.map(([from, to]) => [to, count(item?.[from])])),
  }));
}

/**
 * Normalize one EventSub WebSocket notification. Returns
 * { kind: "attention" | "channel", event } or null for a type the timeline ignores.
 * Throws TypeError on a malformed notification.
 */
export function fromEventSubNotification(message, { participantKey = null } = {}) {
  const metadata = message?.metadata;
  const event = message?.payload?.event;
  if (metadata?.message_type !== "notification" || !event || typeof metadata.message_id !== "string") {
    throw new TypeError("an EventSub notification with metadata and payload.event is required");
  }
  const type = metadata.subscription_type;
  const observedAt = metadata.message_timestamp;
  const id = `twitch-eventsub:${metadata.message_id}`;
  // A raid carries both ends; the subscription condition says which end is ours.
  const raidOutgoing = type === "channel.raid" && Boolean(message.payload.subscription?.condition?.from_broadcaster_user_id);
  const channelId = String(
    event.broadcaster_user_id ?? (raidOutgoing ? event.from_broadcaster_user_id : event.to_broadcaster_user_id) ?? "",
  );
  if (!channelId) throw new TypeError(`${type}: no broadcaster id`);
  const source_id = `channel:${channelId}`;
  const evidence = { method: "eventsub_websocket", provider_message_id: metadata.message_id, subscription: `${type}@${metadata.subscription_version}` };
  const person = (userId) => hashParticipant(userId ? String(userId) : null, null, participantKey);

  const attention = (signal, userId, extra = {}) => ({
    kind: "attention",
    event: createAttentionEvent({ id, provider: "twitch", source_id, signal, observed_at: observedAt, participant_id: person(userId), content_id: extra.content_id ?? null, evidence, metadata: extra.metadata ?? {} }),
  });
  const channel = (kind, extra = {}) => ({
    kind: "channel",
    event: createChannelEvent({ id, provider: "twitch", source_id, kind, observed_at: observedAt, content_id: extra.content_id ?? null, totals: extra.totals ?? {}, labels: extra.labels ?? {}, outcomes: extra.outcomes, evidence }),
  });

  switch (type) {
    case "stream.online":
      return channel("stream_online", { content_id: event.id ? `stream:${event.id}` : null, labels: event.type ? { stream_type: String(event.type) } : {} });
    case "stream.offline":
      return channel("stream_offline", { content_id: event.id ? `stream:${event.id}` : null });
    case "channel.update":
      return channel("channel_update", {
        labels: Object.fromEntries([["title", event.title], ["category_name", event.category_name], ["language", event.language]].filter(([, v]) => typeof v === "string" && v.trim() !== "")),
      });
    case "channel.follow":
      return attention("follow", event.user_id);
    case "channel.subscribe":
      return attention("subscription", event.user_id, { metadata: { twitch_kind: "sub", tier: String(event.tier ?? ""), is_gift: Boolean(event.is_gift) } });
    case "channel.subscription.gift":
      return attention("subscription", event.is_anonymous ? null : event.user_id, { metadata: { twitch_kind: "subgift", tier: String(event.tier ?? ""), gifts: count(event.total) } });
    case "channel.subscription.message":
      return attention("subscription", event.user_id, { metadata: { twitch_kind: "resub", tier: String(event.tier ?? ""), cumulative_months: count(event.cumulative_months) } });
    case "channel.bits.use":
      return attention("cheer", event.user_id, { metadata: { twitch_kind: String(event.type ?? "cheer"), bits: count(event.bits) } });
    case "channel.raid":
      return raidOutgoing
        ? channel("raid_out", { totals: { viewers: count(event.viewers) } })
        : attention("raid", event.from_broadcaster_user_id, { metadata: { twitch_kind: "raid", viewers: count(event.viewers) } });
    case "channel.prediction.begin":
    case "channel.prediction.progress":
    case "channel.prediction.lock":
    case "channel.prediction.end": {
      const stage = type.split(".").pop();
      return channel(`prediction_${stage}`, {
        content_id: event.id ? `prediction:${event.id}` : null,
        labels: Object.fromEntries([["title", event.title], ["status", event.status]].filter(([, v]) => typeof v === "string" && v !== "")),
        outcomes: outcomesFrom(event.outcomes, [["channel_points", "points"], ["users", "users"]]),
        totals: {
          points_total: (Array.isArray(event.outcomes) ? event.outcomes : []).reduce((sum, o) => sum + count(o?.channel_points), 0),
          outcomes: Array.isArray(event.outcomes) ? event.outcomes.length : 0,
        },
      });
    }
    case "channel.poll.begin":
    case "channel.poll.progress":
    case "channel.poll.end": {
      const stage = type.split(".").pop();
      return channel(`poll_${stage}`, {
        content_id: event.id ? `poll:${event.id}` : null,
        labels: Object.fromEntries([["title", event.title], ["status", event.status]].filter(([, v]) => typeof v === "string" && v !== "")),
        outcomes: outcomesFrom(event.choices, [["votes", "votes"], ["channel_points_votes", "points_votes"], ["bits_votes", "bits_votes"]]),
      });
    }
    case "channel.channel_points_custom_reward_redemption.add":
      return attention("redemption", event.user_id, { metadata: { twitch_kind: "custom_reward", cost: count(event.reward?.cost), reward_title: String(event.reward?.title ?? "").slice(0, 80) } });
    case "channel.channel_points_automatic_reward_redemption.add":
      return attention("redemption", event.user_id, { metadata: { twitch_kind: "automatic_reward", reward_type: String(event.reward?.type ?? ""), cost: count(event.reward?.channel_points ?? event.reward?.cost) } });
    case "channel.hype_train.begin":
    case "channel.hype_train.progress":
    case "channel.hype_train.end": {
      const stage = type.split(".").pop();
      return channel(`hype_train_${stage}`, { content_id: event.id ? `hype_train:${event.id}` : null, totals: { total: count(event.total), progress: count(event.progress), goal: count(event.goal), level: count(event.level) } });
    }
    case "channel.goal.begin":
    case "channel.goal.progress":
    case "channel.goal.end": {
      const stage = type.split(".").pop();
      return channel(`goal_${stage}`, {
        content_id: event.id ? `goal:${event.id}` : null,
        labels: event.type ? { goal_type: String(event.type) } : {},
        totals: { current_amount: count(event.current_amount), target_amount: count(event.target_amount) },
      });
    }
    case "channel.ad_break.begin":
      return channel("ad_break", { totals: { duration_seconds: count(event.duration_seconds) }, labels: { automatic: event.is_automatic ? "yes" : "no" } });
    case "channel.shoutout.create":
      return channel("shoutout_out", { totals: { viewer_count: count(event.viewer_count) } });
    case "channel.shoutout.receive":
      return channel("shoutout_in", { totals: { viewer_count: count(event.viewer_count) } });
    default:
      return null;
  }
}
