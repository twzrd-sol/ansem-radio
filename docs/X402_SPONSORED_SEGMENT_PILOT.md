# x402 sponsored-segment pilot

Status: proposal only. The seller stays disabled until the operator supplies the
payment, fulfillment, and moderation terms below. This document does not enable
payments or change the running station.

## Offer

Offer one fixed-price, 60-second, clearly disclosed sponsored read to an agent
buyer. Watching the station remains free. The sponsor supplies its own short
copy; Radio LAN does not endorse it, promise reach, or sell Twitch audience
metrics. Do not sell chat access, points, token access, or an outcome tied to
viewers or chat activity.

The copy must be accepted before payment is requested. Reject links, unsafe or
disallowed categories, and content that fails the station's existing public
text rules. The read is fulfilled in a stated time window after settlement. A
missed window or operator cancellation follows a published refund rule. No
payment request should be created for copy that has not passed moderation.

Every sponsored line and its on-screen treatment must be disclosed as sponsored.
The operator must use Twitch's Branded Content disclosure tool for the live
read and follow Twitch's category restrictions. The stream operator controls
whether a booked segment is aired.

## Protocol and route

Use x402 protocol v2 with the `exact` scheme and USDC on Solana mainnet. The
network identifier is `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`; the USDC mint is
`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Before enabling the seller,
verify that the selected facilitator reports support for this exact network,
asset, and scheme. Do not silently substitute devnet or another chain.

Expose a separate agent API under the existing station API proxy on
`radiolan.live`:

- `POST /hub/api/x402/sponsor-quotes` validates the submitted sponsor copy and
  returns an immutable quote ID, fixed USDC amount, recipient, expiry,
  fulfillment window, and cancellation/refund terms.
- `GET /hub/api/x402/sponsor-quotes/{id}` returns the x402 payment challenge for
  that accepted quote. A valid settlement books the segment idempotently and
  returns a receipt/order ID and transaction signature.
- `GET /hub/api/x402/sponsor-orders/{id}` returns only the order status and public
  fulfillment state.

The current `radiolan.live` Caddy config already sends `/hub/api/*` to the
loopback station listener. Keep the x402 handler as an explicit route inside
that prefix, ahead of the general passkey API handler. The public source
currently rejects external `/hub/*` requests and must add a narrow exception
for this configured x402 route and the exact `radiolan.live` host; do not relax
the existing hub or RPC boundaries. `RADIOLAN_HUB_ORIGIN` remains `twzrd.xyz`,
and the agent payment API must not depend on passkeys or on changing that
origin. Preserve the existing RPC method allowlist and never forward the x402
payment headers to the RPC upstream.

The public source can define and document the handler, but the deployed station
is separately configured in a private runtime worktree. No Caddy edit is
currently required for the `/hub/api/*` route. Do not treat merging public
source as deploying or activating the seller.

## Settlement and records

Use the CDP-hosted facilitator directly so the Radio LAN payment is not routed
through TWZRD's facilitator revenue split. CDP documents the hosted facilitator
as a resource-server option authenticated with CDP API credentials. Its
credentials must be available through the station's secret manager; never put
them in source or client config. The live `intel.twzrd.xyz/supported` response
currently advertises Solana mainnet `exact`, but that endpoint charges a fixed
0.01 USDC TWZRD take per settlement, so it is not the default Radio LAN path.

Use a dedicated operator receive wallet supplied through runtime secret/config,
never a repository example address. Keep the private key out of the process if
the facilitator can settle to a public address. Store quote/order state outside
the repository with bounded retention and atomic writes or a durable database.
Quote IDs and settlement signatures must be idempotent so retries cannot book
or fulfill twice.

After settlement, verify the transaction on Solana mainnet before marking the
order paid. Check the finalized transaction's USDC mint, amount, destination,
and signature against the quote. Reuse the existing receipt whitelist only
where its `funding`/`sponsor` meaning and campaign accounting fit; otherwise add
a distinct order record and link its public receipt to the verified signature.
Never infer settlement from a client-supplied payment header or facilitator
response alone.

The seller starts disabled. Startup must fail closed or leave the routes
unavailable unless the network, supported facilitator, dedicated receive
address, fixed price, quote expiry, fulfillment window, moderation terms,
cancellation/refund policy, and durable order store are all configured.
Return no payment challenge while any prerequisite is absent.

## Discovery and operations

The `/hub` page can link to a short agent-facing offer document and advertise
the quote resource. Add x402 Bazaar discovery metadata only when the live offer
and request/response schema are stable. Browsers can discover the offer, but
the pilot is an agent API; it does not need browser wallet integration or CORS
to accept payment.

Before live activation, verify the facilitator's supported-pairs endpoint,
quote rejection/expiry, exact amount and recipient, duplicate settlement,
failed or delayed finality, refund workflow, and that `radiolan.live` forwards
the x402 v2 payment headers only to this handler. Confirm outside the repository
that the new loopback-only Caddy route reaches the station. Keep the seller off
until a low-value operator-controlled end-to-end payment and fulfillment
rehearsal succeeds.

## Operator decisions required before implementation can accept money

- Dedicated Solana receive wallet and custody label.
- Fixed USDC price per 60-second read.
- Quote lifetime and fulfillment window, including station-offline behavior.
- Cancellation and refund rule, including facilitator/network failure.
- Accepted sponsor categories and an explicit prohibited-category list.
- Whether one quote books the next available slot or a specific scheduled slot.

These are operational terms, not code defaults. The sample ledger wallet in
`docs/examples/ledger.example.json` is illustrative and must not be used as the
recipient.

## References

- [x402 Foundation TypeScript Express server example](https://github.com/x402-foundation/x402/blob/main/examples/typescript/servers/express/README.md)
- [CDP facilitator client for x402 resource servers](https://github.com/coinbase/cdp-sdk/blob/main/typescript/packages/cdp-sdk/README.md)
- [x402 Bazaar discovery extension](https://github.com/x402-foundation/x402/blob/main/docs/extensions/bazaar.mdx)
- [Twitch Branded Content Guidelines](https://help.twitch.tv/s/article/branded-content-policy)
