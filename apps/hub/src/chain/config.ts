// What the hub talks to on chain, pinned by address (plan section 6), never by ticker or name.
// The network is a build input (VITE_HUB_NETWORK=devnet|mainnet, devnet by default), checked by genesis hash before
// anything is built. Mainnet backs the official arena with $RLAN; devnet rehearses with a test mint.

import { refuseMainnetHubOverrides } from "./mainnet-claim-lock";
export { MAINNET_CLAIM_OVERRIDE_REFUSED } from "./mainnet-claim-lock";

/** radiolan-arena (programs/radiolan-arena, #46). Live on devnet and mainnet since 2026-10-02 (#51). */
export const ARENA_PROGRAM = "5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

const env = import.meta.env;

const explicit = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed !== "0" ? trimmed : undefined;
};

/** Genesis hashes by cluster. The hub refuses to build a transaction for any cluster but the build's own. */
export const GENESIS = { devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" } as const;
export type Network = keyof typeof GENESIS;

/**
 * Collect rehearsal knobs. Unset / blank / "0" keep the recorded network pin.
 * `VITE_HUB_LOCAL_CLAIM=1` may skip the pin only on a non-mainnet build.
 * A `VITE_HUB_NETWORK=mainnet` build always uses the mainnet genesis; a
 * differing `VITE_HUB_CLAIM_GENESIS` is refused.
 */
export function claimBuildFromEnv(source: Record<string, string | undefined> = env as Record<string, string | undefined>) {
  refuseMainnetHubOverrides(source);
  const network: Network = source.VITE_HUB_NETWORK === "mainnet" ? "mainnet" : "devnet";
  const localClaim = source.VITE_HUB_LOCAL_CLAIM === "1";
  const claimGenesis = explicit(source.VITE_HUB_CLAIM_GENESIS);
  return {
    network,
    isMainnet: network === "mainnet",
    localClaim,
    claimGenesisHash: network === "mainnet" ? GENESIS.mainnet : claimGenesis ?? (localClaim ? null : GENESIS[network]),
  };
}

const claimBuild = claimBuildFromEnv();
export const NETWORK: Network = claimBuild.network;
export const IS_MAINNET = claimBuild.isMainnet;
/** Local Collect rehearsal against solana-test-validator. Never set on a public build. */
export const LOCAL_CLAIM = claimBuild.localClaim;
/** Wallet Standard chain id: "solana:mainnet" or "solana:devnet". */
export const CHAIN = `solana:${NETWORK}` as const;
export const GENESIS_HASH = GENESIS[NETWORK];
export const DEVNET_GENESIS_HASH = GENESIS.devnet;
export const NETWORK_LABEL = IS_MAINNET ? "Solana mainnet" : "Solana devnet";
/**
 * Genesis the Collect path accepts. Unset on a public build: the network's pin.
 * Local rehearsal sets VITE_HUB_CLAIM_GENESIS to the validator hash, or leaves
 * it unset with VITE_HUB_LOCAL_CLAIM=1 on a non-mainnet build to skip the pin.
 * A mainnet build always uses the mainnet pin.
 */
export const CLAIM_GENESIS_HASH: string | null = claimBuild.claimGenesisHash;

/** RLAN and its devnet stand-in are Token-2022 mints with 6 decimals. */
export const TOKEN_DECIMALS = 6;

/**
 * F-7 (plan section 6): the hub shows one arena, Radio LAN's, derived from the official streamer key and the pinned
 * mint. A look-alike arena under another key is a different account and is never shown. The official streamer is the
 * operator's Brave wallet; the program's upgrade-authority key is kept out of the streamer role on purpose (it can
 * replace the program, while the streamer key can only set the season at creation and close the arena).
 */
export const OFFICIAL_STREAMER = "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb";
/** $RLAN on mainnet: Token-2022, 6 decimals, mint and freeze authority revoked. */
export const RLAN_MINT = "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy";
/** Classic SPL ICELAN, 6 decimals. A mint is not proof of a funded rewards vault. */
export const ICELAN_MINT = "Dxpt78DTyBv3USxqsFKhQsthTF1JnjdiXQXTPLGBK9m";
/** ClawPump origin. Token page is marketing, not a locker or vault. */
export const CLAWPUMP_ORIGIN = "https://clawpump.tech";
export const CLAWPUMP_TOKEN_URL = `${CLAWPUMP_ORIGIN}/tokens/${RLAN_MINT}`;
/** The official mainnet arena, PDA ["arena", OFFICIAL_STREAMER, RLAN_MINT], bump 255. Not created yet (docs/examples/arena-mainnet/INIT.md). */
export const OFFICIAL_ARENA_MAINNET = "pwSFGjmwEXBsP7WJfyhV2uYXSwTo2rr1aocqnuU9zGK";
export const OFFICIAL_ARENA_BUMP = 255;

/**
 * On mainnet the featured arena is the official streamer's arena for $RLAN (pwSFGjmw…). On devnet, where there is no
 * RLAN, it is the official streamer's arena for a Token-2022 test mint set per build (VITE_DEVNET_TEST_MINT). The
 * streamer is not configurable.
 */
export const ARENA_STREAMER = OFFICIAL_STREAMER;
export const ARENA_MINT: string | null = IS_MAINNET ? RLAN_MINT : env.VITE_DEVNET_TEST_MINT || null;

/**
 * The RPC relay (plan section 5): reads plus sendTransaction, provider key server-side. Same origin by
 * default; a local dev run can point VITE_HUB_RPC_URL at the public devnet endpoint.
 */
export const RPC_URL: string = env.VITE_HUB_RPC_URL || "/hub/rpc";

export const EXPLORER = "https://explorer.solana.com";
export const explorerUrl = (kind: "address" | "tx", id: string) => `${EXPLORER}/${kind}/${id}${IS_MAINNET ? "" : `?cluster=${NETWORK}`}`;

export const TWITCH_CHANNEL = "radiolanlive";
export const TWITCH_URL = `https://www.twitch.tv/${TWITCH_CHANNEL}`;
