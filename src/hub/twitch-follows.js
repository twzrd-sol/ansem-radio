// A one-shot, read-only Twitch follows import. The caller owns the transient token and user ID;
// this adapter sends them only to Helix and returns slugs already present in the curated catalog.
import { HttpError } from "../platform/guard.js";

export const TWITCH_FOLLOWED_CHANNELS = "https://api.twitch.tv/helix/channels/followed";
const rejected = () => new HttpError(400, "twitch_follows_rejected");
const unavailable = () => new HttpError(502, "twitch_follows_unavailable");
const incomplete = () => new HttpError(502, "twitch_follows_incomplete");
const LOGIN = /^[a-z0-9_]{3,25}$/;
const SLUG = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const USER_ID = /^[0-9]{1,32}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;

async function boundedJson(response, maxBytes, signal) {
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let cancelReader = false;
  let abortRead;
  const abort = new Promise((_, reject) => {
    abortRead = () => reject(unavailable());
    if (signal.aborted) abortRead();
    else signal.addEventListener("abort", abortRead, { once: true });
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), abort]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        cancelReader = true;
        throw unavailable();
      }
      chunks.push(Buffer.from(value));
    }
    signal.removeEventListener("abort", abortRead);
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      throw unavailable();
    }
  } catch (error) {
    cancelReader = true;
    if (error?.code === "twitch_follows_unavailable") throw error;
    throw unavailable();
  } finally {
    signal.removeEventListener("abort", abortRead);
    if (cancelReader) void reader.cancel().catch(() => {});
    else reader.releaseLock();
  }
}

function cleanCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length > 200) throw rejected();
  const byLogin = new Map();
  for (const row of catalog) {
    if (!row || typeof row !== "object" || typeof row.slug !== "string" || !SLUG.test(row.slug)
      || typeof row.login !== "string" || !LOGIN.test(row.login.toLowerCase())) throw rejected();
    const login = row.login.toLowerCase();
    if (byLogin.has(login)) throw rejected();
    byLogin.set(login, row.slug);
  }
  return byLogin;
}

/**
 * Make a bounded Helix follows reader. `accessToken` is used only for these requests and is never
 * retained. `catalog` contains the current curated Twitch logins, so unknown channels are omitted.
 */
export function createTwitchFollowsAdapter({
  fetchImpl = globalThis.fetch,
  clientId,
  timeoutMs = 8_000,
  maxPages = 5,
  maxResponseBytes = 65_536,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  if (typeof fetchImpl !== "function" || typeof clientId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(clientId)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000
    || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10
    || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 262_144
    || typeof now !== "function") {
    throw new TypeError("invalid Twitch follows adapter configuration");
  }

  return async function listKnownFollowedSlugs({ accessToken, userId, catalog } = {}) {
    if (typeof accessToken !== "string" || accessToken.length < 1 || accessToken.length > 8192 || /[\u0000-\u0020\u007f]/.test(accessToken)
      || typeof userId !== "string" || !USER_ID.test(userId)) throw rejected();
    const known = cleanCatalog(catalog);
    const matched = new Set();
    const seenCursors = new Set();
    const deadline = now() + timeoutMs;
    let cursor = null;

    for (let page = 0; page < maxPages; page += 1) {
      const remainingMs = Math.ceil(deadline - now());
      if (remainingMs <= 0) throw unavailable();
      const signal = AbortSignal.timeout(remainingMs);
      const url = new URL(TWITCH_FOLLOWED_CHANNELS);
      url.searchParams.set("user_id", userId);
      url.searchParams.set("first", "100");
      if (cursor) url.searchParams.set("after", cursor);
      let response;
      try {
        response = await fetchImpl(url, {
          redirect: "error",
          signal,
          headers: { accept: "application/json", "Client-Id": clientId, authorization: `Bearer ${accessToken}` },
        });
      } catch {
        throw unavailable();
      }
      if (now() >= deadline) throw unavailable();
      if (!response.ok) throw unavailable();
      const body = await boundedJson(response, maxResponseBytes, signal);
      if (now() >= deadline) throw unavailable();
      if (!body || !Array.isArray(body.data) || body.data.length > 100 || !body.pagination || typeof body.pagination !== "object") throw unavailable();
      for (const row of body.data) {
        if (!row || typeof row.broadcaster_login !== "string" || !LOGIN.test(row.broadcaster_login.toLowerCase())) throw unavailable();
        const slug = known.get(row.broadcaster_login.toLowerCase());
        if (slug) matched.add(slug);
      }
      const next = body.pagination.cursor;
      if (next === undefined || next === null || next === "") {
        cursor = null;
        break;
      }
      if (typeof next !== "string" || !CURSOR.test(next) || seenCursors.has(next)) throw unavailable();
      seenCursors.add(next);
      cursor = next;
    }
    if (cursor !== null) throw incomplete();
    if (now() >= deadline) throw unavailable();
    return [...matched];
  };
}
