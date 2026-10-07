import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadPolls } from "../hub/polls.js";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { createChorus } from "../agents/chorus.js";
import { createStationIrcSession } from "./irc-session.js";
import { assertParticipantKey } from "../providers/twitch-irc.js";
import { fetchTwitchBoard, TRACKED_STREAMERS } from "../markets/twitch-metrics.js";
import { createLedgerFeed } from "./ledger-feed.js";
import { createMarketFeed } from "./market-feed.js";
import { quoteProvenance, publicTapeEvents } from "../markets/tape.js";
import { createObservationFeed } from "./observation-feed.js";
import { STATION_CHANNEL } from "./station.js";
import { createTwitchTokenManager } from "./twitch-token-manager.js";
import { createTimelineIngest } from "../timeline/ingest.js";
import { readRecordedAnchor, macroCsv } from "../timeline/macro-operations.js";
import { MACRO_NOTICE, isLoopbackHost, macroSnapshot, parseHours } from "../timeline/macro.js";
import { createTimelineStore } from "../timeline/store.js";
import { createHubApi } from "../hub/api.js";
import { createArenaIndex } from "../hub/market.js";
import { resolveTwitchStreamEvent } from "../hub/twitch-mark.js";
import { defaultMintFor, loadRegistry } from "../hub/registry.js";
import { createRpcRelay } from "../hub/relay.js";
import { createHubStore } from "../hub/store.js";

const STATIC_FILES = new Map([
  ["/public/live.html", [new URL("../../public/live.html", import.meta.url), "text/html; charset=utf-8"]],
  ["/stream", [new URL("../../public/macro.html", import.meta.url), "text/html; charset=utf-8"]],
  ["/public/macro.html", [new URL("../../public/macro.html", import.meta.url), "text/html; charset=utf-8"]],
  ["/src/live/station.js", [new URL("./station.js", import.meta.url), "text/javascript; charset=utf-8"]],
  ["/src/markets/tape.js", [new URL("../markets/tape.js", import.meta.url), "text/javascript; charset=utf-8"]],
]);

const X402_API_PREFIX = "/hub/api/x402/";

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
  // Keys the chatter pseudonyms. Runtime secret only, never in the repo. Unset means no participant ids.
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
  // Twitch timeline. Never broadcast to the overlay.
  enableTimeline = envFlag("RADIO_LAN_TIMELINE"),
  // Agents post to chat only while the station is live, so an always-on room never posts into an offline channel.
  stationLiveCheck = null,
  liveCheckIntervalMs = 60_000,
  createTimelineImpl = createTimelineIngest,
  createTimelineStoreImpl = createTimelineStore,
  macroClock = Date.now,
  // The public tape source. A function or array for tests and operator tooling; by default the
  // station's own timeline store feeds it, inside the raw retention window.
  tapeRecords = null,
  // The hub's RPC relay (docs/HUB_FRONTEND_PLAN.md section 5): POST /hub/rpc, only when an upstream is set. The URL
  // carries the provider key; it is a runtime secret, never logged.
  hubRpcUrl = process.env.RADIOLAN_RPC_URL,
  hubRpcFetch = globalThis.fetch,
  // The hub API (docs/HUB_FRONTEND_PLAN.md sections 3 and 12) mounts under /hub/api/ when the page origin is set.
  hubOrigins = process.env.RADIOLAN_HUB_ORIGIN,
  hubStore = null,
  hubSeasonPath = process.env.RADIOLAN_HUB_SEASON,
  hubSeason = null,
  // The arena's schedule recurs on chain, so the points season follows it: set RADIOLAN_HUB_SEASON_RECURRING=0 to keep the one published season.
  hubSeasonRecurring = process.env.RADIOLAN_HUB_SEASON_RECURRING !== "0",
  hubPollsPath = process.env.RADIOLAN_HUB_POLLS,
  hubPolls = null,
  // devnet (default) or mainnet: the network the arena index must read and the default registry's featured mint.
  hubNetwork = process.env.RADIOLAN_HUB_NETWORK ?? "devnet",
  // Timer injection for the season finalizer (tests); the defaults are setTimeout and clearTimeout.
  hubSchedule = undefined,
  hubCancel = undefined,
  hubSecure = process.env.RADIOLAN_HUB_INSECURE_COOKIE !== "1",
  hubClock = null,
  // The backing board: the registry (RADIOLAN_HUB_REGISTRY, or the default) joined to an arena index that reads
  // devnet through the relay's upstream every few minutes. Off without the upstream; `hubMarket` injects both.
  hubRegistry = null,
  hubMarket = null,
  hubMarketIntervalMs = undefined,
  sponsorApi: configuredSponsorApi = null,
  enableSponsorApi = envFlag("RADIOLAN_X402_ENABLED"),
  log = console,
} = {}) {
  // A set but too-short key is an operator mistake: refuse to start rather than run with weak pseudonyms.
  assertParticipantKey(participantKey);
  // A set but malformed upstream is an operator mistake: refuse to start rather than relay nowhere.
  const hubRelay = hubRpcUrl ? createRpcRelay({ upstream: hubRpcUrl, fetchImpl: hubRpcFetch, log }) : null;
  let hubApi = null;
  let sponsorApi = configuredSponsorApi;
  let arenaIndex = null;
  let marketRegistry = null;
  let timelineStore = null;
  // One switch for the whole backing layer (Hermes' risk note, 2026-10-03): RADIO_LAN_BACKING=off turns the
  // market routes off entirely (404) while the rest of the hub - live, identity, points - stays up. Backing data
  // is also never an input anywhere else; the switch removes the routes themselves, not just the UI.
  const backingOff = process.env.RADIO_LAN_BACKING === "off";
  if (hubOrigins && backingOff) log.warn("backing: RADIO_LAN_BACKING=off; market routes answer 404 this run");
  if (hubOrigins) {
    const season = hubSeason ?? (hubSeasonPath ? JSON.parse(readFileSync(hubSeasonPath, "utf8")) : null);
    const store = hubStore ?? createHubStore();
    let market = hubMarket;
    if (backingOff) {
      market = undefined;
    } else if (!market && hubRpcUrl) {
      arenaIndex = createArenaIndex({ upstream: hubRpcUrl, fetchImpl: hubRpcFetch, dir: store.dir, log, expectNetwork: hubNetwork, ...(hubMarketIntervalMs ? { intervalMs: hubMarketIntervalMs } : {}) });
      market = { registry: hubRegistry ?? loadRegistry({ network: hubNetwork }), index: arenaIndex, board: (login) => boardRow(login) };
      marketRegistry = market.registry;
    }
    const polls = hubPolls ?? (hubPollsPath ? loadPolls(hubPollsPath) : null);
    hubApi = createHubApi({
      origins: hubOrigins, store, season, seasonRecurring: hubSeasonRecurring, polls, secure: hubSecure, log, market,
      defaultMint: defaultMintFor(hubNetwork), schedule: hubSchedule, cancel: hubCancel,
      resolveTwitchMarkEvent: (query) => resolveTwitchStreamEvent(timelineStore, query),
      stationStatus: () => {
        const current = boardFeed?.snapshot();
        const observedAt = current?.updated_at ? Date.parse(current.updated_at) : NaN;
        if (!current?.enabled || !current.board || !Number.isFinite(observedAt) || observedAt > Date.now() || Date.now() - observedAt > 120_000) {
          return { status: "unknown", source: "Data: Twitch", observedAt: null };
        }
        const live = current.board.rows?.some((row) => row.login === STATION_CHANNEL && row.is_live === true);
        const offline = current.board.offline?.includes(STATION_CHANNEL);
        return { status: live ? "live" : offline ? "offline" : "unknown", source: "Data: Twitch", observedAt: new Date(observedAt).toISOString() };
      },
      resolveTwitchUser: async (id) => {
        if (!clientId || !currentAccessToken) throw new Error("Twitch account lookup unavailable");
        const url = new URL("https://api.twitch.tv/helix/users");
        url.searchParams.set("id", id);
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${String(currentAccessToken).replace(/^oauth:/i, "")}`, "Client-Id": clientId, accept: "application/json" },
        });
        if (!response.ok) throw new Error("Twitch account lookup failed");
        const text = await response.text();
        if (text.length > 32_768) throw new Error("Twitch account response too large");
        const data = JSON.parse(text).data;
        if (!Array.isArray(data) || data.length !== 1) throw new Error("Twitch account response malformed");
        return data[0];
      },
      ...(hubClock ? { now: hubClock } : {}),
    });
  }
  const feed = createObservationFeed({ maxObservations, tapeEvents: () => publicTapeEvents(recordedTape()) });
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
  // The board polls the tracked list plus every Twitch login the registry names, so a listing the operator adds gets
  // live figures without a code change. One Helix call takes at most 100 logins; the tracked list keeps priority.
  const watchedLogins = () => [...new Set([...TRACKED_STREAMERS, ...(marketRegistry ?? []).map((e) => e.twitch).filter(Boolean)])].slice(0, 100);
  const twitchBoardFetch = (args = {}) => fetchTwitchBoard({ clientId, token: currentAccessToken, logins: watchedLogins(), ...args });
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
  timelineStore = enableTimeline ? createTimelineStoreImpl() : null;
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

  // A display-only Twitch row for the market, with its provenance line (tape.js). Null when the board is off.
  const boardRow = (login) => {
    const board = boardFeed ? boardFeed.snapshot().board : null;
    if (!board) return null;
    const row = board.rows?.find((r) => r.login === login);
    // Helix returns live streams only; the feed names the rest under `offline`. Both are a recorded read.
    if (!row) return board.offline?.includes(login) ? { live: false, viewers: null, game: null, startedAt: null, rank: null, deltaViewers: null, provenance: quoteProvenance({}, { station: STATION_CHANNEL, recordedAt: board.generated_at }) } : null;
    return { live: Boolean(row.is_live), viewers: row.is_live ? row.viewer_count ?? null : null, game: row.game_name ?? null, startedAt: row.started_at ?? null, rank: row.rank ?? null, deltaViewers: row.delta_viewers ?? null, provenance: quoteProvenance(row, { station: STATION_CHANNEL, recordedAt: board.generated_at }) };
  };

  // The tape the page shows: injected records win (tests, operator tooling); otherwise the
  // station's own normalized timeline, inside the raw retention window.
  const recordedTape = () => {
    if (typeof tapeRecords === "function") return tapeRecords();
    if (Array.isArray(tapeRecords)) return tapeRecords;
    return timelineStore ? timelineStore.readRaw({ since: macroClock() - 24 * 60 * 60 * 1000 }) : [];
  };

  const snapshot = () => Object.freeze({
    ...feed.snapshot(),
    board: boardFeed ? boardFeed.snapshot() : null,
    tape_events: publicTapeEvents(recordedTape()),
    takes: Object.freeze([...takes]),
    ledger: ledgerFeed ? ledgerFeed.snapshot() : null,
  });

  // One request = one handler turn. The routing body lives in its own async function so the
  // createServer callback can guarantee, with a single catch, that an unexpected throw answers
  // generically and never leaks a rejected promise (which would take the room down).
  const serveRequest = async (request, response, requestUrl) => {
    const pathname = requestUrl.pathname;
    if (pathname.startsWith(X402_API_PREFIX)) {
      const host = String(request.headers.host ?? "").trim().toLowerCase();
      if (!/^radiolan\.live(?::[0-9]{1,5})?$/.test(host)) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({ error: "host_not_allowed" }));
        return;
      }
      if (sponsorApi) {
        await sponsorApi(request, response);
      } else if (request.method === "GET" && pathname === `${X402_API_PREFIX}offer`) {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({
          service: "Radio LAN sponsor reads",
          status: "disabled",
          payment_enabled: false,
          reason: "operator_configuration_required",
          planned_protocol: { version: 2, scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
        }))
      } else {
        response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({ error: "x402_disabled" }));
      }
      return;
    }
    if (hubRelay && pathname === "/hub/rpc") {
      await hubRelay(request, response);
      return;
    }
    if (hubApi && pathname.startsWith("/hub/api/")) {
      try {
        await hubApi(request, response);
      } catch (error) {
        log.warn?.(`hub api: ${pathname} failed: ${error?.message ?? error}`);
        if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({ error: "hub_api_failed" }));
        else response.end();
      }
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end();
      return;
    }
    if (pathname === "/") {
      response.writeHead(302, { Location: "/public/live.html" }).end();
      return;
    }
    // Macro and live observations show Twitch data: this machine only. Do not publish or share it.
    if (pathname === "/stream" || pathname === "/macro" || pathname === "/macro/state" || pathname === "/macro/export" || pathname === "/public/macro.html" || pathname === "/live/events") {
      if (!isLoopbackHost(request.headers.host)) {
        response.writeHead(403, { "Cache-Control": "no-store" }).end("Forbidden");
        return;
      }
      if (pathname === "/macro") {
        response.writeHead(302, { Location: "/public/macro.html", "Cache-Control": "no-store" }).end();
        return;
      }
    }
    if (pathname === "/macro/state" || pathname === "/macro/export") {
      const head = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
      try {
        const body = timelineStore
          ? macroSnapshot({ store: timelineStore, board: boardFeed ? boardFeed.snapshot() : null, now: macroClock(), anchor: await readRecordedAnchor(), hours: parseHours(requestUrl.searchParams.get("hours")) })
          : { enabled: false, generated_at: new Date(macroClock()).toISOString(), notice: MACRO_NOTICE };
        if (pathname === "/macro/export") {
          if (!body.enabled) { response.writeHead(409, head).end(JSON.stringify({ error: "timeline_disabled" })); return; }
          response.writeHead(200, { ...head, "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="macro-${body.hours}h.csv"` }).end(macroCsv(body));
        } else response.writeHead(200, head).end(JSON.stringify(body));
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
  };
  const server = createServer(async (request, response) => {
    // A raw request-target like "http://[" passes Node's HTTP parser but throws
    // in WHATWG URL parsing; a throw here must be a 400, not a process death.
    // Every later failure funnels through the same generic answer below, so one
    // unexpected handler error can never reject the callback's promise and stop the room.
    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? "/", "http://localhost");
    } catch {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad request");
      return;
    }
    try {
      await serveRequest(request, response, requestUrl);
    } catch (error) {
      // Generic, quiet, and safe: no route internals, no values, no paths. Detail at debug level only.
      log.debug?.(`request ${request.method} ${requestUrl.pathname} failed: ${error?.name ?? "Error"}`);
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({ error: "request_failed" }));
      } else {
        response.end();
      }
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

  const listen = async ({ port = 8787, host = "127.0.0.1" } = {}) => {
    try {
      if (!sponsorApi && enableSponsorApi) {
        const { createSponsorApi, loadSponsorConfig } = await import("../x402/sponsor-api.js");
        sponsorApi = createSponsorApi({ config: loadSponsorConfig(), log });
      }
      if (sponsorApi?.initialize) {
        let timer;
        try {
          await Promise.race([
            sponsorApi.initialize(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("facilitator_init_timeout")), 8_000); }),
          ]);
        } finally { clearTimeout(timer); }
      }
    } catch (error) {
      log.error?.(`x402 disabled at startup: ${error?.message ?? "facilitator initialization failed"}`);
      sponsorApi = null;
    }
    return new Promise((resolve, reject) => {
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
        arenaIndex?.start();
        hubApi?.start?.();
        const address = server.address();
        resolve(Object.freeze({ host, port: address.port }));
      });
    });
  };

  const close = async () => {
    if (liveTimer) clearInterval(liveTimer);
    timeline?.stop();
    boardFeed?.stop();
    ledgerFeed?.stop();
    arenaIndex?.stop();
    hubApi?.stop?.();
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
  console.log(`Radio LAN streamer performance: http://${address.host}:${address.port}/macro`);
  const shutdown = async () => {
    await live.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
