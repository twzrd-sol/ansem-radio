import assert from "node:assert/strict";
import test from "node:test";

import { TIMELINE_SUBSCRIPTIONS, fromEventSubNotification, subscriptionCondition } from "../src/providers/twitch-eventsub.js";

const KEY = "k".repeat(32);
const US = "1001";

// Synthetic payloads exercise the supported EventSub fields.
function note(type, version, event, condition = { broadcaster_user_id: US }) {
  return {
    metadata: { message_id: `m-${type}`, message_type: "notification", message_timestamp: "2026-10-01T20:00:00.123456789Z", subscription_type: type, subscription_version: version },
    payload: { subscription: { type, version, condition }, event },
  };
}
const viewer = { user_id: "555", user_login: "somefan", user_name: "SomeFan" };
const norm = (n, options = { participantKey: KEY }) => fromEventSubNotification(n, options);

test("a follow becomes a keyed attention event with no login anywhere", () => {
  const out = norm(note("channel.follow", "2", { ...viewer, broadcaster_user_id: US, followed_at: "2026-10-01T20:00:00Z" }));
  assert.equal(out.kind, "attention");
  assert.equal(out.event.signal, "follow");
  assert.match(out.event.participant_id, /^user-hmac:[0-9a-f]{32}$/);
  assert.equal(out.event.source_id, `channel:${US}`);
  assert.equal(out.event.observed_at, "2026-10-01T20:00:00.123Z");
  assert.equal(JSON.stringify(out).includes("somefan") || JSON.stringify(out).includes("SomeFan"), false);
  // Without a key there is no id at all, never an unkeyed hash.
  assert.equal(norm(note("channel.follow", "2", { ...viewer, broadcaster_user_id: US }), {}).event.participant_id, null);
});

test("cheer, subscription and redemption text is dropped; counts and tiers stay", () => {
  const bits = norm(note("channel.bits.use", "1", { ...viewer, broadcaster_user_id: US, bits: 250, type: "cheer", message: { text: "cheer250 secret words" } }));
  assert.equal(bits.event.signal, "cheer");
  assert.equal(bits.event.metadata.bits, 250);
  const resub = norm(note("channel.subscription.message", "1", { ...viewer, broadcaster_user_id: US, tier: "1000", cumulative_months: 7, message: { text: "seven months!" } }));
  assert.equal(resub.event.metadata.cumulative_months, 7);
  const redeem = norm(note("channel.channel_points_custom_reward_redemption.add", "1", { ...viewer, broadcaster_user_id: US, id: "r1", user_input: "play my song", status: "unfulfilled", reward: { id: "rw", title: "Hydrate", cost: 500 } }));
  assert.equal(redeem.event.signal, "redemption");
  assert.equal(redeem.event.metadata.cost, 500);
  const all = JSON.stringify([bits, resub, redeem]);
  for (const secret of ["secret words", "seven months!", "play my song", "somefan"]) assert.equal(all.includes(secret), false, secret);
});

test("anonymous gifts carry no participant", () => {
  const gift = norm(note("channel.subscription.gift", "1", { user_id: null, user_login: null, broadcaster_user_id: US, total: 5, tier: "1000", is_anonymous: true }));
  assert.equal(gift.event.participant_id, null);
  assert.equal(gift.event.metadata.gifts, 5);
});

test("raids: incoming is an attention event from the raiding channel, outgoing is raid_out on ours", () => {
  const raid = { from_broadcaster_user_id: "2002", from_broadcaster_user_login: "otherstreamer", to_broadcaster_user_id: US, to_broadcaster_user_login: "radiolanlive", viewers: 42 };
  const incoming = norm(note("channel.raid", "1", raid, { to_broadcaster_user_id: US }));
  assert.equal(incoming.kind, "attention");
  assert.equal(incoming.event.signal, "raid");
  assert.equal(incoming.event.source_id, `channel:${US}`);
  assert.equal(incoming.event.metadata.viewers, 42);
  const outgoing = norm(note("channel.raid", "1", { ...raid, from_broadcaster_user_id: US, to_broadcaster_user_id: "2002" }, { from_broadcaster_user_id: US }));
  assert.equal(outgoing.kind, "channel");
  assert.equal(outgoing.event.kind, "raid_out");
  assert.equal(outgoing.event.source_id, `channel:${US}`);
  assert.equal(outgoing.event.totals.viewers, 42);
  assert.equal(JSON.stringify(outgoing).includes("otherstreamer"), false);
});

test("predictions keep outcome totals and drop the top predictors", () => {
  const out = norm(note("channel.prediction.progress", "1", {
    id: "p1", broadcaster_user_id: US, title: "Does the raid land?",
    outcomes: [
      { id: "a", title: "Yes", color: "blue", users: 30, channel_points: 9000, top_predictors: [{ user_id: "9", user_login: "whale", channel_points_used: 5000 }] },
      { id: "b", title: "No", color: "pink", users: 12, channel_points: 3000, top_predictors: [] },
    ],
  }));
  assert.equal(out.event.kind, "prediction_progress");
  assert.equal(out.event.totals.points_total, 12000);
  assert.deepEqual(out.event.outcomes.map((o) => [o.label, o.totals.points, o.totals.users]), [["Yes", 9000, 30], ["No", 3000, 12]]);
  assert.equal(JSON.stringify(out).includes("whale"), false);
});

test("polls, hype trains, goals, ads, shoutouts and stream state map to channel events", () => {
  const poll = norm(note("channel.poll.end", "1", { id: "q", broadcaster_user_id: US, title: "Next theme", status: "completed", choices: [{ id: "1", title: "Jungle", votes: 9, channel_points_votes: 2, bits_votes: 0 }] }));
  assert.equal(poll.event.outcomes[0].totals.votes, 9);
  const hype = norm(note("channel.hype_train.progress", "2", { id: "h", broadcaster_user_id: US, total: 700, progress: 200, goal: 1800, level: 2, top_contributions: [{ user_id: "9", user_login: "whale", type: "bits", total: 500 }] }));
  assert.deepEqual(hype.event.totals, { total: 700, progress: 200, goal: 1800, level: 2 });
  assert.equal(JSON.stringify(hype).includes("whale"), false);
  const goal = norm(note("channel.goal.progress", "1", { id: "g", broadcaster_user_id: US, type: "follower", current_amount: 20, target_amount: 25 }));
  assert.equal(goal.event.labels.goal_type, "follower");
  const ad = norm(note("channel.ad_break.begin", "1", { broadcaster_user_id: US, duration_seconds: 90, is_automatic: true, requester_user_id: "9", requester_user_login: "mod" }));
  assert.deepEqual([ad.event.totals.duration_seconds, ad.event.labels.automatic], [90, "yes"]);
  assert.equal(JSON.stringify(ad).includes("\"mod\""), false);
  const so = norm(note("channel.shoutout.receive", "1", { broadcaster_user_id: US, from_broadcaster_user_id: "3", viewer_count: 120 }));
  assert.equal(so.event.kind, "shoutout_in");
  const online = norm(note("stream.online", "1", { id: "s9", broadcaster_user_id: US, type: "live", started_at: "2026-10-01T20:00:00Z" }));
  assert.deepEqual([online.event.kind, online.event.content_id], ["stream_online", "stream:s9"]);
  const update = norm(note("channel.update", "2", { broadcaster_user_id: US, title: "Radio LAN live", category_name: "Just Chatting", language: "en" }));
  assert.deepEqual(update.event.labels, { title: "Radio LAN live", category_name: "Just Chatting", language: "en" });
});

test("unknown types are ignored and malformed messages are refused", () => {
  assert.equal(norm(note("channel.vip.add", "1", { broadcaster_user_id: US, ...viewer })), null);
  assert.throws(() => norm({ metadata: { message_type: "session_keepalive" } }), TypeError);
  assert.throws(() => norm(note("channel.follow", "2", { ...viewer })), /no broadcaster id/);
});

test("subscriptions: 28 on our own channel, moderator conditions use the broadcaster, raids both ways", () => {
  assert.equal(TIMELINE_SUBSCRIPTIONS.length, 28);
  assert.equal(TIMELINE_SUBSCRIPTIONS.some((s) => s.type === "channel.cheer" || s.type === "channel.chat.message"), false);
  const follow = TIMELINE_SUBSCRIPTIONS.find((s) => s.type === "channel.follow");
  assert.deepEqual(subscriptionCondition(follow, US), { broadcaster_user_id: US, moderator_user_id: US });
  const raids = TIMELINE_SUBSCRIPTIONS.filter((s) => s.type === "channel.raid").map((s) => subscriptionCondition(s, US));
  assert.deepEqual(raids, [{ to_broadcaster_user_id: US }, { from_broadcaster_user_id: US }]);
  const hype = TIMELINE_SUBSCRIPTIONS.find((s) => s.type === "channel.hype_train.begin");
  assert.equal(hype.version, "2");
});
