/** Extracted from wzrd-final crates/stream/src/twitch.rs parse_irc_line. No logins or legacy weights. */

import { createHash, createHmac } from "node:crypto";

import { fromTwitchEngagement } from "./twitch.js";

function parseTags(tagstr) {
  const tags = {};
  for (const pair of tagstr.split(";")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    tags[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return tags;
}
function prefixUser(prefix) {
  return prefix.split("!")[0] || "";
}
function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export const PARTICIPANT_KEY_MIN_LENGTH = 32;

/**
 * Returns the key, or null when none is set. A set key that is too short is an operator mistake and
 * throws at setup. Twitch user ids are public and enumerable, so an unkeyed hash of one is reversible
 * by lookup; participant ids therefore exist only when a server-held secret keys them.
 */
export function assertParticipantKey(key) {
  if (key === undefined || key === null || key === "") return null;
  if (typeof key !== "string" || key.length < PARTICIPANT_KEY_MIN_LENGTH) {
    throw new TypeError(`participantKey must be a string of at least ${PARTICIPANT_KEY_MIN_LENGTH} characters`);
  }
  return key;
}

/** Keyed, domain-separated pseudonym. No key means no id (null): never fall back to an unkeyed hash. */
export function hashParticipant(userId, login, key) {
  if (!key) return null;
  const raw = userId ? `id:${userId}` : login ? `login:${login}` : null;
  if (!raw) return null;
  const digest = createHmac("sha256", key).update(`radio-lan/participant/v1\0${raw}`).digest("hex");
  return `user-hmac:${digest.slice(0, 32)}`;
}
function isoFromTags(tags, fallbackIso) {
  const ms = Number(tags["tmi-sent-ts"]);
  if (Number.isFinite(ms) && ms > 0) {
    const timestamp = new Date(ms);
    if (!Number.isNaN(timestamp.valueOf())) return timestamp.toISOString();
  }
  return fallbackIso;
}
export function parseTwitchIrcLine(line, observedAt = new Date().toISOString(), { participantKey = null } = {}) {
  const trimmed = String(line ?? "").replace(/[\r\n]+$/g, "");
  if (!trimmed) return null;
  let rest = trimmed;
  let tags = {};
  if (trimmed.startsWith("@")) {
    const sp = trimmed.indexOf(" ");
    if (sp < 0) return null;
    tags = parseTags(trimmed.slice(1, sp));
    rest = trimmed.slice(sp + 1);
  }
  const parts = rest.split(/\s+/);
  if (parts.length === 0) return null;
  let i = 0;
  let prefix = "";
  if (parts[0].startsWith(":")) {
    prefix = parts[0].slice(1);
    i += 1;
    if (i >= parts.length) return null;
  }
  const cmd = parts[i++];
  const login = tags.login || (prefix ? prefixUser(prefix) : "");
  const userId = tags["user-id"] || "";
  const created_at = isoFromTags(tags, observedAt);
  const participant_id = hashParticipant(userId, login, participantKey);

  if (cmd === "PRIVMSG") {
    if (i >= parts.length) return null;
    const chan = parts[i].replace(/^#/, "");
    const channel_id = tags["room-id"] || chan;
    const bits = Number(tags.bits);
    const cheer = Number.isFinite(bits) && bits > 0;
    const kind = cheer ? "cheer" : "chat";
    return {
      id: tags.id || `${channel_id}:${created_at}:${kind}:${shortHash(trimmed)}`,
      channel_id,
      kind,
      created_at,
      participant_id,
      bits: cheer ? bits : 0,
      evidence_method: "irc_observation",
    };
  }
  if (cmd === "USERNOTICE") {
    if (i >= parts.length) return null;
    const chan = parts[i].replace(/^#/, "");
    const msgid = tags["msg-id"] || "";
    const mapped =
      msgid === "sub" || msgid === "resub"
        ? msgid
        : msgid === "subgift" || msgid === "submysterygift"
          ? "subgift"
          : msgid === "raid"
            ? "raid"
            : null;
    if (!mapped) return null;
    const channel_id = tags["room-id"] || chan;
    return {
      id: tags.id || `${channel_id}:${created_at}:${mapped}:${shortHash(trimmed)}`,
      channel_id,
      kind: mapped,
      created_at,
      participant_id,
      bits: 0,
      evidence_method: "irc_observation",
    };
  }

  return null;
}

export function fromTwitchIrcLine(line, observedAt, options) {
  const parsed = parseTwitchIrcLine(line, observedAt, options);
  return parsed ? fromTwitchEngagement(parsed) : null;
}
