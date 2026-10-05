# Radio LAN hub (`apps/hub`)

The streamer hub from `docs/HUB_FRONTEND_PLAN.md`, P0: a mobile-first web app on Vite, TypeScript, React,
`@solana/kit`, Wallet Standard and Tailwind (F-1), built for the canonical public endpoint `radiolan.live/hub` (F-3, as updated 2026-10-03). `/stream` is the macro view and links back to the hub;
the local station room and OBS page are separate operator tools, not public product endpoints. It is a separate package so the
repo core stays zero-dependency. The design came from the `public/hub.html` prototype (#50).

The hub is served at `radiolan.live/hub`, with no edge password and not in a public launch. Feature work is built and
verified in a named worktree before an attended release. No test sends a live transaction.

The hub package is MIT licensed (`LICENSE`, matching the public repository).
Bundled fonts retain their OFL notices in `src/assets/fonts`.

The hub has dated Play openings, a browser Follow watchlist, a shared rules page, a persistent
LAN guide, shared wallet state, optional verified account links and automatic visible-page refresh. The public
program contract is pinned and checked with `npm run check:public-contract`.

## Run it

```bash
cd apps/hub
npm ci            # .npmrc: no install scripts, exact versions, no auto-installed peers
npm test          # vitest specs
npm run typecheck
npm run build     # dist/, with the strict CSP injected into index.html
npm run preview   # serves dist/ on 127.0.0.1 under /hub/
```

`?preview=sample` shows every screen with fixtures, each marked SAMPLE; `?preview=today` shows today's real state with
the review controls. Without `preview`, the hub shows the real state and the live backing flow.

| Build variable | Default | Meaning |
|---|---|---|
| `VITE_HUB_RPC_URL` | `/hub/rpc` | The RPC relay (plan section 5). An absolute URL is added to the CSP's `connect-src`. |
| `VITE_DEVNET_TEST_MINT` | unset | A dev fallback only: the featured listing's devnet test mint when the station's registry does not serve one. The registry (`RADIOLAN_HUB_REGISTRY` or `RADIOLAN_HUB_TEST_MINT` on the station) is the source of truth for every listing's pair. |
| `VITE_HUB_STATION` | unset | Dev and preview only: the station's loopback URL. `/hub/api` and `/hub/rpc` are proxied to it so the page stays same-origin, which the session cookie and the passkey origin need. Use `http://localhost:<port>` in the browser, never `127.0.0.1`: an IP literal cannot be a passkey RP id. |

The streamer is not a variable. See "Official arena" below.

## The Board (multi-streamer path, Stage 1)

The hub opens on **the Board**: every listed creator, with **backing** (RLAN fans committed to that creator's arena,
read from chain, the only number anyone owns) and the channel's **Twitch figures** (public data about Twitch, recorded
by the station, display only) side by side and never merged. Radio LAN is the featured
listing. The data comes from the station's `/hub/api/market` routes (`src/data/market.ts`): the registry of listings
joined to an index of every arena and position of the program, refreshed every few minutes. Every aggregate carries
the network, the mint, the observation time and slot, and a stale flag, and the screens render them.

| Screen | Route | What it shows |
|---|---|---|
| The Board | `#/` | The listings, sorted backable-first by backing then live channels by viewers; filters (backing open, live, Following), search, a watchlist kept in this browser |
| Listing | `#/s/<slug>` | Two panels: Backing (on chain: backed, backers, leaving, season, release rule, a sparkline of the last days) and Channel (Twitch, labelled with its provenance line). The featured listing also carries the stream and the free season card, labelled separate |
| My positions | `#/positions` | Every arena a pasted or connected wallet backs, with the arena's release rule and a total; a read, never a signature. The pasted public address is kept in this tab's sessionStorage for the tab's life, nothing else |
| Radio LAN | `#/lan` | The station, its founder, how a free season works |
| Back the creator | `#/back/<slug>` | The live backing flow for that listing's arena; "Create the devnet arena" appears only on the featured listing, for the official streamer key |

A listing is backable only after a creator creates their own arena with their own key: nothing is created on anyone's
behalf, and demo listings are fictional creators on devnet, marked DEMO wherever they show. Twitch figures are never a
points value, a backing weight or an on-chain parameter. Vocabulary (decision S-4): backing, position, season, points,
perks; never price, trade, sell or stock, checked by the specs over every rendered screen.

## What is in P0 so far

- **Screens** from plan section 2 and the Board above: the Board, listing, Radio LAN, activities, points board, back
  the creator, my positions, profile, collect. Each has loading, error and empty states. Reward states follow plan section 4: one state per season, and an
  amount appears only once a season's perks are funded and checked on chain.
- **Twitch:** the official player loads only after a tap and only at 400 px or wider, in a box at least 300 px tall,
  with `parent` set to the exact serving hostname. Narrower screens get "Watch on Twitch". The station's live or
  offline flag (`/macro/state`) is labelled Data: Twitch and is for display only.
- **Arena builders** (`src/chain/arena.ts`) produce byte-identical instructions to `src/sinks/arena.js`, including
  account order, signer and writable flags, PDAs and bumps, season bounds, and decoders. `arena.spec.ts` compares them.
- **The backing flow** (`src/chain/flow.ts`): connect, build, simulate, review, sign, send, confirm, one step per tap.
  - It refuses any cluster but devnet, checked by genesis hash.
  - A failed simulation shows the program's reason and the wallet never opens.
  - If the wallet does not sign, the flow goes back to review.
  - An expired blockhash asks for a fresh review.
  - The signature is stored before the single send. A reload, or a return from the wallet app, polls that signature
    and never resends.
  - Once the blockhash expires, the last check searches ledger history. If history is silent, the position read from
    chain decides whether the step landed.
- **Wallets** through Wallet Standard. Mobile Wallet Adapter registers itself on Android, from the backing screen's
  chunk only. iPhone users get links that open the page in Phantom's or Solflare's browser. The page builds the
  transaction, the wallet signs it, and the page sends it through the relay. Nothing holds a fan's key.
- **Copy** follows plan section 11 and the vocabulary rule recorded in #52: points and loyalty first, "season perks"
  and "collect", no money words. Exact on-chain amounts appear on the transaction review. Specs check every rendered
  screen, and TypeSafe's Jev reviewed the built app's copy (see below).

## Hub account, season and activities (the hub API)

Outside a preview, the hub reads `/hub/api/state` (`src/data/api.ts`, `src/data/live.ts`) and maps it to the screens
(`src/data/today.ts`): the season and its published policy, the fan's provisional points, and what they already sent.
Nothing is invented where the API has nothing: no poll or prompt until the streamer publishes one, no board until
the station publishes one, no past seasons.

- **Account (F-6):** a passkey. "Join free" creates the account with one passkey prompt, then joins the season; the
  profile offers "Create account with a passkey" and "Sign in with a passkey" too. The session is an HttpOnly cookie
  the page never reads; the CSRF token lives in memory and goes on every write.
- **Optional identity (F-2):** Me can link a verified Twitch identity and a wallet
  after an exact-message signature. Linking and unlinking preserve native points.
  Twitch is disabled until the server's public app ID and exact registered callback
  are configured. The callback captures its token in memory and clears the URL
  before rendering. No access token or provider activity is stored.
- **Activities:** a question and a poll answer are credited at once; prompt answers and clips wait for the streamer.
  Points follow the season policy exactly as settlement applies it: a value per activity, and caps per UTC day and
  per season across all activities. The Play screen shows today's and the season's points against those caps.
- **Dry run:** a station with the hub API on loopback, this app built with `VITE_HUB_STATION`, and Chromium's virtual
  authenticator walked join → question (+10) → clip (pending) → reload → sign out → sign in → stream card → board.

## Official arena (F-7) and test arenas

The hub shows one arena: the PDA `["arena", official streamer, mint]`.

| | Address |
|---|---|
| Official streamer (the operator's Brave wallet) | `A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb` |
| RLAN mint (mainnet) | `CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy` |
| Official mainnet arena (not created yet) | `pwSFGjmwEXBsP7WJfyhV2uYXSwTo2rr1aocqnuU9zGK`, bump 255 |

`config.spec.ts` derives that address and bump from the pinned streamer and mint. It also checks that the app source
never names any of these:

- the program's upgrade-authority key, kept out of the streamer role on purpose: it can replace the program, while the
  streamer key cannot move fan tokens;
- the live internal test arena (F-8, #56) or its streamer;
- the superseded #55 test arena;
- the ops test wallet.

P0 backs on devnet. No arena from the official streamer exists on devnet yet, so the backing screen shows "No devnet
arena yet" until one is created and `VITE_DEVNET_TEST_MINT` is set. **This is an operator decision:** create a devnet
arena from the official streamer with a test mint, or allow a test-only exception. The pin forbids an exception today.

The read path was checked once against public devnet, before the pin: the live screen read the founder's rehearsal
arena with one `getAccountInfo` call and showed its exact next release time.

## Security

- **CSP** (production build only, since the dev server injects inline scripts): `default-src 'none'`, scripts and
  styles from `self`, fonts from `self`, and `connect-src` limited to `self`, the relay and `ws://localhost:*` (Mobile
  Wallet Adapter's local socket). Frames are allowed only from `https://player.twitch.tv`.
- **Network:** devnet only, by genesis hash, and the cluster, program, mint and arena are pinned by address.
- **No keys:** no key, seed or `.env` is in the package. The pending-signature store holds a public signature only.
- **Not covered:** v0 transactions are signed by wallets that support `solana:signTransaction`. Wallets that only
  offer sign-and-send are filtered out.

## Dependencies

Exact versions, each published at least a week before install (2026-10-02). `.npmrc` runs no install scripts and does
not auto-install peers: `@solana-mobile/wallet-standard-mobile` depends on React Native's async-storage, whose
`react-native` peer would add about 300 packages that the browser entry never imports.

| Package | Version | Published | Why |
|---|---|---|---|
| `react`, `react-dom` | 19.3.0 | 2026-09-09 | Screens and the wallet flow |
| `@solana/kit` | 8.3.0 | 2026-09-09 | Addresses, PDAs, transactions, RPC |
| `@wallet-standard/app`, `base`, `features` | 1.1.1 | 2026-06-03 | Wallet discovery and connect |
| `@solana/wallet-standard-features` | 1.5.0 | 2026-09-10 | `solana:signTransaction` |
| `@solana-mobile/wallet-standard-mobile` | 0.6.0 | 2026-08-17 | Mobile Wallet Adapter on Android |
| `vite` | 8.3.1 | 2026-09-24 | Build (dev) |
| `@vitejs/plugin-react` | 6.1.1 | 2026-08-28 | Build (dev) |
| `typescript` | 7.0.2 | 2026-07-08 | Typecheck (dev) |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.3 | 2026-07-16 | Styles (dev) |
| `vitest` | 5.0.1 | 2026-09-15 | Specs (dev) |
| `@types/react`, `@types/react-dom` | 19.3.0 | 2026-09-09 | Types (dev) |
| `@types/node` | 24.13.6 | 2026-09-19 | Types for specs and config (dev) |

Bundle: the main chunk is 287 kB (88 kB gzip). The live backing flow (Kit, Wallet Standard, Mobile Wallet Adapter)
is a separate 210 kB chunk (67 kB gzip) that loads only on the backing screen.

## Copy check (Jev)

TypeSafe's Jev (`jev-1.13.0`) judged every rendered line of the built app, across live and preview states (207 units),
plus the live flow's strings. Each request carried the line's section heading and the text around it. Code chose
which lines each question applies to and owns the 0.5 review threshold. The questions:

- does it imply a return from holding or backing;
- does backing give points or a larger share;
- does Twitch activity count;
- does it suggest instant withdrawal;
- does it contradict a list of verified facts and spec rules.

Three passes used about 150k input tokens.

Fixes from the first pass:

- the home lede listed watching beside the point activities (0.83);
- the collect and profile screens did per-fan SOL arithmetic (0.71); they now show a share as a percentage set by points;
- withdrawal lines lacked "after release";
- the mainnet note said "no arena" after the internal test arena went live.

Two lines remain at 0.5 or above, both reviewed by hand: a percentage on the sample collect screen (it is about
collecting perks for points, which the design allows) and the wallet row, read as a Twitch line although it never
mentions Twitch.

## What P0 still lacks

- **The hub API served:** the station mounts it when `RADIOLAN_HUB_ORIGIN` is set (the page origin, so the edge
  hostname), and the season state needs `RADIOLAN_HUB_SEASON` (a published season config, once the devnet arena
  exists). Each is an operator setting, with the `/hub` route.
- **Backable listings:** the devnet test mint (`RADIOLAN_HUB_TEST_MINT` or a registry file), the official devnet
  arena from the Brave wallet, and demo arenas from the prepared runbook. Until then the Board lists creators with no
  backing open.
- **From the hub API, still:** streamer acceptance of work, prompts, final board records, past seasons,
  email recovery, and live-device verification of the optional Twitch and wallet links.
- **The RPC relay deployed:** `src/hub/relay.js` is merged (plan section 5, F-4; it passes `searchTransactionHistory`
  through and relays only transactions that call radiolan-arena). It still needs `RADIOLAN_RPC_URL` set and `/hub/rpc`
  routed, each an operator go.
- **A devnet arena from the official streamer** (the decision above).
- **The device-tested wallet matrix** (plan section 8). Nothing is listed as supported until tested on a real device.
- **Serving:** mount the built app at the canonical `/hub` edge route behind the existing password. Configure `/stream`
  as a redirect to `/hub`; do not maintain a second public chart application. This needs its own operator go.
- **The PWA install prompt** (F-5) and the nominations panel, which are not in P0.

## Published polls and provisional standings

Set `RADIOLAN_HUB_POLLS` to a runtime JSON file with the published daily polls, or
include `polls` in the season configuration. The tracked
[`polls.placeholder.json`](../../docs/examples/hub-devnet/polls.placeholder.json)
is for preview: placeholder answers cannot earn points. Only the current UTC
day’s published poll accepts a point-bearing answer, once per account and poll.

The API returns provisional ranks and pseudonymous board handles, and Profile
shows badges derived from credited activity. Optional wallet and Twitch links,
Follow and backing add no points. Provisional standings are not signed season
settlement records; Collect remains unavailable.
