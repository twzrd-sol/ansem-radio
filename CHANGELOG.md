# Public changelog

## 2026-10-02 — Developer documentation batch

- Added a public source map and local development instructions.
- Added a reproducible offline attribution-proof walkthrough using an existing
  synthetic fixture, with explicit limits on what verification establishes.
- Replaced stale documentation pointers and infrastructure-specific wording.
- Validation: all 253 tests passed, including the tracked-file secret scan;
  the documented offline verification returned `ok: true`.
- Runtime behavior is unchanged. This batch adds no hub, wallet flows, support
  vaults or payout functionality.

## 2026-10-02 — Initial public release and launch record

- Released the local room, Twitch adapters, timeline, attribution client and
  offline simulator under the MIT license.
- Recorded the RLAN mint and its transaction-derived launch date in the README.
