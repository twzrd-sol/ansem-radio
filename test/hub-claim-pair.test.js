import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { encodeBase58 } from "../src/core/base58.js";
import { createHubApi } from "../src/hub/api.js";
import { deriveClaimPair } from "../src/hub/claims.js";
import { createHubIdentityStore } from "../src/hub/identity-store.js";
import { BANNED_STREAMERS, defaultRegistry, featuredMintOf, mintForClaims, OFFICIAL_STREAMER, registry, RLAN_MINT } from "../src/hub/registry.js";
import { createHubStore } from "../src/hub/store.js";
import { TWITCH_ISSUER, TWITCH_KEYS } from "../src/hub/twitch-identity.js";

const ORIGIN = "https://hub.example";
const NOW = 1_791_025_000;
const MINT = "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy";
const FEATURED_MINT = "9ocVrg8z6wva3Z7A3rLYU4fWXFXWWf6sC4aGV7fgSJuN";
const OTHER_STREAMER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "twitch-test", use: "sig", alg: "RS256" };
const idToken = (payload) => {
  const text = [{ alg: "RS256", kid: jwk.kid }, payload].map((v) => Buffer.from(JSON.stringify(v)).toString("base64url")).join(".");
  return `${text}.${sign("RSA-SHA256", Buffer.from(text), rsa.privateKey).toString("base64url")}`;
};
const keysFetch = async (url) => { assert.equal(url, TWITCH_KEYS); return new Response(JSON.stringify({ keys: [jwk] })); };

function listings({ fixed = false, featuredMint = null, featured = false, alias = false } = {}) {
  const rows = [
    { slug: "alpha", name: "Alpha", kind: "tracked", twitch: "alpha_live", streamer: fixed ? OTHER_STREAMER : null, mint: fixed ? MINT : null },
    { slug: "beta", name: "Beta", kind: "tracked", twitch: alias ? "alpha_live" : "beta_live", streamer: null, mint: null },
  ];
  if (featuredMint || featured) {
    rows.unshift({ slug: "radiolanlive", name: "Radio LAN", kind: "featured", twitch: "radiolanlive", streamer: featuredMint ? OFFICIAL_STREAMER : null, mint: featuredMint });
  }
  return registry(rows);
}

async function harness(t, { observedAt = "2026-10-04T00:00:00Z", stale = false,  defaultMint = MINT, fixed = false, featuredMint = null, featured = false, alias = false, board = () => null, arena = () => null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hub-claim-pair-"));
  const store = createHubStore({ dir });
  const sessions = ["a", "b"].map((letter) => {
    const accountId = letter.repeat(64);
    store.createAccount({ id: accountId, credentials: [], joined: {}, createdAt: NOW });
    return store.createSession({ id: randomBytes(32).toString("base64url"), accountId, csrf: randomBytes(32).toString("base64url"), expiresAt: NOW + 1000 });
  });
  const identityStore = createHubIdentityStore({ dir });
  const helixLogins = new Map();
  const market = { registry: listings({ fixed, featuredMint, featured, alias }), board, index: { listingArena: (pair) => arena(pair), status: () => ({ network: "devnet", observedAt, slot: null, stale }), positionsOf: () => [], history: () => [] } };
  const api = createHubApi({ origins: ORIGIN, store, now: () => NOW, market, defaultMint, resolveTwitchUser: async (id) => ({ id, login: helixLogins.get(id) }), identity: { store: identityStore, twitch: { clientId: "public-client", redirectUri: `${ORIGIN}/hub/twitch` }, fetchImpl: keysFetch }, limits: { read: 500, write: 500, auth: 500 } });
  const server = createServer(api);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path, { session = sessions[0], method = "POST", body = {}, origin = ORIGIN, csrf = session?.csrf } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/hub/api${path}`, { method, headers: { origin, ...(session ? { cookie: `hub_session=${session.id}` } : {}), ...(csrf ? { "x-hub-csrf": csrf } : {}), "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  const linkTwitch = async (session, sub, username) => {
    helixLogins.set(sub, username);
    const start = (await call("/identity/twitch/start", { session })).json;
    const nonce = new URL(start.url).searchParams.get("nonce");
    return call("/identity/twitch/finish", { session, body: { state: start.state, idToken: idToken({ iss: TWITCH_ISSUER, aud: "public-client", azp: "public-client", sub, preferred_username: username, iat: NOW - 10, exp: NOW + 600, nonce }) } });
  };
  // A real wallet link: the existing start/finish routes with an ed25519 signature over the issued message.
  const linkWallet = async (session) => {
    const pair = generateKeyPairSync("ed25519");
    const address = encodeBase58(Buffer.from(pair.publicKey.export({ format: "jwk" }).x, "base64url"));
    const start = (await call("/identity/wallet/start", { session, body: { address } })).json;
    const signature = sign(null, Buffer.from(start.message), pair.privateKey).toString("base64url");
    const done = await call("/identity/wallet/finish", { session, body: { challenge: start.challenge, signature } });
    assert.equal(done.status, 200);
    return address;
  };
  const listing = async (slug) => (await call("/market", { method: "GET", session: null })).json.listings.find((l) => l.slug === slug);
  return { call, sessions, linkTwitch, linkWallet, listing, identityStore };
}

describe("claim-derived backing pair", () => {
  it("gives a claimed listing {the claimer's linked wallet, the default mint} and nothing before that", async (t) => {
    const h = await harness(t);
    assert.equal((await h.listing("alpha")).keys, null, "unclaimed: no pair");
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    const claimed = await h.listing("alpha");
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.keys, null, "claimed but no wallet linked: no pair");
    assert.equal(claimed.claimDerived, false);
    const wallet = await h.linkWallet(h.sessions[0]);
    const ready = await h.listing("alpha");
    assert.deepEqual(ready.keys, { streamer: wallet, mint: MINT });
    assert.equal(ready.claimDerived, true);
    assert.equal(ready.backingOpen, false, "the pair only makes an arena findable; no arena yet");
    assert.equal((await h.listing("beta")).keys, null, "other listings are untouched");
  });

  it("refuses the setup answer with a clear reason for an unclaimed listing, a missing wallet and another account", async (t) => {
    const h = await harness(t);
    const ask = (session, slug = "alpha") => h.call("/claims/setup", { session, body: { slug } });
    assert.deepEqual([(await ask(h.sessions[0])).status, (await ask(h.sessions[0])).json.error], [409, "not_claimed"]);
    assert.equal((await ask(h.sessions[0], "ghost")).status, 404);
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    assert.deepEqual([(await ask(h.sessions[0])).status, (await ask(h.sessions[0])).json.error], [409, "wallet_link_required"]);
    const wallet = await h.linkWallet(h.sessions[0]);
    assert.deepEqual(await ask(h.sessions[0]).then((r) => r.json), { slug: "alpha", streamer: wallet, mint: MINT });
    await h.linkWallet(h.sessions[1]);
    assert.deepEqual([(await ask(h.sessions[1])).status, (await ask(h.sessions[1])).json.error], [403, "not_your_claim"], "another account's wallet cannot set up this listing");
  });

  it("requires origin, a session and CSRF for the setup answer", async (t) => {
    const h = await harness(t);
    assert.equal((await h.call("/claims/setup", { origin: "https://else.example", body: { slug: "alpha" } })).status, 403);
    assert.equal((await h.call("/claims/setup", { session: null, body: { slug: "alpha" } })).status, 401);
    assert.equal((await h.call("/claims/setup", { csrf: "wrong", body: { slug: "alpha" } })).status, 403);
    assert.equal((await h.call("/claims/mine", { method: "GET", session: null })).status, 401);
  });

  it("tells the signed-in streamer what they hold and whether each listing is ready, for the panel", async (t) => {
    const h = await harness(t);
    assert.deepEqual((await h.call("/claims/mine", { method: "GET" })).json.claims, []);
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    let mine = (await h.call("/claims/mine", { method: "GET" })).json.claims;
    assert.deepEqual(mine, [{ slug: "alpha", wallet: null, pinned: null, ready: false, reason: "wallet_link_required" }]);
    const wallet = await h.linkWallet(h.sessions[0]);
    mine = (await h.call("/claims/mine", { method: "GET" })).json.claims;
    assert.deepEqual(mine, [{ slug: "alpha", wallet, pinned: null, ready: true, reason: null }]);
    assert.deepEqual((await h.call("/claims/mine", { method: "GET", session: h.sessions[1] })).json.claims, [], "only the claimer's own listings");
  });

  it("follows the wallet: unlinking removes the pair, and the listing is never backable under someone else's key", async (t) => {
    const h = await harness(t);
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    await h.linkWallet(h.sessions[0]);
    assert.ok((await h.listing("alpha")).keys);
    await h.call("/identity/wallet/unlink");
    assert.equal((await h.listing("alpha")).keys, null);
  });

  it("never overrides an operator-set pair", async (t) => {
    const h = await harness(t, { fixed: true });
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    await h.linkWallet(h.sessions[0]);
    const l = await h.listing("alpha");
    assert.deepEqual(l.keys, { streamer: OTHER_STREAMER, mint: MINT });
    assert.equal(l.claimDerived, false);
    assert.deepEqual([(await h.call("/claims/setup", { body: { slug: "alpha" } })).status, (await h.call("/claims/setup", { body: { slug: "alpha" } })).json.error], [409, "listing_has_operator_pair"]);
    assert.equal((await h.call("/claims/mine", { method: "GET" })).json.claims[0].reason, "operator_set");
  });

  it("derives nothing when the station has no default mint", async (t) => {
    const h = await harness(t, { defaultMint: null });
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    await h.linkWallet(h.sessions[0]);
    assert.equal((await h.listing("alpha")).keys, null);
    assert.deepEqual([(await h.call("/claims/setup", { body: { slug: "alpha" } })).status, (await h.call("/claims/setup", { body: { slug: "alpha" } })).json.error], [409, "no_default_mint"]);
  });

  it("falls back to the featured listing's mint when the station default is unset", async (t) => {
    const h = await harness(t, { defaultMint: null, featuredMint: FEATURED_MINT });
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    const wallet = await h.linkWallet(h.sessions[0]);
    const ready = await h.listing("alpha");
    assert.deepEqual(ready.keys, { streamer: wallet, mint: FEATURED_MINT });
    assert.notEqual(ready.keys.mint, RLAN_MINT, "does not substitute $RLAN");
    assert.equal(ready.claimDerived, true);
    const setup = await h.call("/claims/setup", { body: { slug: "alpha" } });
    assert.equal(setup.status, 200);
    assert.equal(setup.json.mint, FEATURED_MINT);
    const mine = (await h.call("/claims/mine", { method: "GET" })).json.claims[0];
    assert.equal(mine.ready, true);
    assert.equal(mine.reason, null);
  });

  it("still refuses when the featured listing also has no mint", async (t) => {
    const h = await harness(t, { defaultMint: null, featured: true });
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    await h.linkWallet(h.sessions[0]);
    assert.equal((await h.listing("alpha")).keys, null);
    assert.deepEqual([(await h.call("/claims/setup", { body: { slug: "alpha" } })).status, (await h.call("/claims/setup", { body: { slug: "alpha" } })).json.error], [409, "no_default_mint"]);
  });

  it("keeps an operator default mint ahead of the featured listing's mint", async (t) => {
    const h = await harness(t, { defaultMint: MINT, featuredMint: FEATURED_MINT });
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    const wallet = await h.linkWallet(h.sessions[0]);
    assert.deepEqual((await h.listing("alpha")).keys, { streamer: wallet, mint: MINT });
  });

  it("is not moved by Twitch data: the pair is the same whatever the channel reads", async (t) => {
    let viewers = 10;
    const h = await harness(t, { board: () => ({ live: true, viewers, game: "Just Chatting", startedAt: null, rank: 1, deltaViewers: null, provenance: "Data: Twitch." }) });
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    const wallet = await h.linkWallet(h.sessions[0]);
    const before = (await h.listing("alpha")).keys;
    viewers = 9_000_000;
    const after = await h.listing("alpha");
    assert.deepEqual(after.keys, before);
    assert.deepEqual(after.keys, { streamer: wallet, mint: MINT });
    assert.equal(after.performance.viewers, 9_000_000, "the reading is shown, and only shown");
  });

  it("refuses a claim whose display name was rewritten to another channel", async (t) => {
    const h = await harness(t);
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    const wallet = await h.linkWallet(h.sessions[0]);
    h.identityStore.link(h.sessions[0].accountId, "twitch", { subject: "1001", displayName: "beta_live", verifiedAt: NOW });
    const spoofed = await h.call("/claims", { body: { slug: "beta" } });
    assert.equal(spoofed.status, 403);
    assert.equal(spoofed.json.error, "not_your_channel");
    const pairs = [(await h.listing("alpha")).keys, (await h.listing("beta")).keys].filter(Boolean);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].streamer, wallet);
  });
  it("does not publish the same wallet pair on a second listing", async (t) => {
    const h = await harness(t, { alias: true });
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    const wallet = await h.linkWallet(h.sessions[0]);
    assert.equal((await h.call("/claims", { body: { slug: "beta" } })).status, 200);
    const pairs = [(await h.listing("alpha")).keys, (await h.listing("beta")).keys].filter(Boolean);
    assert.equal(pairs.length, 1, "the second listing is skipped");
    assert.equal(pairs[0].streamer, wallet);
  });
});

describe("deriveClaimPair", () => {
  const claim = { accountId: "a".repeat(64), subject: "1" };
  const identityOf = (address) => () => ({ wallet: address ? { address } : null });
  it("refuses the registry's banned keys and the official streamer's, whatever the account verified", () => {
    for (const banned of [...BANNED_STREAMERS, OFFICIAL_STREAMER]) assert.deepEqual(deriveClaimPair({ claim, identityOf: identityOf(banned), defaultMint: MINT }), { error: "wallet_not_allowed" });
  });
  it("answers each missing precondition with its own error and a good wallet with the pair", () => {
    assert.deepEqual(deriveClaimPair({ claim: null, identityOf: identityOf(OTHER_STREAMER), defaultMint: MINT }), { error: "not_claimed" });
    assert.deepEqual(deriveClaimPair({ claim, identityOf: identityOf(null), defaultMint: MINT }), { error: "wallet_link_required" });
    assert.deepEqual(deriveClaimPair({ claim, identityOf: identityOf(OTHER_STREAMER), defaultMint: null }), { error: "no_default_mint" });
    assert.deepEqual(deriveClaimPair({ claim, identityOf: identityOf(OTHER_STREAMER), defaultMint: MINT }), { streamer: OTHER_STREAMER, mint: MINT });
  });
});

describe("mintForClaims", () => {
  it("reads the featured listing's mint and nothing else", () => {
    const rows = listings({ featuredMint: FEATURED_MINT });
    assert.equal(featuredMintOf(rows), FEATURED_MINT);
    assert.equal(mintForClaims({ defaultMint: null, listings: rows }), FEATURED_MINT);
    assert.notEqual(mintForClaims({ defaultMint: null, listings: rows }), RLAN_MINT);
    assert.equal(mintForClaims({ defaultMint: MINT, listings: rows }), MINT);
    assert.equal(featuredMintOf(defaultRegistry()), null);
    assert.equal(mintForClaims({ defaultMint: null, listings: defaultRegistry() }), null);
    assert.equal(mintForClaims({ defaultMint: null, listings: listings({ featured: true }) }), null);
    assert.equal(mintForClaims({ defaultMint: null, listings: [] }), null);
  });
});

describe("the pair is pinned once the arena is real", () => {
  const claimWithWallet = async (h) => {
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    return h.linkWallet(h.sessions[0]);
  };
  const unlink = (h) => h.call("/identity/wallet/unlink", { body: {} });

  it("keeps the listing on the same arena after the setup answer, whatever the linked wallet does next", async (t) => {
    const h = await harness(t);
    const w1 = await claimWithWallet(h);
    assert.equal((await h.call("/claims/setup", { body: { slug: "alpha" } })).status, 200);
    assert.equal((await unlink(h)).status, 200);
    assert.deepEqual((await h.listing("alpha")).keys, { streamer: w1, mint: MINT }, "unlinking does not move a pinned listing");
    const w2 = await h.linkWallet(h.sessions[0]);
    assert.notEqual(w1, w2);
    assert.deepEqual((await h.listing("alpha")).keys, { streamer: w1, mint: MINT }, "a different wallet does not either");
  });

  it("pins when the derived pair's arena first shows up on chain, even if setup was never asked", async (t) => {
    let live = false;
    const h = await harness(t, { arena: () => (live ? { address: "arena", backers: "1", closed: false, total: "0" } : null) });
    const w1 = await claimWithWallet(h);
    assert.deepEqual((await h.listing("alpha")).keys, { streamer: w1, mint: MINT });
    live = true;
    await h.listing("alpha"); // the join sees the arena and pins
    live = false;
    await unlink(h);
    await h.linkWallet(h.sessions[0]);
    assert.deepEqual((await h.listing("alpha")).keys, { streamer: w1, mint: MINT });
  });

  it("an unpinned claim still follows the wallet (nothing is on chain yet)", async (t) => {
    const h = await harness(t);
    await claimWithWallet(h);
    await unlink(h);
    assert.equal((await h.listing("alpha")).keys, null);
  });

  it("releasing a pinned claim keeps the listing tied to its arena, whatever the board last read (no stale zero can strand fans)", async (t) => {
    // The board's reading says "no positions" (a stale or zero snapshot); a fan may have deposited since. Release must
    // not depend on that reading at all: the pair is retired, not forgotten.
    const h = await harness(t, { arena: () => ({ address: "arena", backers: "0", closed: false, total: "0" }) });
    const w1 = await claimWithWallet(h);
    await h.call("/claims/setup", { body: { slug: "alpha" } });
    assert.equal((await h.call("/claims/release", { body: { slug: "alpha" } })).status, 200);
    const after = await h.listing("alpha");
    assert.equal(after.claimed, false, "the claimed mark is gone");
    assert.deepEqual(after.keys, { streamer: w1, mint: MINT }, "but the listing still derives the same arena");
  });

  it("a released listing cannot be set up under a different wallet by a new claimant", async (t) => {
    const h = await harness(t);
    await claimWithWallet(h);
    await h.call("/claims/setup", { body: { slug: "alpha" } });
    await h.call("/claims/release", { body: { slug: "alpha" } });
    await h.linkTwitch(h.sessions[1], "2002", "alpha_live");
    assert.equal((await h.call("/claims", { session: h.sessions[1], body: { slug: "alpha" } })).status, 200);
    await h.linkWallet(h.sessions[1]);
    const refused = await h.call("/claims/setup", { session: h.sessions[1], body: { slug: "alpha" } });
    assert.deepEqual([refused.status, refused.json.error], [409, "listing_tied_to_released_arena"]);
  });
});

describe("mine reports the pinned wallet", () => {
  const claimWithWallet = async (h) => {
    await h.linkTwitch(h.sessions[0], "1001", "alpha_live");
    await h.call("/claims", { body: { slug: "alpha" } });
    return h.linkWallet(h.sessions[0]);
  };
  it("tells the streamer which wallet the page is tied to, and when the linked wallet no longer matches it", async (t) => {
    const h = await harness(t);
    const w1 = await claimWithWallet(h);
    await h.call("/claims/setup", { body: { slug: "alpha" } });
    let mine = (await h.call("/claims/mine", { method: "GET" })).json.claims[0];
    assert.deepEqual([mine.wallet, mine.pinned, mine.ready, mine.reason], [w1, { streamer: w1, mint: MINT }, true, null]);
    await h.call("/identity/wallet/unlink");
    const w2 = await h.linkWallet(h.sessions[0]);
    mine = (await h.call("/claims/mine", { method: "GET" })).json.claims[0];
    assert.deepEqual([mine.wallet, mine.pinned, mine.ready, mine.reason], [w2, { streamer: w1, mint: MINT }, true, "wallet_differs_from_pinned"]);
  });
});

describe("deriveClaimPair with a pinned pair", () => {
  it("returns the pinned pair without looking at the wallet at all", () => {
    const pinned = { accountId: "a".repeat(64), pair: { streamer: OTHER_STREAMER, mint: MINT } };
    assert.deepEqual(deriveClaimPair({ claim: pinned, identityOf: () => { throw new Error("must not be read"); }, defaultMint: null }), { streamer: OTHER_STREAMER, mint: MINT, pinned: true });
  });
  it("still refuses a banned or official key if one is ever pinned", () => {
    for (const streamer of [...BANNED_STREAMERS, OFFICIAL_STREAMER]) {
      assert.deepEqual(deriveClaimPair({ claim: { accountId: "a".repeat(64), pair: { streamer, mint: MINT } }, identityOf: () => ({ wallet: null }), defaultMint: MINT }), { error: "wallet_not_allowed" });
    }
  });
});
