/** Recorded mainnet Collect targets. A mainnet hub build refuses any other nonempty override. */
const nonempty = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed !== "0" ? trimmed : undefined;
};

export const MAINNET_CLAIM_RECORDED = Object.freeze({
  genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  programId: "5wAVbHfZCBrYPymk1FNeV4D69iZioUmZaiE4ki4qrqWD",
  mint: "Dxpt78DTyBv3USxqsFKhQsthTF1JnjdiXQXTPLGBK9m",
  vault: "HYrsR1jrwJXxP91Dr8mxgyMAW1upp8JFXJVZScD5391U",
  vaultTokens: "2rWTNKcH9wjcjTgSaktZgpviP6C3XWTwJ9V1EBVRDUVt",
});

export const MAINNET_CLAIM_OVERRIDE_REFUSED = "A mainnet hub build refuses Collect target overrides";

const PAIRS = [
  ["VITE_HUB_CLAIM_GENESIS", MAINNET_CLAIM_RECORDED.genesis],
  ["VITE_HUB_REWARDS_PROGRAM", MAINNET_CLAIM_RECORDED.programId],
  ["VITE_HUB_ICELAN_MINT", MAINNET_CLAIM_RECORDED.mint],
  ["VITE_HUB_ICELAN_VAULT", MAINNET_CLAIM_RECORDED.vault],
  ["VITE_HUB_ICELAN_VAULT_TOKENS", MAINNET_CLAIM_RECORDED.vaultTokens],
] as const;

/** Called from vite.config so `vite build` fails, and from the hub modules so a leftover cannot retarget Collect. */
export function refuseMainnetHubOverrides(env: Record<string, string | undefined>) {
  if (env.VITE_HUB_NETWORK !== "mainnet") return;
  const conflicts = PAIRS.filter(([name, want]) => {
    const got = nonempty(env[name]);
    return got != null && got !== want;
  }).map(([name]) => name);
  if (conflicts.length) throw new Error(`${MAINNET_CLAIM_OVERRIDE_REFUSED}: ${conflicts.join(", ")}`);
}
