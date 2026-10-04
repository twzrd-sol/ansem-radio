# x402 sponsored-segment pilot

Status: implementation is present in source but remains disabled until the
operator provides and configures the listed commercial and runtime terms. No
payment is accepted by default, and merging this change does not deploy or
activate the seller.

When deployed without complete x402 configuration, `GET /hub/api/x402/offer`
returns an explicit disabled status and planned protocol metadata. Quote and
purchase routes return 503 and never issue a payment challenge.

## Community rollout terms

Radio LAN is an MIT-licensed, open-source community dashboard and rewards
experiment. Public community metrics are free; no data access is sold. RLAN's
market value is independent of the dashboard and may be zero. This x402
integration uses USDC and makes no promise about RLAN's price or redemption.

Start with the free `GET /hub/api/x402/offer` endpoint and keep the seller
disabled. This introduces service discovery without taking a payment. If the
optional sponsor service is activated, its fixed charge must be strictly less
than 0.01 USDC. Configuration enforces 0.000001 through 0.009999 USDC; tests use
0.001 USDC. Zero-priced routes return ordinary HTTP 200 without x402.

The sponsor service is the only paid resource in this integration. It has no
hooks into reward eligibility, scores, allocation, or RLAN pricing. A payment
buys the disclosed sponsor service, never access to community or Twitch data.
MIT licenses the source code; external data retains its source and applicable
terms. Publishing the code does not grant a new license to provider data.

## Offer and moderation

Offer one fixed-price, clearly disclosed 60-second sponsored read. Watching the
station remains free. The sponsor supplies its own short copy; Radio LAN does
not endorse it, promise reach, or sell Twitch audience metrics. Do not sell chat
access, points, token access, or an outcome tied to viewers or chat activity.

The copy must be accepted before payment is requested. Reject links, unsafe or
disallowed categories, and content that fails the station's public text rules.
Every sponsored line and its on-screen treatment must be disclosed. Use
Twitch's Branded Content disclosure tool and follow Twitch's category rules.
The stream operator controls whether a booked segment is aired.

## Implemented routes

The seller uses x402 v2 `exact` on Solana mainnet, with USDC mint
`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and network identifier
`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`.

- `GET /hub/api/x402/offer` describes the configured service, price, accepted
  categories, fulfillment window, cancellation policy, and quote/purchase
  routes. With the seller disabled, it reports that state without a price.
- `POST /hub/api/x402/quotes` accepts only sponsor name, category, and copy.
  It creates a 24-hour quote in `pending_review`; it does not return a payment
  challenge.
- `GET /hub/api/x402/review-queue` lists pending copy only with the operator
  bearer token. `POST /hub/api/x402/quotes/{id}/review` requires that token to
  approve, reject, reconcile an uncertain settlement, or mark fulfillment.
- `GET /hub/api/x402/quotes/{id}/purchase` returns no challenge until the exact
  copy is approved. An accepted payment creates one durable order.
- `GET /hub/api/x402/orders/{id}` returns public order and fulfillment state.

The API is mounted before the passkey API, accepts only Host `radiolan.live`,
and does not depend on `RADIOLAN_HUB_ORIGIN`. The general hub API, RPC relay,
and other `/hub/*` routes retain their existing access restrictions. Caddy's
existing `/hub/api/*` proxy is sufficient; no Caddy edit is included.

## Settlement and recovery

The seller uses the CDP-hosted facilitator directly, avoiding the TWZRD
facilitator revenue split. It requires `CDP_API_KEY_ID` and
`CDP_API_KEY_SECRET`. The fixed amount and dedicated Solana recipient are
runtime settings. Price uses at most six decimal places and must be below
0.01 USDC. The state file path
must be absolute; the process creates its parent with mode 0700 and file with
mode 0600. The station process is the sole writer.

An order is written as `settling` before asking the facilitator to settle. A
facilitator success is followed by an independent finalized Solana RPC check of
the transaction signature, successful transaction status, USDC mint, receive
wallet balance increase, and exact atomic amount. Only then is the order marked
`paid_pending_fulfillment`. Duplicate payment headers replay the existing order
rather than charge twice. Unknown or unverifiable outcomes leave the quote
locked for operator reconciliation. The implementation does not issue refunds. A verified paid order stays pending
until the operator fulfills the read and marks it fulfilled. Refund execution
remains an external operator action under the configured cancellation terms.

Configuration uses `RADIOLAN_X402_ENABLED=1`, `RADIOLAN_X402_RECEIVE_ADDRESS`,
`RADIOLAN_X402_PRICE_USDC`, `RADIOLAN_X402_SOLANA_RPC_URL`,
`RADIOLAN_X402_STORE_PATH`, `RADIOLAN_X402_REVIEW_TOKEN`, `RADIOLAN_X402_ALLOWED_CATEGORIES`,
`RADIOLAN_X402_FULFILLMENT_WINDOW`, and
`RADIOLAN_X402_CANCELLATION_POLICY`, plus the CDP credentials. The seller
starts disabled. Missing or malformed configuration disables startup of the
x402 handler while keeping the station running; no challenge is returned.

## Before live activation

Supply a dedicated receive wallet and custody label, fixed price, permitted and
prohibited sponsor categories, fulfillment/offline policy, and cancellation
and refund terms. Provision a long random review token, a finalized Solana mainnet RPC URL, and
writable durable state path for the actual station service account. Validate facilitator support
for the exact mainnet scheme and asset, and test quote rejection/expiry,
settlement replay, uncertain outcome recovery, refund execution, and fulfillment
with an operator-controlled low-value rehearsal. Also verify from outside that
the loopback-only Caddy route reaches the current service version.

`RADIOLAN_HUB_ORIGIN` is still `twzrd.xyz`; changing it is unnecessary for this
agent payment API and is not part of this change. The live station is currently
served from a separate private runtime worktree, so merging the public source
alone will not install this handler in production.

## References

- [x402 Foundation TypeScript Express server example](https://github.com/x402-foundation/x402/blob/main/examples/typescript/servers/express/README.md)
- [CDP facilitator client for x402 resource servers](https://github.com/coinbase/cdp-sdk/blob/main/typescript/packages/cdp-sdk/README.md)
- [Twitch Branded Content Guidelines](https://help.twitch.tv/s/article/branded-content-policy)
