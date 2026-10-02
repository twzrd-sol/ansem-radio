# Output sinks

Sinks consume finalized, versioned session claims. Expected sinks include the
live-room API, recap publisher, analytics, and the attribution log.

The attribution log's on-chain sink is the `evidence-ledger` program
(`BzBAYJxUtJp6mUkJPjEYjd8vdb2FUGnAfB5X9LqrQ72W`), approved by the operator on
2026-10-01 (`docs/DECISION_20261001_EVIDENCE_LEDGER.md`). Format:
`docs/ATTRIBUTION_LOG_V1.md`. It is called over RPC; no attention-oracle-program
code is imported. It carries creator and collaborator attribution only, never
viewer events.

The other attention-oracle-program programs are not sinks. AO v2 is immutable,
its public source does not reproduce the deployed binary, and it has claim and
mint paths; `wzrd-rails` and `wzrd-markets` are payout and market programs this
repo does not revive. This repository will not patch or deploy any of them.

Built: the record, the RFC 9162 tree, signed heads and receipts (`src/attribution/`), and the
program client and CLI (`evidence-ledger.js`, `evidence-ledger-cli.js`, `npm run attribution`).
Sending is devnet only. Example and accounts: `docs/examples/attribution-devnet/`.
