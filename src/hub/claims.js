// SPDX-License-Identifier: MIT
// A listing is open to anyone; a streamer can later make it theirs by signing in with Twitch. A claim binds the
// stable Twitch user id (not the login, which can change) to a listing whose channel login matches the verified
// username. It grants a "Claimed" mark and nothing else: no points, no deposit, withdrawal or payout authority,
// and Twitch data never reaches points. Tokens and ID tokens are never stored here.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HttpError, readJson } from "../platform/guard.js";
import { BANNED_STREAMERS, OFFICIAL_STREAMER } from "./registry.js";

const SLUG = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export function createClaimStore({ dir }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "claims.json");
  let state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { v: 1, claims: {} };
  if (state?.v !== 1 || !state.claims || typeof state.claims !== "object" || Array.isArray(state.claims)) throw new TypeError("unknown hub claim store version");
  if (state.retired !== undefined && (!state.retired || typeof state.retired !== "object" || Array.isArray(state.retired))) throw new TypeError("unknown hub claim store version");
  state = { v: 1, claims: state.claims, retired: state.retired ?? {} };
  const write = (claims, retired = state.retired) => {
    writeFileSync(`${path}.tmp`, JSON.stringify({ v: 1, claims, retired }), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    state = { v: 1, claims, retired };
  };
  return {
    get: (slug) => (state.claims[slug] ? structuredClone(state.claims[slug]) : null),
    has: (slug) => Boolean(state.claims[slug]),
    slugs: () => Object.keys(state.claims).sort(),
    set(slug, record) {
      write({ ...state.claims, [slug]: record });
    },
    // Pin the backing pair on a claim once an arena for it exists (or is about to): from then on the listing keeps this
    // pair whatever the account's linked wallet does, so fans' positions never lose their listing.
    pin(slug, pair) {
      const have = state.claims[slug];
      if (!have || have.pair) return false;
      write({ ...state.claims, [slug]: { ...have, pair: { streamer: pair.streamer, mint: pair.mint, pinnedAt: Math.floor(Date.now() / 1000) } } });
      return true;
    },
    // The pair of a released page. Releasing drops the "claimed" mark and the right to set up, but never the link
    // between a listing and the arena fans may have backed: that association outlives the claim.
    retired: (slug) => (state.retired[slug] ? structuredClone(state.retired[slug]) : null),
    retire(slug, pair) {
      const { [slug]: _gone, ...rest } = state.claims;
      write(rest, { ...state.retired, [slug]: { streamer: pair.streamer, mint: pair.mint, retiredAt: Math.floor(Date.now() / 1000) } });
    },
    delete(slug) {
      const { [slug]: _gone, ...rest } = state.claims;
      write(rest);
    },
  };
}

/**
 * The backing pair a claimed listing gets: the claiming account's verified linked wallet as streamer, with the
 * station's default mint, or the featured listing's mint when that setting is unset. `identityOf(accountId)` is
 * the account's links. Returns `{ streamer, mint }` or `{ error }` with one of: not_claimed, wallet_link_required,
 * wallet_not_allowed, no_default_mint. The caller supplies the already-resolved mint; this function does not
 * invent one. It never overrides an operator-set pair (the caller skips listings that already have one), refuses
 * the keys the registry refuses and the official streamer's, and reads nothing from Twitch.
 */
export function deriveClaimPair({ claim, identityOf, defaultMint }) {
  if (!claim) return { error: "not_claimed" };
  if (claim.pair) {
    // A pinned pair no longer follows the linked wallet, but the banned and official keys are refused here too.
    if (BANNED_STREAMERS.includes(claim.pair.streamer) || claim.pair.streamer === OFFICIAL_STREAMER) return { error: "wallet_not_allowed" };
    return { streamer: claim.pair.streamer, mint: claim.pair.mint, pinned: true };
  }
  const wallet = identityOf(claim.accountId)?.wallet?.address ?? null;
  if (!wallet) return { error: "wallet_link_required" };
  if (BANNED_STREAMERS.includes(wallet) || wallet === OFFICIAL_STREAMER) return { error: "wallet_not_allowed" };
  if (!defaultMint) return { error: "no_default_mint" };
  return { streamer: wallet, mint: defaultMint };
}

/** `registry`: the listings; `twitchOf(accountId)`: the account's verified Twitch link or null. */
export function createClaimRoutes({ registry, claims, twitchOf, resolveTwitchUser, requireOrigin, requireSession, authLimit, now, defaultMint = null }) {
  const writeSession = (request, key) => {
    requireOrigin(request);
    const session = requireSession(request, { csrf: true });
    if (!authLimit(key)) throw new HttpError(429, "slow_down");
    return session;
  };
  const slugOf = async (request) => {
    const body = await readJson(request, 1024);
    if (Object.keys(body).some((k) => k !== "slug")) throw new HttpError(400, "unknown_field");
    if (typeof body.slug !== "string" || !SLUG.test(body.slug)) throw new HttpError(400, "slug_required");
    return body.slug;
  };
  return {
    // Public, and only the mark: no subject, login or account id is exposed.
    "GET /hub/api/claims": () => ({ claimed: claims.slugs().map((slug) => ({ slug, claimedAt: claims.get(slug).claimedAt })), generatedAt: now() }),
    "POST /hub/api/claims": async (request, key) => {
      const session = writeSession(request, key);
      const slug = await slugOf(request);
      const entry = (typeof registry === "function" ? registry() : registry).find((e) => e.slug === slug);
      if (!entry) throw new HttpError(404, "no_such_listing");
      if (!entry.twitch) throw new HttpError(409, "listing_has_no_channel");
      const link = twitchOf(session.accountId)?.twitch ?? null;
      if (!link) throw new HttpError(409, "twitch_link_required");
      if (typeof link.subject !== "string" || !/^[0-9]{1,32}$/.test(link.subject) || typeof resolveTwitchUser !== "function") throw new HttpError(503, "twitch_account_unavailable");
      let twitchUser;
      try { twitchUser = await resolveTwitchUser(link.subject); } catch { throw new HttpError(503, "twitch_account_unavailable"); }
      if (!twitchUser || twitchUser.id !== link.subject || typeof twitchUser.login !== "string" || !/^[a-z0-9_]{1,25}$/i.test(twitchUser.login)) throw new HttpError(503, "twitch_account_unavailable");
      if (twitchUser.login.toLowerCase() !== entry.twitch.toLowerCase()) throw new HttpError(403, "not_your_channel");
      const have = claims.get(slug);
      if (have && have.subject !== link.subject) throw new HttpError(409, "already_claimed");
      if (!have) claims.set(slug, { subject: link.subject, accountId: session.accountId, login: entry.twitch, claimedAt: now() });
      return { slug, claimed: true, claimedAt: claims.get(slug).claimedAt };
    },
    // What the signed-in streamer holds and whether each listing is ready to be backed: for the "Your page" panel.
    "GET /hub/api/claims/mine": (request) => {
      const session = requireSession(request, { csrf: false });
      const listings = typeof registry === "function" ? registry() : registry;
      const wallet = twitchOf(session.accountId)?.wallet?.address ?? null;
      const mine = claims.slugs().filter((slug) => claims.get(slug).accountId === session.accountId).map((slug) => {
        const entry = listings.find((e) => e.slug === slug);
        const fixed = Boolean(entry?.streamer) && !entry?.claimDerived;
        const pair = fixed ? null : deriveClaimPair({ claim: claims.get(slug), identityOf: twitchOf, defaultMint });
        const differs = Boolean(pair?.pinned) && wallet !== pair.streamer;
        return { slug, wallet, pinned: pair?.pinned ? { streamer: pair.streamer, mint: pair.mint } : null, ready: Boolean(pair?.streamer), reason: fixed ? "operator_set" : pair?.error ?? (differs ? "wallet_differs_from_pinned" : null) };
      });
      return { claims: mine, generatedAt: now() };
    },
    // The authoritative answer to "may I create the arena for this listing, and as whom": refuses with a clear reason.
    "POST /hub/api/claims/setup": async (request, key) => {
      const session = writeSession(request, key);
      const slug = await slugOf(request);
      const entry = (typeof registry === "function" ? registry() : registry).find((e) => e.slug === slug);
      if (!entry) throw new HttpError(404, "no_such_listing");
      const claim = claims.get(slug);
      if (claim && claim.accountId !== session.accountId) throw new HttpError(403, "not_your_claim");
      // A released page stays tied to the arena fans may have backed; nobody can set it up under a different wallet.
      if (!claim?.pair && claims.retired(slug)) throw new HttpError(409, "listing_tied_to_released_arena");
      if (entry.streamer && !entry.claimDerived) throw new HttpError(409, "listing_has_operator_pair");
      const pair = deriveClaimPair({ claim, identityOf: twitchOf, defaultMint });
      if (pair.error) throw new HttpError(pair.error === "wallet_not_allowed" ? 403 : 409, pair.error);
      if (claim) claims.pin(slug, pair);
      return { slug, streamer: pair.streamer, mint: pair.mint };
    },
    "POST /hub/api/claims/release": async (request, key) => {
      const session = writeSession(request, key);
      const slug = await slugOf(request);
      const have = claims.get(slug);
      if (!have || have.accountId !== session.accountId) throw new HttpError(404, "no_such_claim");
      // Releasing never strands anyone: a pinned pair is kept (retired) so the listing stays tied to its arena and
      // fans' positions keep their listing and their way out. No reading of the chain is trusted here.
      if (have.pair) claims.retire(slug, have.pair);
      else claims.delete(slug);
      return { slug, claimed: false };
    },
  };
}
