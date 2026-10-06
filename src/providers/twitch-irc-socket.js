/**
 * Twitch IRC WebSocket. Receive-only unless created with allowSend: true, in which case
 * say() sends PRIVMSG under a per-account bucket (Twitch: 20 messages / 30 s for a
 * non-moderator). Credentials are injected and never exposed.
 */

export const DEFAULT_SEND_LIMIT = Object.freeze({ messages: 20, windowMs: 30_000 });
export const MAX_IRC_MESSAGE_CHARS = 500;

import {
  ircPongFor,
  nextIrcBackoffSeconds,
  reconcileIrcJoins,
  snapshotTwitchIngestHealth,
} from "./twitch-ingest.js";
import { assertParticipantKey, fromTwitchIrcLine } from "./twitch-irc.js";

export const TWITCH_IRC_WEBSOCKET_URL = "wss://irc-ws.chat.twitch.tv:443";
const CAPABILITIES = "twitch.tv/tags twitch.tv/commands";

function ircLogin(value, field = "login") {
  const login = String(value ?? "").trim().replace(/^#/, "").toLowerCase();
  if (!/^[a-z0-9_]{4,25}$/.test(login)) {
    throw new TypeError(`${field} must be a Twitch login`);
  }
  return login;
}

function oauthToken(value) {
  const token = String(value ?? "").trim().replace(/^oauth:/i, "");
  if (!token || /[\s\r\n]/.test(token)) {
    throw new TypeError("oauthToken must be a Twitch user access token");
  }
  return token;
}

function channelSet(channels) {
  if (!Array.isArray(channels)) throw new TypeError("channels must be an array");
  const normalized = [...new Set(channels.map((channel) => ircLogin(channel, "channel")))].sort();
  if (normalized.length === 0) throw new TypeError("at least one Twitch channel is required");
  return normalized;
}

export function createTwitchIrcSocket({
  login,
  oauthToken: tokenInput,
  channels,
  onEvent,
  onState = () => {},
  WebSocketImpl = globalThis.WebSocket,
  clock = Date.now,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => clearTimeout(timer),
  url = TWITCH_IRC_WEBSOCKET_URL,
  allowSend = false,
  sendLimit = DEFAULT_SEND_LIMIT,
  participantKey = null,
}) {
  const nick = ircLogin(login);
  const keyedParticipants = { participantKey: assertParticipantKey(participantKey) };
  const limit = {
    messages: Math.max(1, Number(sendLimit?.messages) || DEFAULT_SEND_LIMIT.messages),
    windowMs: Math.max(1000, Number(sendLimit?.windowMs) || DEFAULT_SEND_LIMIT.windowMs),
  };
  const sentAt = [];
  const token = oauthToken(tokenInput);
  if (typeof onEvent !== "function") throw new TypeError("onEvent must be a function");
  if (typeof WebSocketImpl !== "function") throw new TypeError("WebSocket is unavailable");

  let desired = channelSet(channels);
  let joined = [];
  let socket = null;
  let retryTimer = null;
  let retrySeconds = 1;
  let active = false;
  let authenticated = false;
  let capabilityAck = new Set();
  let receiveBuffer = "";
  let reconnectImmediately = false;
  const health = {
    irc_connected: false,
    total_events: 0,
    last_event_at: null,
    last_join_reconcile_at: null,
    last_error: null,
    last_flush_error: null,
    cursor: null,
    total_sent: 0,
  };

  const nowIso = () => new Date(clock()).toISOString();
  const state = () => snapshotTwitchIngestHealth({
    ...health,
    enabled: active,
    curated_logins: desired,
  }, clock());
  const emitState = () => {
    try {
      onState(state());
    } catch {
      // Health observers must never break the socket.
    }
  };
  const send = (line) => {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(line.endsWith("\r\n") ? line : `${line}\r\n`);
      return true;
    } catch {
      health.last_error = "irc_send_failed";
      emitState();
      return false;
    }
  };

  const reconcile = () => {
    if (!health.irc_connected) return;
    const plan = reconcileIrcJoins(joined, desired);
    if (plan.part.length) send(`PART ${plan.part.map((item) => `#${item}`).join(",")}`);
    if (plan.join.length) send(`JOIN ${plan.join.map((item) => `#${item}`).join(",")}`);
    joined = [...plan.next_joined];
    if (plan.part.length || plan.join.length) health.last_join_reconcile_at = nowIso();
    emitState();
  };

  const markReady = () => {
    if (!authenticated || !capabilityAck.has("tags") || !capabilityAck.has("commands")) return;
    health.irc_connected = true;
    health.last_error = null;
    retrySeconds = 1;
    reconcile();
  };

  const stopFor = (errorCode) => {
    active = false;
    health.irc_connected = false;
    health.last_error = errorCode;
    if (socket && socket.readyState < 2) socket.close(1000, errorCode);
    emitState();
  };

  const handleLine = (line) => {
    if (!line) return;
    const pong = ircPongFor(line);
    if (pong) {
      send(pong);
      return;
    }
    // Control lines come from the server prefix only. A chat message that merely contains this text is not one,
    // so a viewer cannot stop the session by typing it.
    if (line.startsWith(":tmi.twitch.tv CAP * NAK ")) {
      stopFor("twitch_capability_rejected");
      return;
    }
    if (line.startsWith(":tmi.twitch.tv NOTICE * :Login authentication failed") ||
        line.startsWith(":tmi.twitch.tv NOTICE * :Improperly formatted auth")) {
      stopFor("twitch_auth_failed");
      return;
    }
    if (!authenticated && line.startsWith(":tmi.twitch.tv NOTICE * :")) {
      stopFor("twitch_login_notice");
      return;
    }
    if (line.startsWith(":tmi.twitch.tv CAP * ACK ")) {
      if (line.includes("twitch.tv/tags")) capabilityAck.add("tags");
      if (line.includes("twitch.tv/commands")) capabilityAck.add("commands");
      markReady();
      return;
    }
    if (/^:tmi\.twitch\.tv 001 /.test(line)) {
      authenticated = true;
      markReady();
      return;
    }
    if (line === ":tmi.twitch.tv RECONNECT") {
      reconnectImmediately = true;
      if (socket?.readyState < 2) socket.close(1000, "server_reconnect");
      return;
    }
    if (!health.irc_connected) return;
    const event = fromTwitchIrcLine(line, nowIso(), keyedParticipants);
    if (!event) return;
    try {
      onEvent(event);
      health.last_flush_error = null;
    } catch {
      health.last_flush_error = "event_handler_failed";
    }
    health.total_events += 1;
    health.last_event_at = event.observed_at;
    emitState();
  };

  const handleMessage = (data) => {
    if (typeof data !== "string") {
      health.last_error = "irc_non_text_frame";
      emitState();
      return;
    }
    receiveBuffer += data;
    if (receiveBuffer.length > 65_536) {
      receiveBuffer = "";
      health.last_error = "irc_frame_too_large";
      emitState();
      return;
    }
    const lines = receiveBuffer.split(/\r?\n/);
    receiveBuffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  };

  const scheduleReconnect = () => {
    if (!active || retryTimer) return;
    const delayMs = reconnectImmediately ? 0 : retrySeconds * 1000;
    reconnectImmediately = false;
    if (delayMs > 0) retrySeconds = nextIrcBackoffSeconds(retrySeconds);
    retryTimer = schedule(() => {
      retryTimer = null;
      connect();
    }, delayMs);
  };

  const connect = () => {
    if (!active) return;
    authenticated = false;
    capabilityAck = new Set();
    receiveBuffer = "";
    joined = [];
    let current;
    try {
      current = new WebSocketImpl(url);
    } catch {
      health.last_error = "irc_connect_failed";
      emitState();
      scheduleReconnect();
      return;
    }
    socket = current;
    current.addEventListener("open", () => {
      if (!active || socket !== current) return;
      send(`PASS oauth:${token}`);
      send(`NICK ${nick}`);
      send(`CAP REQ :${CAPABILITIES}`);
    });
    current.addEventListener("message", (message) => {
      if (socket === current) handleMessage(message.data);
    });
    current.addEventListener("error", () => {
      if (socket !== current) return;
      health.last_error = "irc_socket_error";
      emitState();
    });
    current.addEventListener("close", () => {
      if (socket !== current) return;
      socket = null;
      health.irc_connected = false;
      emitState();
      scheduleReconnect();
    });
  };

  const start = () => {
    if (active) return state();
    active = true;
    health.last_error = null;
    connect();
    emitState();
    return state();
  };
  const stop = () => {
    active = false;
    if (retryTimer) cancel(retryTimer);
    retryTimer = null;
    health.irc_connected = false;
    if (socket && socket.readyState < 2) socket.close(1000, "client_stop");
    socket = null;
    emitState();
    return state();
  };
  const setChannels = (channelsNext) => {
    desired = channelSet(channelsNext);
    reconcile();
    return state();
  };

  /**
   * Send one chat line. Returns { sent, reason }; never throws on policy refusals.
   * Refuses when sending is disabled, the socket is not ready, the channel is not
   * joined, the text is empty or over 500 chars, or the bucket is full.
   */
  const say = (text, channel = desired[0]) => {
    if (!allowSend) return Object.freeze({ sent: false, reason: "send_disabled" });
    if (!health.irc_connected) return Object.freeze({ sent: false, reason: "not_connected" });
    let target;
    try {
      target = ircLogin(channel, "channel");
    } catch {
      return Object.freeze({ sent: false, reason: "channel_invalid" });
    }
    if (!joined.includes(target)) return Object.freeze({ sent: false, reason: "not_joined" });
    const body = String(text ?? "").replace(/[\r\n]+/g, " ").trim();
    if (!body) return Object.freeze({ sent: false, reason: "empty" });
    // Twitch treats a leading "/" or "." as a chat command (/ban, .timeout). Never send one.
    if (/^[./]/.test(body)) return Object.freeze({ sent: false, reason: "command_like" });
    if (body.length > MAX_IRC_MESSAGE_CHARS) return Object.freeze({ sent: false, reason: "too_long" });
    const now = clock();
    while (sentAt.length && now - sentAt[0] >= limit.windowMs) sentAt.shift();
    if (sentAt.length >= limit.messages) return Object.freeze({ sent: false, reason: "rate_limited" });
    if (!send(`PRIVMSG #${target} :${body}`)) return Object.freeze({ sent: false, reason: "irc_send_failed" });
    sentAt.push(now);
    health.total_sent += 1;
    emitState();
    return Object.freeze({ sent: true, reason: null });
  };

  return Object.freeze({ start, stop, setChannels, state, say, allowSend: Boolean(allowSend) });
}
