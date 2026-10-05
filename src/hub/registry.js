/**
 * The streamer registry behind the hub's market (docs/DECISION_20261002_MULTI_STREAMER_PATH.md, Stage 1): an
 * operator-curated allowlist of listings. A listing is a Twitch login to show public metrics for, and optionally the
 * streamer key and mint whose arena fans may back. Nothing here is a score, a price or a consent record: a key in the
 * registry proves the operator listed it, not that the person behind a login holds it.
 *
 * The default registry is Radio LAN (featured; the official streamer key, F-7) plus the station's tracked logins
 * (S-2 default, imported, never duplicated). RADIOLAN_HUB_REGISTRY points at a JSON file that replaces it. Keys the
 * hub must never present (F-7, F-8; apps/hub/src/chain/config.spec.ts scans the app source for the same set) are
 * refused here, because the app cannot see a runtime file.
 */
import { readFileSync } from "node:fs";

import { decodePublicKey } from "../core/base58.js";
import { TRACKED_STREAMERS } from "../markets/twitch-metrics.js";

export const OFFICIAL_STREAMER = "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb";
export const KINDS = Object.freeze(["featured", "tracked", "demo"]);

/** Never a listing's streamer, never shown as backable: the upgrade key, the internal test arena's streamer, the ops wallet. */
export const BANNED_STREAMERS = Object.freeze([
  "EatwUpB2eCRcCEJgvQvzNb1hiPKqasjzXQ7NtVVFuLYX",
  "GbscvafBJEkWutxm3Bi6AYfXztfojW6Jj7Yaw1TM3PhT",
  "FmpHGDih183cr7TmHgFMTJ2QgVEfUPKC2YAUG1W8K8A5",
]);
/** Never a listing's arena, whatever derives it: the internal test arena and the superseded candidate. */
export const BANNED_ARENAS = Object.freeze(["GwYjjFYcc4DV8hLE6bCAQiM3rjstGWNZ6p3icjR7ZnxU", "9tUxpgaNp2PWdczS2v1AmDKTjtGvaTLCLzu4TLNCp2KU"]);

const SLUG = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const LOGIN = /^[a-z0-9_]{3,25}$/;

function text(value, field, max = 60) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`registry: ${field} must be 1-${max} characters`);
  return value.trim();
}

function key(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new TypeError(`registry: ${field} must be a base58 key or null`);
  decodePublicKey(value, field);
  return value;
}

/** One validated, frozen listing. `streamer` and `mint` are both set or both null: an arena needs the pair. */
export function listing(input) {
  if (!input || typeof input !== "object") throw new TypeError("registry: a listing must be an object");
  const slug = text(input.slug, "slug", 32);
  if (!SLUG.test(slug)) throw new TypeError(`registry: bad slug ${JSON.stringify(slug)}`);
  const name = text(input.name, "name");
  const kind = input.kind;
  if (!KINDS.includes(kind)) throw new TypeError(`registry: kind must be one of ${KINDS.join(", ")}`);
  let twitch = null;
  if (input.twitch !== null && input.twitch !== undefined) {
    twitch = text(input.twitch, "twitch", 25).toLowerCase();
    if (!LOGIN.test(twitch)) throw new TypeError(`registry: bad Twitch login for ${slug}`);
  }
  const streamer = key(input.streamer, `streamer of ${slug}`);
  const mint = key(input.mint, `mint of ${slug}`);
  if ((streamer === null) !== (mint === null)) throw new TypeError(`registry: ${slug} needs both streamer and mint, or neither`);
  if (streamer && BANNED_STREAMERS.includes(streamer)) throw new TypeError(`registry: ${slug} names a key the hub never presents`);
  if (kind === "featured" && streamer && streamer !== OFFICIAL_STREAMER) throw new TypeError("registry: the featured listing's streamer is the official key");
  const blurb = input.blurb === undefined || input.blurb === null ? null : text(input.blurb, "blurb", 160);
  return Object.freeze({ slug, name, kind, twitch, streamer, mint, blurb });
}

/** A whole registry: unique slugs, unique streamers, at most one featured listing. */
export function registry(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 200) throw new TypeError("registry: 1 to 200 listings");
  const rows = entries.map(listing);
  const slugs = new Set();
  const streamers = new Set();
  let featured = 0;
  for (const row of rows) {
    if (slugs.has(row.slug)) throw new TypeError(`registry: duplicate slug ${row.slug}`);
    slugs.add(row.slug);
    if (row.streamer) {
      const pair = `${row.streamer}:${row.mint}`;
      if (streamers.has(pair)) throw new TypeError(`registry: duplicate arena for ${row.slug}`);
      streamers.add(pair);
    }
    if (row.kind === "featured") featured += 1;
  }
  if (featured > 1) throw new TypeError("registry: at most one featured listing");
  return Object.freeze(rows);
}

/** Radio LAN plus the tracked logins. `mint` is the devnet test mint the operator sets; without it nothing is backable. */
export function defaultRegistry({ mint = null } = {}) {
  const lan = { slug: "radiolanlive", name: "Radio LAN", kind: "featured", twitch: "radiolanlive", streamer: mint ? OFFICIAL_STREAMER : null, mint: mint ?? null, blurb: "The station that buys its next show." };
  const tracked = TRACKED_STREAMERS.map((login) => ({ slug: login.replace(/_+$/, "") || login, name: login, kind: "tracked", twitch: login, streamer: null, mint: null }));
  return registry([lan, ...tracked]);
}

/** The registry from a JSON file (an array of listings), or the default when no path is given. */
/** $RLAN on mainnet: the featured listing's mint when the station runs on mainnet. */
export const RLAN_MINT = "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy";

/** The mint the station backs by default: $RLAN on mainnet, the operator's test mint on devnet, or none. */
export const defaultMintFor = (network = "devnet", env = process.env) => (network === "mainnet" ? RLAN_MINT : env.RADIOLAN_HUB_TEST_MINT ?? null);

/** The mint the featured listing already carries, or null. Never invents an address. */
export function featuredMintOf(listings = []) {
  if (!Array.isArray(listings)) return null;
  const featured = listings.find((row) => row && row.kind === "featured");
  return featured?.mint ?? null;
}

/**
 * Mint used for a claim-derived pair: the station-wide default, else the featured listing's mint, else none.
 * Does not substitute $RLAN or any other hardcoded address.
 */
export function mintForClaims({ defaultMint = null, listings = [] } = {}) {
  return defaultMint ?? featuredMintOf(listings) ?? null;
}

export function loadRegistry({ path = process.env.RADIOLAN_HUB_REGISTRY, network = process.env.RADIOLAN_HUB_NETWORK ?? "devnet", mint = defaultMintFor(network) } = {}) {
  if (!path) return defaultRegistry({ mint });
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return registry(Array.isArray(parsed) ? parsed : parsed?.listings);
}
