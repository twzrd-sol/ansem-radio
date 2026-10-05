# Radio LAN

Radio LAN is an MIT-licensed, open-source fan hub and attribution experiment for streamer culture. Points are free and are not paid out. Creators and collaborators can sign attribution credits, and that record is anchored to Solana devnet.

## What is here

- **Fan hub** ([`apps/hub`](apps/hub/README.md), `src/hub`): a LAN station guide, browser Follow, free points, optional verified identity and a backing screen. The hosted hub is at `radiolan.live/hub` and is not in a public launch. Backing is not open: no arena exists on Solana mainnet yet, so nobody can back a creator today. Season points run on devnet. The local account API and tests are included; season collecting is not implemented.
- **Attribution log** (`src/core`, `src/ledger`, `src/sinks`): a credit is co-signed by a creator and a collaborator, salted, and committed into an RFC 9162 Merkle log. Signed heads are anchored on the `evidence-ledger` program on Solana devnet (`BzBAYJxUtJp6mUkJPjEYjd8vdb2FUGnAfB5X9LqrQ72W`), and anyone can verify an entry's inclusion with `npm run attribution`.
- **Twitch timeline and macro view** (`src/timeline`, `src/providers`, `public/macro.html`): channel events, minute aggregates and a local, read-only view of streamer attention built from public numbers. The timeline and the chart serve loopback only and stay on the machine that collected them.
- **The room** (`src/live`, `src/agents`, `public/live.html`): a live board and a small chorus of clearly labeled AI agents. Every agent line starts with the persona name and "(AI agent)".
- **x402 sponsor API** (`src/x402`): an optional, default-off Solana USDC checkout for a reviewed, clearly disclosed 60-second sponsor read on `radiolan.live`. The operator must configure its dedicated wallet, terms, review token, CDP credentials and finalized-mainnet RPC before the seller can return a payment challenge. See the [pilot and route contract](docs/X402_SPONSORED_SEGMENT_PILOT.md).
- **Simulator** (`src/sim`): an offline model of an in-stream economy, kept separate from anything that runs live.

For the source map, verification walkthrough and release updates, see
[DEVELOPMENT.md](DEVELOPMENT.md) and [CHANGELOG.md](CHANGELOG.md).

## Run

```sh
npm ci --ignore-scripts # install pinned x402 server dependencies
npm test            # node --test
npm run live        # the room on 127.0.0.1:8787
npm run timeline -- summary --days 7
npm run sim -- --farm 5
npm run attribution -- --help
```

Node 22 or newer. x402 server dependencies are pinned in `package-lock.json`;
the handler remains unloaded unless its runtime flag is enabled and its
configuration is complete.

The station entrypoint always binds to `127.0.0.1`; `HOST` is ignored.
The public executable does not persist rotated Twitch credentials across restarts; embedding applications can supply a runtime persistence callback.

## Boundaries

Live product surfaces do not assign per-viewer status or points from watching or chatting. The timeline, the chart and their history stay on the collecting machine. The hub does show a few current public figures per channel (live, viewers, category, rank, change since the last read), taken from Twitch's public API and labelled "Data: Twitch"; they are for display, and no points, backing weight or on-chain value is computed from them. Twitch's own terms apply to that data. Radio LAN is not affiliated with or endorsed by Twitch. Credentials are supplied at runtime and never stored in this repository.

The x402 route does not sell Twitch metrics, chat access or activity outcomes.
Public community data stays free. During rollout, any optional x402 service
charge must be strictly below 0.01 USDC; the server enforces that limit.
RLAN's market value is independent and may be zero. x402 uses USDC and does
not determine rewards or promise RLAN value.
Sponsor copy must be reviewed before payment and the paid segment disclosed.
The seller is disabled until the operator supplies and configures all payment,
moderation, fulfillment and cancellation terms. Source availability does not
mean the station has deployed or enabled the seller. It is disabled on the hosted site.

## Status

Built in public during the AnsemHack, October 2026. The attribution log and the season points are on Solana devnet. The arena program is deployed on Solana mainnet, but no arena is open on it, so there is nothing to back yet; see the source and build record below.

Launched 1 October 2026, 23:58 EST (04:58 UTC on 2 October; launch transaction `48Xm6feb…FiG8J7`): `$RLAN`, mint `CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy` (pump.fun, Token-2022, mint and freeze authority revoked). Playing, following and points never require holding RLAN, and nothing here pays, rewards or promises anything for holding it. Points are free and are not tied to RLAN. When backing opens, it will only hold a fan's own RLAN in a support account that returns it to that fan; it will not change points or rankings. Nothing in this repository is investment advice.

## Arena program

The optional Radio LAN arena program is available for inspection and build reproduction.

- Mainnet program: `5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf`
- Deployed ELF: SHA-256 `7ad624b983a7dfae6e3fdd5d77283b480b69e990b5374ac1b0c48f465ef0e893` (45,696 bytes), upgraded 2026-10-05; the first deploy (2026-10-02) was `22a613fe…`
- Reproduce the build with Solana CLI 2.3.0: see [`programs/radiolan-arena/BUILD.md`](programs/radiolan-arena/BUILD.md).

No arena is open on this program yet, so it holds no fan tokens. The 2026-10-05 version adds one instruction (tag 5) that lets a single operator key open a market for the `$RLAN` mint only; no market has been opened, and nobody can close one once it is. A daily check compares the deployed bytes to the build record above and fails if they differ.

We state the current control plainly: one Radio LAN operator key can upgrade the program today. It is not controlled by a multisig. The deployed version returns tokens only to the fan who deposited them, but an upgrade could replace it with different behavior. Please account for that operator-managed status when deciding whether to use it.
