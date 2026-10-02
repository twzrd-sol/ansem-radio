# Output sinks

Sinks consume finalized, versioned claims. Creator and collaborator attribution
uses the `evidence-ledger` program on Solana devnet:
`BzBAYJxUtJp6mUkJPjEYjd8vdb2FUGnAfB5X9LqrQ72W`.
Viewer activity is never submitted to this sink.

The record, RFC 9162 tree, signed heads and receipts live in `src/attribution/`.
The RPC client and CLI live here. Transaction submission is devnet-only.

See [the developer guide](../../DEVELOPMENT.md) for the source map, offline
receipt verification and the distinction between inclusion and on-chain anchoring.
