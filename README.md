# Radio LAN

Discover Twitch creators, participate in free Play activities, and record contributions with Radio LAN. Optional `$RLAN` backing and `$ICELAN` claims are separate features.

This repository is an MIT-licensed **source mirror** of the hub at [radiolan.live/hub](https://radiolan.live/hub/). The live site is built from a private tree. Public `main` at `2bdf1f5a` mirrors an earlier private commit, so **this checkout can lag the hosted hub**. Features already on the live site that are not in this tree yet include `$ICELAN` task accrual and mainnet arena reads.

## Status

Updated 9 October 2026. Dated amounts below are snapshots, not live balances. **Live** means it is on the hosted hub or on Solana mainnet today. **In progress** means planned or only partly shipped. **Not live** means it is not a current product.

| Item | Status | What is true |
| --- | --- | --- |
| Hosted hub | Live | [radiolan.live/hub](https://radiolan.live/hub/) |
| Passkey, Twitch, and wallet on one account | Live | See [Accounts](#accounts) |
| `$RLAN` mint | Live | Token-2022 on mainnet; mint and freeze authorities revoked; launched on ClawPump as part of AnsemHack with an external ClawPump token page |
| Arena program | Live | Mainnet program below |
| `radiolanlive` support arena | Live | Open market + arena; ~85,527.6 `$RLAN` deposited |
| Position boosts the next site credit | Live | A linked wallet with an active position doubles that user's next site credit, within caps |
| `$ICELAN` task records | Live | Eligible account-task credits are recorded off-chain; this mirror does not yet include the hosted accrual code |
| `$ICELAN` mint | Live | Classic SPL on mainnet; authorities revoked; separate from RLAN and season points |
| `$ICELAN` claims | Handler enabled | Mainnet rewards vault initially funded with 100,000 ICELAN on October 7. Claims require account eligibility, wallet approval, station co-signature and confirmation. Handler availability does not establish a completed payout |
| Season points | Live | Current season is on Solana **devnet**, free, unfunded, and separate from tokens |
| Source mirror | In progress | Public `main` can trail the private live tree |
| Program upgrade control | In progress | A **single key** still holds upgrade authority. A Squads multisig migration is planned |
| x402 payments | Not live | Optional seller source exists in this tree and stays off unless configured. It is not a live payment product |
| Holder yield / revenue share | Not live | Not offered |
| Signed creator credits / payouts | Not live | Not a live product. Local attribution tooling in this tree is not a payout |

## Accounts

One hub account can use all three:

- **Passkey** sign-in
- Optional **Twitch** identity link (OIDC) after passkey sign-in
- **Solana wallet** linking by **one signed message** (no transaction)

The wallet picker supports **Phantom**, **Solflare**, **Backpack**, and other [Wallet Standard](https://github.com/wallet-standard/wallet-standard) wallets.

## Terms, privacy and token disclosures

Radio LAN is a distinct product at radiolan.live, operated by TWZRD, Inc.
Shared company/repository ownership does not make it the TWZRD x402 product.
Read the [Privacy Policy](https://radiolan.live/privacy),
[Terms](https://radiolan.live/terms) and [disclosures](https://radiolan.live/legal).

Tokens can lose all value. A single operator key can upgrade the arena and
rewards programs and administer the rewards vault. Creator fees are collected
and forwarded by ClawPump to its custodial agent wallet; credit there is not
proof of a self-custody withdrawal. Holding RLAN does not entitle a holder to
company equity or creator-fee distributions.

The MIT license covers code distributed under it. It does not grant rights to
branding, domains, tokens, wallets, administrative keys or third-party content.

## $RLAN

| | |
| --- | --- |
| Mint | `CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy` |
| Program | Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) |
| Decimals | 6 |
| Mint authority | Revoked |
| Freeze authority | Revoked |
| External token page | [ClawPump](https://clawpump.tech/tokens/CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy) |

Season points and hub play do not require holding `$RLAN`. Points are not `$RLAN`.

## Support arena

Mainnet program: `5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf`.

The first support arena is **radiolanlive** (open-market PDA `["open", "radiolanlive"]`; the arena is `["arena", market, mint]`):

| | Address |
| --- | --- |
| Market | `2MhkAt7MBVAN4EnP9K6NB62GuqGfiecx5m2XVDjvkXGn` |
| Arena | `5PXzDwSwVu9xYMRT9QS6c5m6dapb4oGVGQc99azS2XVq` |

On 7 October 2026 the arena `total` field was **85,527.609857** `$RLAN` (85,527,609,857 base units ÷ 10^6). A linked wallet with an **active** position doubles that user's **next** site credit, within caps.

Each fan's tokens sit in that fan's own program-owned support account and return only to that fan. Nobody can close this opened market.

**Upgrade authority:** a single operator key can still replace the program. It is not a multisig today. A Squads migration is planned. An upgrade could change the program's behavior.

This checkout still derives an older unused official-streamer PDA (`pwSFGjmwEXBsP7WJfyhV2uYXSwTo2rr1aocqnuU9zGK`) and does **not** yet include the hosted mainnet arena reads. Reproduce the deployed ELF with [`programs/radiolan-arena/BUILD.md`](programs/radiolan-arena/BUILD.md).

## $ICELAN

Eligible `$ICELAN` account-task credits are **tracked off-chain** on the hosted hub until claimed. This mirror does not yet include that accrual path.

| | |
| --- | --- |
| Mint | `Dxpt78DTyBv3USxqsFKhQsthTF1JnjdiXQXTPLGBK9m` |
| Program | classic SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) |
| Decimals | 6 |
| Mint authority | Revoked |
| Freeze authority | Revoked |
| Supply | 6,665,498,680.204183 |
| Hub role | Eligible task credits and claims; separate from RLAN deposits and Play points |

| Action | Credit |
| --- | --- |
| Link Twitch | 100, once |
| Link wallet | 100, once |
| Chat in `#radiolanlive` (when enabled) | 10 each, max 10 per UTC day; chat credit is currently off |

The mainnet rewards program is `5wAVbHfZCBrYPymk1FNeV4D69iZioUmZaiE4ki4qrqWD`.
Vault `HYrsR1jrwJXxP91Dr8mxgyMAW1upp8JFXJVZScD5391U` was initially funded with
**100,000 ICELAN on October 7, 2026**. This is a historical funding amount.
The claim handler is enabled and session-gated. A usable claim also depends on
the hub's display gates, eligible recorded credit, the linked wallet, station
co-signing and available vault funds. No completed user payout was independently
verified for this update. Verify any payout using its confirmed transaction.

## Season points

The current season runs on **Solana devnet** with **no prize budget**. Points are free and are not tokens. They are separate from `$RLAN` and `$ICELAN`.

Twitch stream marks never go into settlement. Chat text is not stored.

Collecting a funded season is not implemented.

## Verify it yourself

| What | Explorer | Solscan |
| --- | --- | --- |
| `$RLAN` mint | [explorer.solana.com](https://explorer.solana.com/address/CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy) | [solscan.io](https://solscan.io/token/CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy) |
| `$ICELAN` mint | [explorer.solana.com](https://explorer.solana.com/address/Dxpt78DTyBv3USxqsFKhQsthTF1JnjdiXQXTPLGBK9m) | [solscan.io](https://solscan.io/token/Dxpt78DTyBv3USxqsFKhQsthTF1JnjdiXQXTPLGBK9m) |
| Arena program | [explorer.solana.com](https://explorer.solana.com/address/5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf) | [solscan.io](https://solscan.io/account/5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf) |
| `radiolanlive` arena | [explorer.solana.com](https://explorer.solana.com/address/5PXzDwSwVu9xYMRT9QS6c5m6dapb4oGVGQc99azS2XVq) | [solscan.io](https://solscan.io/account/5PXzDwSwVu9xYMRT9QS6c5m6dapb4oGVGQc99azS2XVq) |
| `radiolanlive` market | [explorer.solana.com](https://explorer.solana.com/address/2MhkAt7MBVAN4EnP9K6NB62GuqGfiecx5m2XVDjvkXGn) | [solscan.io](https://solscan.io/account/2MhkAt7MBVAN4EnP9K6NB62GuqGfiecx5m2XVDjvkXGn) |

On the mint, confirm Token-2022, 6 decimals, and empty mint/freeze authorities. On the `$ICELAN` mint, confirm classic SPL Token, 6 decimals, and empty authorities. On the program, confirm it is upgradeable and that upgrade authority is still a single key. On the arena, confirm owner `5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf`, mint `CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy`, streamer = the market address, and `total` ÷ 10^6 for deposited `$RLAN`. On the market, confirm owner is the same program and the slug is `radiolanlive`.

This checkout can derive those PDAs:

```sh
node --input-type=module <<'JS'
import { openMarketAddress, arenaAddress } from './src/sinks/arena.js';
import { encodeBase58 } from './src/core/base58.js';
const mint = 'CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy';
const market = openMarketAddress('radiolanlive');
console.log('market', encodeBase58(market.address));
console.log('arena', encodeBase58(arenaAddress(market.address, mint).address));
JS
```

## Run

Node 22 or newer. The root package pins optional x402 libraries in `package-lock.json`; they stay unloaded unless that path is enabled and fully configured.

```sh
npm ci --ignore-scripts   # install lockfile dependencies
npm test                  # node --test
npm run live              # the room on 127.0.0.1:8787
npm run timeline -- summary --days 7
npm run sim -- --farm 5
npm run attribution -- --help
npm run arena:season -- --help
```

The hub frontend is a separate package:

```sh
cd apps/hub
npm ci                    # .npmrc: no install scripts, exact versions
npm test                  # vitest
npm run typecheck
npm run build             # dist/
npm run preview           # 127.0.0.1 under /hub/
```

See [`apps/hub/README.md`](apps/hub/README.md) for hub build variables. The station entrypoint always binds to `127.0.0.1`; `HOST` is ignored. The public executable does not persist rotated Twitch credentials across restarts.

Source map and local checks: [DEVELOPMENT.md](DEVELOPMENT.md). Dated snapshots: [CHANGELOG.md](CHANGELOG.md). License: [MIT](LICENSE).
