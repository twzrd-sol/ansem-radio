/**
 * The hub API (docs/HUB_FRONTEND_PLAN.md sections 3, 5 and 12), P0 scope: passkey accounts, sessions, joining the
 * season, the free activities with provisional points, and the season state. Mounted by the station under
 * /hub/api/ when RADIOLAN_HUB_ORIGIN is set. Zero dependencies.
 *
 * Boundary (section 12): the station binds loopback behind the edge, so a request whose socket peer is not
 * loopback is refused; the client key is CF-Connecting-IP as the relay reads it. Every write needs an Origin from
 * the allowlist; every write after sign-in needs the session cookie (HttpOnly, Secure, SameSite=Strict) and the
 * session's CSRF token in `x-hub-csrf`; every write touches the session's own account only.
 *
 * Points are provisional (section 4): the same rule settlement applies, on unsigned submissions, while the season
 * is open. accepted_work waits for the streamer's acceptance and credits nothing here.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { createRateLimiter, HttpError, readJson } from "../platform/guard.js";
import { ACTIONS, actionId, provisionalPoints, rankAccounts } from "./points.js";
import { createSeasons } from "./rollover.js";
import { createSeasonFinalizer, readFrozen } from "./finalizer.js";
import { normalizePolls, pollFor, utcDay } from "./polls.js";
import { renderBadge } from "./badge.js";
import { createClaimRoutes, createClaimStore, deriveClaimPair } from "./claims.js";
import { mintForClaims, reservedSlug } from "./registry.js";
import { createIdentityRoutes } from "./identity.js";
import { createHubIdentityStore } from "./identity-store.js";
import { communityConfig } from "./community.js";
import { createCommunityStore } from "./community-store.js";
import { createCommunityRoutes } from "./community-routes.js";
import { clientKey } from "./relay.js";
import { base64url, verifyAssertion, verifyRegistration } from "./webauthn.js";

export const COOKIE = "hub_session";
export const CSRF_HEADER = "x-hub-csrf";
const SESSION_SECONDS = 30 * 86_400;
const CHALLENGE_SECONDS = 300;
const CHALLENGES_PER_CLIENT = 10;
const TEXT_MAX = 280;
const BOARD_SIZE = 10;
export const handleOf = (accountId) => `fan-${accountId.slice(0, 8)}`;

/** Allowed page origins, and their RP ids. An IP literal cannot be an RP id, so such an origin is refused here. */
export function parseOrigins(text) {
  const origins = String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (origins.length === 0) throw new TypeError("RADIOLAN_HUB_ORIGIN needs at least one origin");
  const rpIds = [];
  for (const origin of origins) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new TypeError(`RADIOLAN_HUB_ORIGIN: not an origin: ${origin}`);
    }
    if (url.origin !== origin) throw new TypeError(`RADIOLAN_HUB_ORIGIN: not a bare origin: ${origin}`);
    if (!["http:", "https:"].includes(url.protocol)) throw new TypeError("RADIOLAN_HUB_ORIGIN: http(s) only");
    if (/^[\d.]+$|^\[/.test(url.hostname)) throw new TypeError(`RADIOLAN_HUB_ORIGIN: an IP literal cannot be a passkey RP id: ${origin}`);
    if (url.protocol === "http:" && url.hostname !== "localhost") throw new TypeError("RADIOLAN_HUB_ORIGIN: http only for localhost");
    if (!rpIds.includes(url.hostname)) rpIds.push(url.hostname);
  }
  return { origins, rpIds };
}

const sha256hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const parseCookies = (header) => Object.fromEntries(String(header ?? "").split(";").map((p) => p.trim().split("=")).filter(([k, v]) => k && v !== undefined).map(([k, ...v]) => [k, v.join("=")]));

export function createHubApi({ origins: originText, store, season = null, seasonRecurring = false, polls: pollsInput = null, now = () => Math.floor(Date.now() / 1000), secure = true, log = console, limits = { read: 120, write: 30, auth: 10 }, market = null, defaultMint = null, registry: registryInput = null, identity = {}, community = undefined, resolveTwitchUser = null, schedule = undefined, cancel = undefined }) {
  const { origins, rpIds } = parseOrigins(originText);
  const { polls: seasonPolls, ...seasonConfig } = season ?? {};
  // The published season, or (seasonRecurring) the arena's recurring season that contains the current instant:
  // `config` is re-derived at the top of every request, so a season boundary needs no restart.
  const seasons = season ? createSeasons(seasonConfig, { recurring: seasonRecurring }) : null;
  let config = seasons ? seasons.at(now()) : null;
  const polls = normalizePolls(pollsInput ?? seasonPolls ?? null);
  const challenges = new Map();
  const readLimit = createRateLimiter({ limit: limits.read, clock: () => now() * 1000 });
  const writeLimit = createRateLimiter({ limit: limits.write, clock: () => now() * 1000 });
  const authLimit = createRateLimiter({ limit: limits.auth, clock: () => now() * 1000 });

  // Pending challenges are bounded per client: the oldest of that client's is evicted, so one address cannot
  // fill the table for everyone. Map insertion order is issue order.
  const issueChallenge = (record, key) => {
    for (const [c, r] of challenges) if (r.expiresAt <= now()) challenges.delete(c);
    const mine = [...challenges].filter(([, r]) => r.key === key);
    for (const [c] of mine.slice(0, Math.max(0, mine.length + 1 - CHALLENGES_PER_CLIENT))) challenges.delete(c);
    const challenge = base64url.encode(randomBytes(32));
    challenges.set(challenge, { ...record, key, expiresAt: now() + CHALLENGE_SECONDS });
    return challenge;
  };
  const takeChallenge = (clientDataJSON, kind) => {
    let given;
    try {
      given = JSON.parse(Buffer.from(base64url.decode(clientDataJSON)).toString("utf8")).challenge;
    } catch {
      throw new HttpError(400, "invalid_client_data");
    }
    const record = typeof given === "string" ? challenges.get(given) : undefined;
    if (record) challenges.delete(given);
    if (!record || record.kind !== kind || record.expiresAt <= now()) throw new HttpError(400, "unknown_or_expired_challenge");
    return { challenge: given, record };
  };

  const seasonOpen = () => config !== null && now() >= config.startsAt && now() < config.endsAt;
  const seasonRows = () => (config ? store.submissions().filter((s) => s.season === config.season) : []);
  /** Provisional points for this season, ranked by points, first credit, then private account id. */
  const ranking = () => {
    const credited = seasonRows().filter((s) => s.status === "credited");
    const { scores, today } = provisionalPoints(config.policy, credited, { now: now() });
    return { scores, today, ranked: rankAccounts(config.policy, credited) };
  };
  /** Badges derive from credited activity only and count distinct UTC days across seasons. */
  const badges = (accountId) => {
    const mine = store.submissions().filter((s) => s.accountId === accountId && s.status === "credited").sort((a, b) => a.occurredAt - b.occurredAt);
    const out = [];
    if (mine.length) out.push({ id: "first_play", earnedAt: mine[0].occurredAt });
    const days = new Set();
    for (const submission of mine) {
      days.add(utcDay(submission.occurredAt));
      if (days.size === 3) {
        out.push({ id: "three_days", earnedAt: submission.occurredAt });
        break;
      }
    }
    return out;
  };
  const standing = (accountId) => {
    if (!config) return null;
    const rows = seasonRows();
    const { scores, today, ranked } = ranking();
    const rank = ranked.findIndex(([id]) => id === accountId);
    return {
      joined: Boolean(store.account(accountId)?.joined?.[config.season]),
      points: (scores.get(accountId) ?? 0n).toString(),
      today: (today.get(accountId) ?? 0n).toString(),
      rank: rank === -1 ? null : rank + 1,
      badges: badges(accountId),
      pending: rows.filter((s) => s.accountId === accountId && s.status === "pending").length,
      submissions: rows.filter((s) => s.accountId === accountId).map(({ id, action, status, occurredAt, detail }) => ({ id, action, status, occurredAt, ...(action === "poll_response" && typeof detail?.pollId === "string" ? { pollId: detail.pollId } : {}) })),
    };
  };
  const seasonState = () => {
    if (!config) return null;
    const rows = seasonRows();
    const poll = pollFor(polls, now());
    const { ranked } = ranking();
    return {
      number: config.season,
      arena: config.arena,
      network: config.network,
      startsAt: config.startsAt,
      endsAt: config.endsAt,
      open: seasonOpen(),
      policy: config.policy,
      players: store.joinedCount(config.season),
      credited: rows.filter((s) => s.status === "credited").length,
      poll: poll ? { id: poll.id, question: poll.question, options: poll.options, placeholder: poll.placeholder } : null,
      board: ranked.slice(0, BOARD_SIZE).map(([id, points]) => [handleOf(id), points.toString()]),
    };
  };

  const newSession = (accountId) => store.createSession({ id: base64url.encode(randomBytes(32)), accountId, csrf: base64url.encode(randomBytes(32)), createdAt: now(), expiresAt: now() + SESSION_SECONDS });
  const cookieHeader = (id, maxAge = SESSION_SECONDS) => `${COOKIE}=${id}; Path=/hub; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const sessionOf = (request) => {
    const id = parseCookies(request.headers.cookie)[COOKIE];
    if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    const session = store.session(id);
    if (!session || session.expiresAt <= now()) return null;
    return session;
  };
  const requireOrigin = (request) => {
    if (!origins.includes(request.headers.origin)) throw new HttpError(403, "origin_not_allowed");
  };
  const requireSession = (request, { csrf }) => {
    const session = sessionOf(request);
    if (!session) throw new HttpError(401, "sign_in_required");
    if (csrf) {
      const given = Buffer.from(String(request.headers[CSRF_HEADER] ?? ""));
      const expected = Buffer.from(session.csrf);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(403, "csrf_token_mismatch");
    }
    return session;
  };
  const text = (value) => {
    if (typeof value !== "string") throw new HttpError(400, "text_required");
    const t = value.trim();
    if (t.length === 0 || t.length > TEXT_MAX) throw new HttpError(400, "text_length");
    return t;
  };

  // The backing board (docs/DECISION_20261002_MULTI_STREAMER_PATH.md Stage 1): the registry joined to the arena
  // index. `market` is { registry, index, board? }; without it the market routes answer 404. Twitch rows are a
  // separate, labelled object next to backing, never merged into it.
  const claims = createClaimStore({ dir: store.dir });
  const identityStore = identity.store ?? createHubIdentityStore({ dir: store.dir });
  const communityStore = (community && community.store) || createCommunityStore({ dir: store.dir });
  const communitySettings = community?.config ?? communityConfig();
  // Station-wide default mint, or the featured listing's mint when that setting is unset. Never a hardcoded address.
  const claimMint = mintForClaims({ defaultMint, listings: registryInput ?? market?.registry ?? [] });
  const listingsNow = () => {
    const merged = (registryInput ?? market?.registry ?? []).filter((entry) => entry?.slug && !reservedSlug(entry.slug));
    // A claimed listing with no operator-set pair gets {streamer: the claimer's verified linked wallet, mint: the
    // station default or the featured listing's mint}, so an arena that wallet creates is backable with no operator
    // edit. An operator-set pair is never overridden, the registry's banned keys are refused, and a pair some other
    // listing already has is skipped.
    const taken = new Set(merged.filter((e) => e.streamer).map((e) => `${e.streamer}:${e.mint}`));
    return merged.map((entry) => {
      if (entry.streamer) return entry;
      // A released page keeps its arena association: the listing stays tied to the pair fans may have backed.
      const retired = claims.has(entry.slug) ? null : claims.retired(entry.slug);
      if (retired && !taken.has(`${retired.streamer}:${retired.mint}`)) {
        taken.add(`${retired.streamer}:${retired.mint}`);
        return { ...entry, streamer: retired.streamer, mint: retired.mint, claimDerived: true };
      }
      if (!claims.has(entry.slug)) return entry;
      const pair = deriveClaimPair({ claim: claims.get(entry.slug), identityOf: (id) => identityStore.get(id), defaultMint: claimMint });
      if (pair.error || taken.has(`${pair.streamer}:${pair.mint}`)) return entry;
      taken.add(`${pair.streamer}:${pair.mint}`);
      // The first time the derived pair's arena shows up on chain, pin it: later wallet changes cannot move the listing.
      if (!pair.pinned && market?.index?.listingArena?.({ streamer: pair.streamer, mint: pair.mint })) claims.pin(entry.slug, pair);
      return { ...entry, streamer: pair.streamer, mint: pair.mint, claimDerived: true };
    });
  };
  const marketListing = (entry, { withHistory = false } = {}) => {
    const arena = market.index.listingArena(entry);
    const twitch = entry.twitch ? (market.board?.(entry.twitch) ?? null) : null;
    return {
      slug: entry.slug,
      name: entry.name,
      kind: entry.kind,
      demo: entry.kind === "demo",
      blurb: entry.blurb,
      twitch: entry.twitch,
      claimed: claims.has(entry.slug),
      claimDerived: entry.claimDerived === true,
      /** The registry pair an arena derives from, so the page can offer the streamer-setup step before one exists. */
      keys: entry.streamer ? { streamer: entry.streamer, mint: entry.mint } : null,
      backingOpen: arena !== null && !arena.closed,
      arena,
      performance: twitch,
      ...(withHistory && arena ? { history: market.index.history(arena.address) } : {}),
    };
  };
  const marketEnvelope = (body) => {
    const status = market.index.status();
    return { network: status.network ?? "devnet", observedAt: status.observedAt, slot: status.slot, stale: status.stale, generatedAt: now(), ...body };
  };
  const marketRoutes = market
    ? {
        "GET /hub/api/market": () => marketEnvelope({ listings: listingsNow().map((entry) => marketListing(entry)) }),
        "GET /hub/api/market/positions": (request) => {
          const fan = new URL(request.url ?? "/", "http://localhost").searchParams.get("fan") ?? "";
          if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(fan)) throw new HttpError(400, "fan_address_required");
          const byArena = new Map(listingsNow().filter((e) => e.streamer).map((e) => [market.index.listingArena(e)?.address, e.slug]).filter(([a]) => a));
          return marketEnvelope({ fan, positions: market.index.positionsOf(fan).map((p) => ({ ...p, slug: byArena.get(p.arena) ?? null })) });
        },
      }
    : {};
  const marketListingRoute = (pathname) => {
    if (!market) return null;
    const m = /^\/hub\/api\/market\/([a-z0-9][a-z0-9_-]{1,31})$/.exec(pathname);
    if (!m || m[1] === "positions") return null;
    const entry = listingsNow().find((e) => e.slug === m[1]);
    return () => {
      if (!entry) throw new HttpError(404, "no_such_listing");
      return marketEnvelope({ listing: marketListing(entry, { withHistory: true }) });
    };
  };

  // A season's recap once its end has passed: frozen scores, labelled provisional (no creator key signs here).
  const seasonRoute = (pathname) => {
    const m = /^\/hub\/api\/season\/([1-9][0-9]{0,5})$/.exec(pathname);
    if (!m) return null;
    return () => {
      const frozen = readFrozen(store.dir, m[1]);
      if (frozen) return { recap: frozen };
      if (config && config.season === m[1] && now() < config.endsAt) throw new HttpError(409, "season_still_open", `season ${m[1]} ends at ${config.endsAt}`);
      throw new HttpError(404, "no_such_season");
    };
  };
  /**
   * The most recent frozen season as the hub's PastSeason: this season's file once it has ended, else the previous
   * season's. Reward state "provisional": frozen points, not a settlement, no anchor, no funding.
   */
  const lastSeason = (accountId) => {
    if (!config) return null;
    const frozen = readFrozen(store.dir, config.season) ?? (Number(config.season) > 1 ? readFrozen(store.dir, String(Number(config.season) - 1)) : null);
    if (!frozen) return null;
    const mine = accountId ? frozen.scores.find((s) => s.handle === handleOf(accountId)) : null;
    return {
      number: Number(frozen.season),
      players: frozen.players,
      eligiblePoints: Number(frozen.totalPoints),
      reward: { kind: "provisional" },
      me: mine ? { points: Number(mine.points), rank: mine.rank } : null,
      top: frozen.scores.slice(0, 3).map((s) => [s.handle, Number(s.points)]),
      endsAt: frozen.endsAt,
      frozenAt: frozen.frozenAt,
      label: frozen.label,
    };
  };

  const routes = {
    ...marketRoutes,
    ...createIdentityRoutes({ hubStore: store, origins, requireOrigin, requireSession, authLimit, now, ...identity, store: identityStore }),
    ...createCommunityRoutes({
      origins, requireOrigin, requireSession, sessionOf, authLimit, now,
      community: communitySettings, store: communityStore, season: () => config, standingOf: standing,
    }),
    ...createClaimRoutes({ registry: listingsNow, claims, twitchOf: (accountId) => identityStore.get(accountId), resolveTwitchUser, requireOrigin, requireSession, authLimit, now, defaultMint: claimMint }),
    "GET /hub/api/state": (request) => {
      const session = sessionOf(request);
      return { season: seasonState(), lastSeason: lastSeason(session?.accountId ?? null), me: session ? { accountId: session.accountId, createdAt: store.account(session.accountId)?.createdAt ?? null, ...standing(session.accountId) } : null, generatedAt: now() };
    },
    "GET /hub/api/me": (request) => {
      const session = requireSession(request, { csrf: false });
      const account = store.account(session.accountId);
      return { accountId: account.id, createdAt: account.createdAt, credentials: account.credentials.length, csrf: session.csrf, standing: standing(account.id) };
    },
    "POST /hub/api/register/options": (request, key) => {
      requireOrigin(request);
      if (!authLimit(key)) throw new HttpError(429, "slow_down");
      const userHandle = randomBytes(32);
      const challenge = issueChallenge({ kind: "register", userHandle: base64url.encode(userHandle) }, key);
      return {
        publicKey: {
          rp: { id: rpIds[0], name: "Radio LAN" },
          user: { id: base64url.encode(userHandle), name: `fan-${sha256hex(userHandle).slice(0, 8)}`, displayName: "Radio LAN fan" },
          challenge,
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -8 }, { type: "public-key", alg: -257 }],
          timeout: CHALLENGE_SECONDS * 1000,
          attestation: "none",
          authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        },
      };
    },
    "POST /hub/api/register": async (request, key) => {
      requireOrigin(request);
      if (!authLimit(key)) throw new HttpError(429, "slow_down");
      const body = await readJson(request, 65_536);
      const response = body.response;
      if (!response || typeof response.clientDataJSON !== "string" || typeof response.attestationObject !== "string") throw new HttpError(400, "credential_response_required");
      const { challenge, record } = takeChallenge(response.clientDataJSON, "register");
      let credential;
      try {
        credential = verifyRegistration({ clientDataJSON: response.clientDataJSON, attestationObject: response.attestationObject, expectedChallenge: challenge, origins, rpIds });
      } catch (error) {
        throw new HttpError(400, "registration_rejected", error.message);
      }
      if (store.accountByCredential(credential.credentialId)) throw new HttpError(409, "credential_already_registered");
      const account = store.createAccount({
        id: sha256hex(base64url.decode(record.userHandle)),
        userHandle: record.userHandle,
        createdAt: now(),
        credentials: [{ credentialId: credential.credentialId, publicKeyJwk: credential.publicKeyJwk, alg: credential.alg, signCount: credential.signCount, createdAt: now() }],
        joined: {},
      });
      const session = newSession(account.id);
      return { accountId: account.id, csrf: session.csrf, _cookie: cookieHeader(session.id) };
    },
    "POST /hub/api/login/options": (request, key) => {
      requireOrigin(request);
      if (!authLimit(key)) throw new HttpError(429, "slow_down");
      const challenge = issueChallenge({ kind: "login" }, key);
      return { publicKey: { rpId: rpIds[0], challenge, timeout: CHALLENGE_SECONDS * 1000, userVerification: "preferred", allowCredentials: [] } };
    },
    "POST /hub/api/login": async (request, key) => {
      requireOrigin(request);
      if (!authLimit(key)) throw new HttpError(429, "slow_down");
      const body = await readJson(request, 65_536);
      const response = body.response;
      if (typeof body.id !== "string" || !response || ["clientDataJSON", "authenticatorData", "signature"].some((f) => typeof response[f] !== "string")) throw new HttpError(400, "credential_response_required");
      const { challenge } = takeChallenge(response.clientDataJSON, "login");
      const account = store.accountByCredential(body.id);
      const credential = account?.credentials.find((c) => c.credentialId === body.id);
      if (!account || !credential) throw new HttpError(400, "unknown_credential");
      let result;
      try {
        result = verifyAssertion({ credential, clientDataJSON: response.clientDataJSON, authenticatorData: response.authenticatorData, signature: response.signature, expectedChallenge: challenge, origins, rpIds });
      } catch (error) {
        throw new HttpError(400, "assertion_rejected", error.message);
      }
      store.updateAccount(account.id, { credentials: account.credentials.map((c) => (c.credentialId === body.id ? { ...c, signCount: result.signCount, usedAt: now() } : c)) });
      const session = newSession(account.id);
      return { accountId: account.id, csrf: session.csrf, _cookie: cookieHeader(session.id) };
    },
    "POST /hub/api/logout": (request) => {
      requireOrigin(request);
      const session = sessionOf(request);
      if (session) store.deleteSession(session.id);
      return { ok: true, _cookie: cookieHeader("", 0) };
    },
    "POST /hub/api/join": (request) => {
      requireOrigin(request);
      const session = requireSession(request, { csrf: true });
      if (!config) throw new HttpError(409, "no_season");
      if (!seasonOpen()) throw new HttpError(409, "season_not_open");
      const account = store.account(session.accountId);
      if (!account.joined?.[config.season]) store.updateAccount(account.id, { joined: { ...account.joined, [config.season]: now() } });
      return { season: config.season, ...standing(account.id) };
    },
    "POST /hub/api/activities": async (request, key) => {
      requireOrigin(request);
      const session = requireSession(request, { csrf: true });
      if (!writeLimit(key)) throw new HttpError(429, "slow_down");
      const body = await readJson(request);
      if (!config) throw new HttpError(409, "no_season");
      if (!seasonOpen()) throw new HttpError(409, "season_not_open");
      const account = store.account(session.accountId);
      if (!account.joined?.[config.season]) throw new HttpError(409, "join_first");
      if (!ACTIONS.includes(body.action)) throw new HttpError(400, "unknown_action");
      // Only the fields each native activity needs; a source, provider or Twitch field has no meaning here.
      const allowed = body.action === "poll_response" ? ["action", "pollId", "choice"] : ["action", "text"];
      if (Object.keys(body).some((k) => !allowed.includes(k))) throw new HttpError(400, "unknown_field");
      let id;
      let detail;
      if (body.action === "poll_response") {
        if (typeof body.pollId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.pollId)) throw new HttpError(400, "poll_id_required");
        const poll = pollFor(polls, now());
        if (!poll || poll.id !== body.pollId) throw new HttpError(409, "poll_not_open");
        if (poll.placeholder) throw new HttpError(409, "poll_not_creditable");
        if (!Number.isInteger(body.choice) || body.choice < 0 || body.choice >= poll.options.length) throw new HttpError(400, "choice_required");
        id = actionId([config.season, "poll_response", body.pollId]);
        detail = { pollId: body.pollId, choice: body.choice };
      } else {
        const t = text(body.text);
        id = actionId([config.season, body.action, t]);
        detail = { text: t };
      }
      if (seasonRows().some((s) => s.accountId === account.id && s.actionId === id)) throw new HttpError(409, "already_submitted");
      const row = store.addSubmission({
        id: sha256hex(`${account.id}:${id}`),
        accountId: account.id,
        season: config.season,
        action: body.action,
        actionId: id,
        occurredAt: now(),
        status: body.action === "accepted_work" ? "pending" : "credited",
        detail,
      });
      return { submission: { id: row.id, action: row.action, status: row.status, occurredAt: row.occurredAt }, ...standing(account.id) };
    },
  };

  const finalizer = seasons ? createSeasonFinalizer({ seasons, store, rank: (credited, c = config) => rankAccounts(c.policy, credited), handleOf, now, log, ...(schedule ? { schedule } : {}), ...(cancel ? { cancel } : {}) }) : null;

  const hubApi = async function hubApi(request, response) {
    const head = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Cookie, Origin" };
    const reply = (status, body, extra = {}) => {
      response.writeHead(status, { ...head, ...extra });
      response.end(JSON.stringify(body));
    };
    if (seasons) {
      const current = seasons.at(now());
      if (current.season !== config.season) {
        config = current;
        // The season that just ended is frozen now rather than waiting for its timer, so its recap is served from the first second.
        try { finalizer?.freeze(); } catch (error) { log.warn?.(`season rollover: freeze failed: ${error?.message ?? error}`); }
      }
    }
    const key = clientKey(request);
    if (key === null) return reply(403, { error: "not_through_the_edge" });
    // Same URL-parse guard as the live server: "http://[" is a 400, not a crash.
    let pathname;
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      return reply(400, { error: "bad_request" });
    }
    const badge = request.method === "GET" ? /^\/hub\/api\/badge\/([a-z0-9][a-z0-9_-]{1,31})\.svg$/.exec(pathname) : null;
    if (badge) {
      if (!readLimit(key)) return reply(429, { error: "slow_down" });
      const entry = market ? listingsNow().find((e) => e.slug === badge[1]) : null;
      if (!entry) return reply(404, { error: "no_such_listing" });
      const view = marketListing(entry);
      // A public image meant to be embedded anywhere: cacheable for a few minutes, inert, and framed by nothing.
      response.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin" });
      return response.end(renderBadge({ listing: view, performance: view.performance }));
    }
    const route = routes[`${request.method} ${pathname}`] ?? (request.method === "GET" ? marketListingRoute(pathname) ?? seasonRoute(pathname) : null);
    if (!route) {
      if (Object.keys(routes).some((r) => r.endsWith(` ${pathname}`))) return reply(405, { error: "method_not_allowed" }, { Allow: request.method === "GET" ? "POST" : "GET" });
      return reply(404, { error: "not_found" });
    }
    if (request.method === "GET" && !readLimit(key)) return reply(429, { error: "slow_down" });
    try {
      store.expireSessions(now());
      const { _cookie, ...body } = await route(request, key);
      return reply(200, body, _cookie ? { "Set-Cookie": _cookie } : {});
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { error: error.code, detail: error.message === error.code ? undefined : error.message });
      log.warn?.(`hub api: ${pathname} failed: ${error?.message ?? error}`);
      return reply(500, { error: "hub_api_failed" });
    }
  };
  // The station starts and stops the finalizer with the server.
  hubApi.start = () => finalizer?.start();
  hubApi.stop = () => finalizer?.stop();
  hubApi.finalizer = finalizer;
  return hubApi;
}
