# Developing Radio LAN

This guide describes the code in this public repository. It is a curated release;
features not present here are not available through this checkout.

## Start locally

Use Node.js 22 or newer. There are no runtime dependencies to install.

```sh
npm test
npm run live
npm run sim -- --farm 5
npm run timeline -- summary --days 7
```

The room binds to loopback at `http://127.0.0.1:8787`. Live provider features
require credentials injected at runtime. The offline simulator and tests do not.
Keep credentials and captured data outside the repository.

## Source map

| Area | Where to read | What it does |
| --- | --- | --- |
| Event contract | `src/core/` | Normalized observations and cryptographic primitives |
| Provider adapters | `src/providers/` | Twitch payload normalization and connections |
| Local timeline | `src/timeline/` | Storage, minute aggregates and macro snapshots |
| Room and chorus | `src/live/`, `src/agents/`, `public/` | Local UI and disclosed agent messages |
| Attribution | `src/attribution/` | Canonical signed claims, commitments, Merkle trees and receipts |
| Evidence sink | `src/sinks/` | Devnet anchoring client and receipt verification CLI |
| Receipt panel | `src/ledger/` | Read-only transfer receipts |
| Simulator | `src/sim/` | Offline scenarios, separate from live activity |
| Arena program | `programs/radiolan-arena/`, `src/sinks/arena.js` | Program source and instruction builders for optional support positions. |

## Verify a receipt offline

The committed regression fixture contains synthetic signed claims and proofs.
This example checks its first entry without credentials, RPC calls or transactions:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { verifyReceipt } from './src/attribution/receipt.js';
import { decodeBase58 } from './src/core/base58.js';
const fixture = JSON.parse(readFileSync('test/fixtures/attribution-v1.json', 'utf8'));
const entry = fixture.entries[0];
const receipt = {
  v: 1, index: 0, text: entry.text, signatures: entry.signatures,
  appended_at: entry.appended_at, salt: entry.salt,
  commitment: entry.commitment, path: fixture.inclusion[0], head: fixture.head,
};
const result = verifyReceipt(receipt, decodeBase58(fixture.log_public_key), { network: 'devnet' });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
JS
```

An inclusion proof establishes that signed claim bytes belong to a signed head.
It does not establish that the claim is true, remains unrevoked, or has been
anchored on chain. This fixture includes a later revocation and is an offline
regression example, not an on-chain receipt.

For a real devnet receipt supplied by its issuer, the CLI additionally checks
the ledger and anchored root over RPC:

```sh
npm run attribution -- verify /path/to/receipt.json
```

Verification is read-only. Creating a ledger or anchoring a head is a separate,
credentialed devnet operation. This guide does not authorize transactions.

## Follow releases

[CHANGELOG.md](CHANGELOG.md) records public batches. Each batch describes what is
in this checkout, how it was checked and what remains unavailable. Open a GitHub
issue with the public commit, reproduction steps and expected behavior; remove
credentials and personal data from examples.
