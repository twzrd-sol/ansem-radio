/**
 * The shareable recap: plain text an operator can paste under a stream or into a post.
 * Recipient address and full signature get their own lines: a truncated one cannot be looked up,
 * and a reader needs both to check that the declared recipient received the declared amount.
 */

const words = (value) => String(value).replaceAll("_", " ");

const STATUS_TEXT = Object.freeze({
  verified: "verified on Solana",
  mismatch: "DOES NOT MATCH Solana",
  not_found: "not found on Solana yet",
  unavailable: "check pending",
  unverified: "not checked",
  pending: "not checked",
});

export function formatRecap(view) {
  const { campaign, summary, receipts } = view;
  const lines = [
    `${campaign.title} — receipts`,
    `Funded ${summary.funded.usdc} USDC · Spent ${summary.spent.usdc} USDC · Remaining ${summary.remaining.usdc} USDC (books)`,
  ];
  const sources = Object.entries(summary.funded_by)
    .filter(([, total]) => total.amount !== "0")
    .map(([source, total]) => `${words(source)} ${total.usdc}`);
  if (sources.length) lines.push(`Funding: ${sources.join(" · ")}`);
  lines.push(`Checked against Solana: ${summary.verified} of ${summary.receipts} receipts${summary.mismatched ? `, ${summary.mismatched} do not match` : ""}`);
  for (const warning of summary.warnings) lines.push(`Warning: ${warning}`);
  lines.push("");
  for (const receipt of receipts) {
    const incoming = receipt.kind === "funding";
    const what = incoming ? `funding from ${words(receipt.funding_source)}` : receipt.kind;
    const to = incoming ? receipt.to_label : `${receipt.to_label} (${words(receipt.to_custody)})`;
    lines.push(
      `${incoming ? "+" : "-"}${receipt.amount_usdc} USDC  ${what} · ${receipt.from_label} -> ${to} · ${receipt.purpose} · ${receipt.occurred_at.slice(0, 10)} · ${STATUS_TEXT[receipt.verification.status]}`,
    );
    lines.push(`   to ${receipt.to_address}`);
    lines.push(`   tx ${receipt.tx}`);
  }
  lines.push("");
  lines.push("Amounts and recipients are checked against finalized Solana data. Labels and purposes are declared by the operator.");
  lines.push(`Fund: ${campaign.receive.label} (${words(campaign.receive.custody)}), ${campaign.receive.address}`);
  if (campaign.terms) lines.push(`Terms: ${campaign.terms}`);
  return lines.join("\n");
}
