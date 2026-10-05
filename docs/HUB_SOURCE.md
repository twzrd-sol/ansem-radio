# Hub source and native season plans

The first hub batch extracted owned MIT hub code from source snapshot
`295692738cdfd2e167d04452241c50f40db3a648`, aligned with public arena source
`22bebf612e9f167cc9d56af0d93757b79ce67409`; later updates are listed in the
[changelog](../CHANGELOG.md). The hub code includes the frontend, account and
identity API, arena index/relay and native season math with their tests.
Generated bundles, runtime stores, credentials and serving configuration are
excluded. Public station integration preserves its loopback-only data boundary.

The [hub README](../apps/hub/README.md) gives reproducible install, build and local
run commands. The core Node service retains zero runtime dependencies; frontend
dependencies are pinned in the hub lockfile. MIT and bundled font OFL notices
are included. No cross-repository runtime import is required.

## Native points season configuration

The account API accepts the following JSON shape at `RADIOLAN_HUB_SEASON`:

```json
{
  "network": "devnet",
  "arena": "CREATOR_DEVNET_ARENA_PUBLIC_KEY",
  "creator": "CREATOR_PUBLIC_KEY",
  "season": "1",
  "arenaSeasonStart": 1790553600,
  "arenaSeasonSeconds": 604800,
  "startsAt": 1790553600,
  "endsAt": 1791158400,
  "claimDeadline": 1791763200,
  "asset": "SOL",
  "budgetBaseUnits": "0",
  "policy": {
    "dailyCap": 25,
    "weeklyCap": 100,
    "weights": { "question": 10, "poll_response": 5, "accepted_work": 20 }
  }
}
```

Replace the key placeholders with the creator's actual devnet keys and match the
arena's published schedule. The shown dates illustrate one weekly season; they
are not a schedule announcement. A declared budget is not funding. An optional
account link is not a unique-human proof, a scoring input or permission to claim.

Daily questions are supplied through the optional `RADIOLAN_HUB_POLLS` JSON file.
The tracked [poll example](examples/hub-devnet/polls.placeholder.json) is dated
for interface review; its questions are marked preview-only, and answers to them
cannot earn points. Replace them in a runtime copy with questions actually
published for the station. Only the current UTC day's poll accepts a point-bearing
answer.

`src/arena/season.js` accepts creator-signed native events, applies caps and
revocations, and produces a deterministic unsigned plan. It builds inclusion
proofs and conserves integer base units, dust and unpaid allocations. The CLI
never signs, calls RPC or transfers:

```sh
npm run arena:season -- --help
npm run arena:season -- settle input.json new-plan.json --now 1791590400
npm run arena:season -- verify new-plan.json ACCOUNT_ID_HEX
```

Plans use exclusive file creation. Inclusion proves membership in the supplied
manifest, not creator approval or on-chain funding. Native season plans are not
compatible with an attribution-credit vault. A funded native payout program,
authenticated manifest, wallet binding, claim markers, deadline/carry rules and
their verification remain necessary before real collecting can be enabled.

## Current scope

Local passkey accounts, native activity points, daily polls, a provisional board,
ranks and credited-activity badges, wallet/Twitch identity proofs, browser Follow
and the devnet backing frontend are inspectable here. Live provider and wallet-device
certification, final recaps, mainnet activation and native season collection are
not established by this source batch. No source test signs or sends a live chain
transaction.
