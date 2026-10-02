# radiolan-arena

Optional support positions for one Token-2022 mint. A fan's tokens sit in that fan's own program-owned account and return only to that fan.

Mainnet program: `5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf`

Deployed ELF:

| | |
|---|---|
| sha256 | `22a613fecb394d13a484bd982c9a0536c78f14f0db4ca00b27cf3fe96c6c69fb` |
| length | 39728 bytes |

The on-chain program account is larger than the ELF because the deploy reserved spare space. Compare the hash to the first 39728 bytes after the 45-byte loader header.

Reproduce with Solana CLI 2.3.0 (`cargo-build-sbf`, platform-tools v1.48, rustc 1.84.1):

```sh
cd programs/radiolan-arena
cargo build-sbf
sha256sum target/deploy/radiolan_arena.so
```

That command on this source produced the hash above. `target/` is build output and is not part of the repository.
