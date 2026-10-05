# radiolan-arena

Optional support positions for one Token-2022 mint. A fan's tokens sit in that fan's own program-owned account and return only to that fan. Tag 5 (`init_open_market`) lets one operator opener key, `CrgnT4wE3KAemXyUvHgMbXiTamHxgx8LEiPzstEYX7gY`, open a market for the `$RLAN` mint only; nobody can close an opened market.

Mainnet program: `5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf`

Deployed ELF:

| | |
|---|---|
| sha256 | `7ad624b983a7dfae6e3fdd5d77283b480b69e990b5374ac1b0c48f465ef0e893` |
| length | 45696 bytes |

The on-chain program-data account is larger than the ELF because the deploy reserved spare space (61,440 bytes in all). Compare the hash to the first 45696 bytes after the 45-byte loader header; the rest is zero.

Reproduce with Solana CLI 2.3.0 (`cargo-build-sbf`, platform-tools v1.48, rustc 1.84.1):

```sh
cd programs/radiolan-arena
cargo build-sbf
sha256sum target/deploy/radiolan_arena.so
```

That command on the deployed source produced the hash above. `target/` is build output and is not part of the repository.

## History

- 2026-10-02 13:54 UTC: first deploy of the tags 0-4 build (39,728 bytes, sha256 `22a613fe…`), transaction `3rV16nE3rARxc1eBnpKe5dxJ1hfgE2CE8irrMPCF5vZC1nYHswJohtEwoJASMuYydjTpB3G5qA1AdrD4n4ZPT9Kc`.
- 2026-10-05 15:04 UTC: upgrade in slot 453614135 to the build above, which adds tag 5, transaction `M4uW8As3SYDGRA4VJHSCNGEYDDZCcxyvXRxtQpCHMGRubT1fNfFSCwfQ52yU6MMcCSJdPiBjt156vfu4Vqike1E`. The upgrade authority did not change.
