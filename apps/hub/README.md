# Radio LAN hub

MIT source for the Radio LAN fan interface: React, TypeScript, Vite, Solana Kit
and Wallet Standard. The arena program and its reference client live in this
repository. Bundled fonts keep their OFL notices in `src/assets/fonts`.

The hub connects a LAN station brief, browser Follow, free native points seasons,
optional account links, creator backing and season records. Twitch figures are
context only. Backing adds no points and changes nobody's share. Collection stays
unavailable: a native season-points payout program is not implemented.

## Build and inspect

Use Node.js 22 or newer, from the repository root:

```sh
npm ci --ignore-scripts --prefix apps/hub
npm test --prefix apps/hub
npm run build --prefix apps/hub
npm run check:public-contract --prefix apps/hub
npm run preview --prefix apps/hub
```

Open `http://localhost:4173/hub/?preview=sample`. Fixtures are marked SAMPLE and
make no station reads or transactions. Opening without preview expects the local
station API. The contract check compares normalized program/client code with the
current public main and fails when it changes. Tests separately check instruction
bytes, account order, PDAs, decoders, season boundaries and landed-chain fixtures.

## Run the fan flow locally

The Node station serves the account API, devnet relay and market reads. The Vite
server serves the frontend and proxies those routes, keeping passkeys and sessions
on one browser origin. Keep runtime stores and configuration outside Git.

In one terminal, from the repository root:

```sh
PORT=8789 RADIOLAN_HUB_ORIGIN=http://localhost:5173 \
RADIOLAN_HUB_INSECURE_COOKIE=1 npm run live
```

In another terminal:

```sh
VITE_HUB_STATION=http://localhost:8789 npm run dev --prefix apps/hub
```

Open `http://localhost:5173/hub/`, using `localhost` rather than an IP address:
passkeys require a domain RP id. Both entrypoints bind to loopback. The station
also refuses non-loopback Host headers on hub and macro routes. The insecure-cookie
setting is for this local HTTP origin; HTTPS deployments use Secure cookies.

The default account store is the user's local application-data directory. Set
`RADIOLAN_HUB_DIR` to an outside-repository directory to isolate a rehearsal.
Without a season configuration, accounts work and joining is unavailable. Set
`RADIOLAN_HUB_SEASON` to a JSON file matching a creator's real devnet arena schedule
to enable a local season. Its shape is documented in [source notes](../../docs/HUB_SOURCE.md).

Optional station settings:

| Setting | Purpose |
| --- | --- |
| `RADIOLAN_RPC_URL` | Devnet upstream for the relay and arena index. Without it, backing reads are unavailable. Provider keys stay in runtime configuration. |
| `RADIOLAN_HUB_TEST_MINT` | Devnet test mint for the official featured creator. No mainnet RLAN is used for this rehearsal. |
| `RADIOLAN_HUB_REGISTRY` | Outside-repository JSON listing registry; otherwise Radio LAN and the tracked creators are used. |
| `RADIO_LAN_BOARD=1`, `RADIO_LAN_TIMELINE=1` | Collect local Twitch context using runtime provider credentials. No rewards use that data. |
| `RADIOLAN_HUB_TWITCH_CLIENT_ID` | Registered public-client app ID for optional Twitch identity. No client secret is required. |
| `RADIOLAN_HUB_TWITCH_REDIRECT_URI` | Exact registered callback, such as `http://localhost:5173/hub/twitch`. |

No Twitch identity flow activates without both valid settings. It verifies an
OIDC ID token with a session-bound nonce and fixed Twitch signing keys, stores
only identity fields, and changes no points. Wallet linking reviews an exact
message and verifies an Ed25519 signature; connecting alone does not link an
account. The backend holds no fan key.

## What the interface reads

- LAN reuses `/macro/state?hours=6`, distinguishes current creator status from
  recorded history, shows source timestamps, and expires stale claims. Its macro
  link opens the same window; range changes survive reload.
- Play follows the published opening/closing instants, with local time, UTC,
  countdown and calendar download. Native questions and poll responses follow
  the published caps; accepted work stays pending. Poll publication, ranks,
  badges and final recaps remain future API work in this snapshot.
- Follow is saved in this browser, includes Twitch-only creators and puts live
  followed creators first. It makes no provider write and adds no points.
- Backing builds byte-identical arena instructions, checks devnet genesis,
  simulates, reviews, signs explicitly, sends once and confirms. Token mint and
  streamer identity are pinned independently of optional fan links.
- Collect preserves season records before funding. Its field checks establish
  format only; they do not verify inclusion, funding or claimant authority. The
  existing attribution-credit vault cannot accept native season payout plans.

The mainnet program can be inspected and reproduced from
[`programs/radiolan-arena/BUILD.md`](../../programs/radiolan-arena/BUILD.md).
This frontend signs on devnet only. Source availability is not a mainnet release
or evidence that a perks account is funded.
