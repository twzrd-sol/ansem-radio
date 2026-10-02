import { createAttentionEvent } from "../core/attention-event.js";

const signalByKind = Object.freeze({
  chat: "chat",
  cheer: "cheer",
  sub: "subscription",
  resub: "subscription",
  subgift: "subscription",
  raid: "raid",
});

function requiredId(value, field) {
  if ((typeof value !== "string" && typeof value !== "number") || `${value}` === "") {
    throw new TypeError(`${field} must be a string or number`);
  }
  return `${value}`;
}

export function fromTwitchEngagement(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("input must be an object");
  }

  const signal = signalByKind[input.kind];
  if (!signal) {
    throw new TypeError(`unsupported Twitch engagement kind: ${input.kind}`);
  }

  const eventId = requiredId(input.id, "id");
  const channelId = requiredId(input.channel_id, "channel_id");

  return createAttentionEvent({
    id: `twitch:${eventId}`,
    provider: "twitch",
    source_id: `channel:${channelId}`,
    signal,
    observed_at: input.created_at,
    participant_id: input.participant_id ?? null,
    content_id: input.stream_id ? `stream:${input.stream_id}` : null,
    evidence: {
      method: input.evidence_method ?? "twitch_observation",
      provider_event_id: eventId,
    },
    metadata: {
      twitch_kind: input.kind,
      bits: input.bits ?? 0,
    },
  });
}
