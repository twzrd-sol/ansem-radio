# Radio LAN

Radio LAN builds attribution records for streamer culture. Creators and collaborators can sign each credit, and the record is anchored to Solana.

## What is here

- **Attribution log** (`src/core`, `src/ledger`, `src/sinks`): a credit is co-signed by a creator and a collaborator, salted, and committed into an RFC 9162 Merkle log. Signed heads are anchored on the `evidence-ledger` program on Solana devnet (`BzBAYJxUtJp6mUkJPjEYjd8vdb2FUGnAfB5X9LqrQ72W`), and anyone can verify an entry's inclusion with `npm run attribution`.
- **Twitch timeline and macro view** (`src/timeline`, `src/providers`, `public/macro.html`): channel events, minute aggregates and a local, read-only view of streamer attention built from public numbers. It serves loopback only; the data stays on the machine that collected it.
- **The room** (`src/live`, `src/agents`, `public/live.html`): a live board and a small chorus of clearly labeled AI agents. Every agent line starts with the persona name and "(AI agent)".
- **Simulator** (`src/sim`): an offline model of an in-stream economy, kept separate from anything that runs live.

## Run

```sh
npm test            # node --test
npm run live        # the room on 127.0.0.1:8787
npm run timeline -- summary --days 7
npm run sim -- --farm 5
npm run attribution -- --help
```

Node 22 or newer. No runtime dependencies.

## Boundaries

Nothing here pays, rewards or scores anyone for watching or chatting. Twitch data is read for the room and the local view and is never published or shared. Secrets are injected at runtime and never stored in this repository.

## Status

Built in public during the AnsemHack, October 2026. The programs and the attribution log are on Solana devnet; mainnet steps are separate decisions.

Launched  (; launch transaction `48Xm6feb…FiG8J7`): `$RLAN`, mint `CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy` (pump.fun, Token-2022, mint and freeze authority revoked). The coin coordinates future programming; it does not pay or get paid by anything in this repository.
