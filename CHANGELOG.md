# Public changelog

## 2026-10-07 — Presentation-ready hub

- Brought the hub frontend and account API up to date with private source
  `e4240292` (presentation pass): passkey-first identity, optional Twitch link,
  creator affinity, Superfans (`#/circle`), gated Discord/X communities, Play and
  Profile polish, and a closed RevenueStory panel. Collect stays disabled.
- Fan standings stay separate from Twitch marks. Room/play/collector badges and
  the bounded follows import (`src/hub/twitch-follows.js`) are included.
- Community cards show Needs credentials and award no points. Sample preview
  data stays tagged Sample. Points remain display-only.
- Intentionally omitted operator/finance/serving material, presenter notes,
  analytics collectors, and station credential configuration.

## 2026-10-05 — Hub refresh and documentation corrections

- Brought the hub, claims, season rollover, badges and tape up to date with the working tree; the hub now says Radio LAN
  with no host credit and lists tracked creators as the board.
- The station pulse reads `/hub/macro/state`. That route is not served by this repository's station or by the hosted edge
  yet, so the live/offline pill shows unknown until a route is added.
- Removed the unused slate route and the week-of-peaks chart; category lanes and follow badges remain (`data/lanes.ts`).
- Documentation now matches the hosted state: the hub is at `radiolan.live/hub` and not in a public launch, no arena is
  open on Solana mainnet, backing is unavailable, season points run on devnet, the x402 seller is disabled, and the hub
  shows a few public Twitch figures labelled "Data: Twitch". Removed the forward-looking line about the coin.
- The program source and its build record are unchanged.

## 2026-10-03 — MIT fan hub source

- Added the React hub, local passkey account API, optional identity proofs,
  devnet backing index/relay and unsigned native season plans with their tests.
- LAN connects a timestamped station brief, browser Follow, free Play, creator
  backing and season records. The macro view links back to the same fan routes.
- Included pinned frontend dependencies, MIT/font notices, public arena contract
  checks and a reproducible two-terminal local run. The station retains its
  loopback-only data boundary, including the new hub routes.
- Added one published poll per UTC day, a provisional points board, account
  ranks and credited-activity badges. Placeholder polls remain visible for
  preview and cannot earn points.
- Twitch context and account links add no points. Final recaps, live
  identity/device verification, native season collecting and mainnet
  activation remain outside this source snapshot.

## 2026-10-02 — Arena program source

- Published the arena source, JavaScript instruction builders and regression tests for optional support positions.
- Recorded the deployed mainnet ELF hash and the build command that reproduces it.
- The README records the program address, reproducible build and current operator control.

## 2026-10-02 — Developer documentation batch

- Added a public source map and local development instructions.
- Added a reproducible offline attribution-proof walkthrough using an existing
  synthetic fixture, with explicit limits on what verification establishes.
- Replaced stale documentation pointers and infrastructure-specific wording.
- Validation: all 253 tests passed, including the tracked-file secret scan;
  the documented offline verification returned `ok: true`.
- This batch documents functionality already present in this repository.

## 2026-10-02 — Initial public release and launch record

- Released the local room, Twitch adapters, timeline, attribution client and
  offline simulator under the MIT license.
- Recorded the RLAN mint and its transaction-derived launch date in the README.
