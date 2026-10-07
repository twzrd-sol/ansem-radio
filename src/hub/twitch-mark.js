import { HttpError, isLocalRequest, readJson } from "../platform/guard.js";
import { actionId, twitchPointsEnabled } from "./points.js";

const CREATOR = /^[a-z0-9_]{3,25}$/;
const EVENT_ID = /^[0-9a-f]{64}$/;

/** Resolve one public stream occurrence from the station's existing Helix sample record. */
export function twitchStreamEventId(creator, startedAt) {
  return actionId(["radiolan-twitch-stream-v1", creator, new Date(startedAt).toISOString()]);
}

export function resolveTwitchStreamEvent(store, { creator, eventId, since }) {
  if (!store) return null;
  for (const sample of store.readSamples({ since: since * 1000, login: creator })) {
    const start = Date.parse(sample.started_at), observed = Date.parse(sample.at);
    if (sample.login !== creator || sample.is_live !== true || !Number.isFinite(start) || !Number.isFinite(observed)) continue;
    if (twitchStreamEventId(creator, start) !== eventId) continue;
    return { id: eventId, source: "twitch", subjectId: creator, kind: "stream_online",
      occurredAt: Math.floor(start / 1000), observedAt: Math.floor(observed / 1000), strength: "provider_reported" };
  }
  return null;
}

/** The event resolver is trusted server state; request bodies cannot supply evidence. */
export function createTwitchMarkRoutes({ store, config, listings, points, writeLimit, now, resolveEvent = () => null }) {
  const local = (request) => {
    if (request.headers["cf-connecting-ip"] !== undefined || !isLocalRequest(request)) throw new HttpError(403, "not_local");
    if (!twitchPointsEnabled()) throw new HttpError(409, "twitch_points_off");
    const c = config();
    if (!c) throw new HttpError(409, "no_season");
    return c;
  };
  const subject = (creator) => {
    if (typeof creator !== "string" || !CREATOR.test(creator)) throw new HttpError(400, "creator_required");
    if (!listings().some((e) => String(e.twitch ?? "").toLowerCase() === creator)) throw new HttpError(404, "not_tracked");
    return creator;
  };
  const account = (c, creator) => actionId(["radiolan-twitch-mark", c.season, creator]);
  return {
    "POST /hub/api/twitch-mark": async (request) => {
      const c = local(request);
      if (!writeLimit("twitch-mark-local")) throw new HttpError(429, "slow_down");
      if (now() < c.startsAt || now() >= c.endsAt) throw new HttpError(409, "season_not_open");
      const weight = c.policy.weights.twitch_mark;
      if (!Number.isInteger(weight) || weight <= 0) throw new HttpError(409, "twitch_weight_required");
      const body = await readJson(request, 1024);
      if (Object.keys(body).some((k) => !["creator", "eventId"].includes(k))) throw new HttpError(400, "unknown_field");
      const creator = subject(typeof body.creator === "string" ? body.creator.trim().toLowerCase() : body.creator);
      if (typeof body.eventId !== "string" || !EVENT_ID.test(body.eventId)) throw new HttpError(400, "event_id_required");
      const accountId = account(c, creator), id = actionId([c.season, "twitch_mark", creator, body.eventId]);
      // No await between the durable duplicate check and append: concurrent HTTP retries cannot both write.
      const previous = store.submissions().find((s) => s.id === id);
      if (previous) return { awarded: "0", points: points(accountId), duplicate: true };
      const e = resolveEvent({ creator, eventId: body.eventId, since: c.startsAt });
      if (!e || e.id !== body.eventId || e.source !== "twitch" || e.subjectId !== creator || e.kind !== "stream_online"
        || e.strength !== "provider_reported" || !Number.isSafeInteger(e.occurredAt) || !Number.isSafeInteger(e.observedAt)
        || e.occurredAt < c.startsAt || e.occurredAt >= c.endsAt || e.observedAt < e.occurredAt || e.observedAt > now()) {
        throw new HttpError(409, "twitch_event_required");
      }
      const before = BigInt(points(accountId));
      store.addSubmission({ id, accountId, season: c.season, action: "twitch_mark", source: "twitch", actionId: id,
        occurredAt: e.occurredAt, status: "credited", detail: { eventId: e.id, observedAt: e.observedAt, evidenceStrength: e.strength } });
      const after = points(accountId);
      return { awarded: (BigInt(after) - before).toString(), points: after, duplicate: false };
    },
    "GET /hub/api/twitch-mark": (request) => {
      const c = local(request);
      const creator = subject(new URL(request.url, "http://127.0.0.1").searchParams.get("creator"));
      return { points: points(account(c, creator)) };
    },
  };
}
