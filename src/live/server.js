import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { createChorus } from "../agents/chorus.js";
import { createStationIrcSession } from "./irc-session.js";
import { assertParticipantKey } from "../providers/twitch-irc.js";
import { fetchTwitchBoard } from "../markets/twitch-metrics.js";
import { createLedgerFeed } from "./ledger-feed.js";
import { createMarketFeed } from "./market-feed.js";
import { createObservationFeed } from "./observation-feed.js";
import { STATION_CHANNEL } from "./station.js";
import { createTwitchTokenManager } from "./twitch-token-manager.js";
import { createTimelineIngest } from "../timeline/ingest.js";
import { MACRO_NOTICE, isLoopbackHost, macroSnapshot, parseHours } from "../timeline/macro.js";
import { createTimelineStore } from "../timeline/store.js";

const STATIC_FILES = new Map([
  ["/public/live.html", [new URL("../../public/live.html", import.meta.url), "text/html; charset=utf-8"]],
  ["/public/macro.html", [new URL("../../public/macro.html", import.meta.url), "text/html; charset=utf-8"]],
  ["/src/live/station.js", [new URL("./station.js", import.meta.url), "text/javascript; charset=utf-8"]],
]);

export function encodeSseEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function envFlag(name) {
  return process.env[name] === "1";
}

/**
 * Live room. Observations and LAN notes as before; optionally a public market board
 * (RADIO_LAN_BOARD=1) and the agent chorus (RADIO_LAN_CHORUS=1). The chorus is dry-run
 * unless RADIO_LAN_CHORUS_SEND=1, which also opens the station IRC session for sending.
 * RADIO_LAN_LEDGER_PATH=<file> adds the session fund's public receipts;
 * without it the room shows no money surface at all.
 */
export function createLiveServer({
  oauthToken = process.env.TWITCH_IRC_OAUTH_TOKEN,
  refreshToken = process.env.TWITCH_IRC_REFRESH_TOKEN,
  clientId = process.env.TWITCH_CLIENT_ID,
  // Keys the chatter pseudonyms. Runtime secret only (the secrets manager), never in the repo. Unset means no participant ids.
  participantKey = process.env.RADIO_LAN_PARTICIPANT_KEY,
  login = process.env.TWITCH_IRC_LOGIN ?? STATION_CHANNEL,
  WebSocketImpl = globalThis.WebSocket,
  createIrcSession = createStationIrcSession,
  createTokenManager = createTwitchTokenManager,
  persistTokens = null,
  maxObservations = 12,
  enableBoard = envFlag("RADIO_LAN_BOARD"),
  createBoardFeed = createMarketFeed,
  boardFetch = undefined,
  boardIntervalMs = Number(process.env.RADIO_LAN_BOARD_INTERVAL_MS ?? 60_000),
  enableChorus = envFlag("RADIO_LAN_CHORUS"),
  chorusSend = envFlag("RADIO_LAN_CHORUS_SEND"),
  createChorusImpl = createChorus,
  chorusRows = 3,
  chorusGapMs = Number(process.env.RADIO_LAN_CHORUS_GAP_MS ?? 4000),
  maxTakes = 12,
  ledgerPath = process.env.RADIO_LAN_LEDGER_PATH,
  createLedgerFeedImpl = createLedgerFeed,
  ledgerIntervalMs = Number(process.env.RADIO_LAN_LEDGER_INTERVAL_MS ?? 15_000),
  // Internal timeline. Never broadcast to the overlay.
  enableTimeline = envFlag("RADIO_LAN_TIMELINE"),
  // Agents post to chat only while the station is live, so an always-on room never posts into an offline channel.
  stationLiveCheck = null,
  liveCheckIntervalMs = 60_000,
  createTimelineImpl = createTimelineIngest,
  createTimelineStoreImpl = createTimelineStore,
  macroClock = Date.now,
  log = console,
} = {}) {
  // A set but too-short key is an operator mistake: refuse to start rather than run with weak pseudonyms.
  assertParticipantKey(participantKey);
  const feed = createObservationFeed({ maxObservations });
  const clients = new Set();
  let ircSession = null;
  let tokenManager = null;
  let ircHealth = {};
  let authHealth = {};
  let totalObservations = 0;
  let boardFeed = null;
  let takes = [];
  let chorusRunning = false;

  const broadcast = (type, data) => {
    const message = encodeSseEvent(type, data);
    for (const response of clients) response.write(message);
  };
  const unsubscribe = feed.subscribe(broadcast);

  const publishHealth = () => feed.updateHealth({
    ...ircHealth,
    enabled: Boolean(ircHealth.enabled || authHealth.enabled),
    total_events: totalObservations,
    last_error: authHealth.last_error ?? ircHealth.last_error ?? null,
  });
  const onIrcState = (state) => {
    ircHealth = state;
    publishHealth();
  };
  const onAuthState = (state) => {
    authHealth = state;
    publishHealth();
  };
  let timeline = null;
  const observe = (event) => {
    timeline?.observeIrc(event);
    const observation = feed.observe(event);
    totalObservations += 1;
    return observation;
  };

  const pushTake = (line) => {
    takes = [line, ...takes].slice(0, maxTakes);
    broadcast("take", line);
  };

  const chorusSay = (text) => {
    if (!ircSession?.say) return { sent: false, reason: "irc_not_running" };
    return ircSession.say(text);
  };

  let stationLive = null; // true, false, or null when unknown
  const runChorus = async (boardSnapshot) => {
    if (!enableChorus || chorusRunning || !boardSnapshot?.board?.rows?.length) return;
    chorusRunning = true;
    try {
      const sessionAllows = Boolean(chorusSend && ircSession?.allowSend);
      const allowSend = sessionAllows && stationLive === true;
      const disabledReason = sessionAllows ? "station_offline" : "send_disabled";
      const chorus = createChorusImpl({ allowSend, say: allowSend ? chorusSay : null, gapMs: chorusGapMs, disabledReason });
      await chorus.run(boardSnapshot.board, { maxRows: chorusRows, onLine: pushTake });
    } catch {
      // The chorus must never take the room down.
    } finally {
      chorusRunning = false;
    }
  };

  let currentAccessToken = oauthToken;
  /** Twitch board reads use whatever access token the token manager most recently issued. */
  const twitchBoardFetch = (args = {}) => fetchTwitchBoard({ clientId, token: currentAccessToken, ...args });
  Object.defineProperty(twitchBoardFetch, "name", { value: "fetchTwitchBoard" });
  if (enableBoard) {
    boardFeed = createBoardFeed({ intervalMs: boardIntervalMs, fetchBoard: boardFetch ?? twitchBoardFetch });
  }
  if (boardFeed) {
    boardFeed.subscribe((type, data) => {
      broadcast(type, data);
      void runChorus(data);
    });
  }

  // The same store feeds the ingest and the local /macro page.
  const timelineStore = enableTimeline ? createTimelineStoreImpl() : null;
  if (enableTimeline) {
    timeline = createTimelineImpl({
      clientId,
      login,
      participantKey,
      store: timelineStore,
      onLive: (live) => {
        stationLive = live;
      },
      log,
    });
  }

  // Without the timeline, a light Helix check keeps stationLive current while sending is on.
  const defaultLiveCheck = async () => {
    if (!currentAccessToken || !clientId) return null;
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
      headers: { Authorization: `Bearer ${String(currentAccessToken).replace(/^oauth:/i, "")}`, "Client-Id": clientId },
    });
    if (!response.ok) return null;
    return ((await response.json()).data ?? []).length > 0;
  };
  const liveCheck = stationLiveCheck ?? (chorusSend && !enableTimeline ? defaultLiveCheck : null);
  let liveTimer = null;
  const checkLive = async () => {
    try {
      const live = await liveCheck();
      if (live !== null) stationLive = live;
    } catch {
      // Unknown stays unknown; unknown never sends.
    }
  };

  // Receipts go to the overlay only. They stay out of the chorus: BANNED_WORDS would drop the lines.
  const ledgerFeed = ledgerPath ? createLedgerFeedImpl({ path: ledgerPath, intervalMs: ledgerIntervalMs }) : null;
  let ledgerBroken = false;
  ledgerFeed?.subscribe((type, data) => {
    broadcast(type, data);
    // A refused save is invisible on air (the last good ledger stays up), so tell the operator here.
    // The detail names a field, never a value or the file path.
    if (data.last_error) {
      ledgerBroken = true;
      const detail = data.last_detail ? ` (${data.last_detail})` : "";
      log.warn(`ledger: ${data.last_error}${detail}; ${data.ledger ? "still showing the last good ledger" : "no receipts are shown"}`);
    } else if (ledgerBroken) {
      ledgerBroken = false;
      log.info("ledger: readable again");
    }
  });

  const snapshot = () => Object.freeze({
    ...feed.snapshot(),
    board: boardFeed ? boardFeed.snapshot() : null,
    takes: Object.freeze([...takes]),
    ledger: ledgerFeed ? ledgerFeed.snapshot() : null,
  });

  const server = createServer(async (request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end();
      return;
    }
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const pathname = requestUrl.pathname;
    if (pathname === "/") {
      response.writeHead(302, { Location: "/public/live.html" }).end();
      return;
    }
    // Macro and live observations show Twitch data: this machine only. Do not publish or share it.
    if (pathname === "/macro" || pathname === "/macro/state" || pathname === "/public/macro.html" || pathname === "/live/events") {
      if (!isLoopbackHost(request.headers.host)) {
        response.writeHead(403, { "Cache-Control": "no-store" }).end("Forbidden");
        return;
      }
      if (pathname === "/macro") {
        response.writeHead(302, { Location: "/public/macro.html", "Cache-Control": "no-store" }).end();
        return;
      }
    }
    if (pathname === "/macro/state") {
      const head = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
      try {
        const body = timelineStore
          ? macroSnapshot({ store: timelineStore, board: boardFeed ? boardFeed.snapshot() : null, now: macroClock(), hours: parseHours(requestUrl.searchParams.get("hours")) })
          : { enabled: false, generated_at: new Date(macroClock()).toISOString(), notice: MACRO_NOTICE };
        response.writeHead(200, head).end(JSON.stringify(body));
      } catch {
        response.writeHead(500, head).end(JSON.stringify({ error: "macro_unavailable" }));
      }
      return;
    }
    if (pathname === "/live/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      response.write(encodeSseEvent("snapshot", snapshot()));
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    const file = STATIC_FILES.get(pathname);
    if (!file) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      response.writeHead(200, {
        "Content-Type": file[1],
        "Cache-Control": "no-store",
      }).end(await readFile(file[0]));
    } catch {
      response.writeHead(500).end("Unable to load live room");
    }
  });

  const replaceIrc = async (token) => {
    currentAccessToken = token;
    // The timeline shares this token manager; its errors never stop the room and never carry the token.
    timeline?.setToken(token).catch((error) => log.warn(`timeline: ${error?.message ?? "start failed"}`));
    ircSession?.stop();
    ircSession = createIrcSession({
      login,
      oauthToken: token,
      onEvent: observe,
      onState: onIrcState,
      WebSocketImpl,
      allowSend: Boolean(chorusSend),
      participantKey,
    });
    ircSession.start();
  };

  const startIrc = async () => {
    if (!oauthToken) {
      feed.updateHealth({ last_error: "oauth_not_configured" });
      return;
    }
    try {
      if (clientId && refreshToken) {
        tokenManager = createTokenManager({
          clientId,
          accessToken: oauthToken,
          refreshToken,
          login,
          onToken: replaceIrc,
          onTokens: persistTokens ?? (async () => {
            throw new Error("token persistence is not configured");
          }),
          onState: onAuthState,
        });
        await tokenManager.start();
      } else {
        onAuthState({ enabled: true, last_error: "twitch_refresh_not_configured" });
        await replaceIrc(oauthToken);
      }
    } catch (error) {
      feed.updateHealth({ last_error: error?.code ?? "irc_start_failed" });
    }
  };

  const listen = ({ port = 8787, host = "127.0.0.1" } = {}) =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, async () => {
        server.off("error", reject);
        await startIrc();
        if (liveCheck) {
          await checkLive();
          liveTimer = setInterval(() => void checkLive(), liveCheckIntervalMs);
        }
        if (boardFeed) await boardFeed.start();
        if (ledgerFeed) await ledgerFeed.start();
        const address = server.address();
        resolve(Object.freeze({ host, port: address.port }));
      });
    });

  const close = async () => {
    if (liveTimer) clearInterval(liveTimer);
    timeline?.stop();
    boardFeed?.stop();
    ledgerFeed?.stop();
    tokenManager?.stop();
    ircSession?.stop();
    for (const response of clients) response.end();
    clients.clear();
    unsubscribe();
    if (!server.listening) return;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };

  return Object.freeze({ listen, close, snapshot });
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const storeProject = undefined;
  const storeConfig = undefined;
  const persistTokens = storeProject && storeConfig
    ? null
    : undefined;
  const live = createLiveServer({ persistTokens });
  const address = await live.listen({
    port: Number(process.env.PORT ?? 8787),
    host: "127.0.0.1",
  });
  console.log(`Radio LAN live room: http://${address.host}:${address.port}/public/live.html`);
  const shutdown = async () => {
    await live.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
