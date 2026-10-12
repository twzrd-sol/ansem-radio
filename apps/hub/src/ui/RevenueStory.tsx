import { RLAN_MINT, TOKEN_DECIMALS } from "../chain/config";
import { type VaultView } from "../data/day-zero";
import { BACKING_BOOST, ICELAN_BOOK_CAP, RLAN_TOKEN_URL, VAULT_HOLDS, claimsStory, icelanClaimsOpen, icelanCollectCopy, type ClaimsInput } from "../data/public-copy";
import { units } from "../lib/format";
import "../styles/presentation.css";

function IcelanLane({ vault, claims }: { vault?: VaultView | null; claims?: ClaimsInput }) {
  const open = icelanClaimsOpen(claims);
  const amount = vault?.status === "funded" ? units(vault.fundedBaseUnits, TOKEN_DECIMALS) : "100,000";
  return (
    <article className="revenue-card">
      <p className="label">ICELAN rewards</p>
      <p className="revenue-card__figure">{amount}</p>
      <h3 className="h3">Credited from tasks</h3>
      <p className="small">ICELAN is recorded for real account tasks: link Twitch (+100 once), link a wallet (+100 once), and eligible #radiolanlive chat (+10 each, up to 10 per UTC day). The message text is not stored. {ICELAN_BOOK_CAP} {VAULT_HOLDS} Recorded rewards are not a wallet balance. {open ? icelanCollectCopy(claims) : claimsStory(claims)}</p>
      <span className="revenue-card__state">{open ? "Funded · collect available" : "Funded · collect not open"}</span>
    </article>
  );
}

/** Public status of the three money lanes. This is context, not a transaction surface. */
export function RevenueStory({ vault = null, claims }: { vault?: VaultView | null; claims?: ClaimsInput }) {
  return (
    <section className="revenue-story" aria-labelledby="h-revenue-story">
      <div className="revenue-story__heading">
        <p className="eyebrow">The creator economy</p>
        <h2 className="h2" id="h-revenue-story">Three lanes. Clear status.</h2>
        <p className="small">Creator fees, the Radio LAN token, and ICELAN have separate jobs. Season points stay free and separate.</p>
      </div>
      <div className="revenue-story__grid">
        <article className="revenue-card">
          <p className="label">Creator fee share</p>
          <p className="revenue-card__figure revenue-card__figure--word">ClawPump</p>
          <h3 className="h3">Provider terms</h3>
          <p className="small">Creator fee terms are managed by ClawPump. This hub shows context only; fee collection and release stay outside this interface.</p>
          <span className="revenue-card__state">Terms only · ClawPump</span>
        </article>
        <article className="revenue-card">
          <p className="label">Radio LAN · RLAN</p>
          <p className="revenue-card__figure revenue-card__figure--word">Live boost</p>
          <h3 className="h3">Backing boosts the next credit</h3>
          <p className="small">{BACKING_BOOST} Twitch rows are not doubled. RLAN can coordinate future shows; holder programming tools remain in development.</p>
          <a className="revenue-card__link" href={RLAN_TOKEN_URL} target="_blank" rel="noopener noreferrer">View RLAN token record <span aria-hidden="true">↗</span></a>
        </article>
        <IcelanLane vault={vault} claims={claims} />
      </div>
      <p className="small" style={{ marginTop: 12 }}>Mint <span className="mono">{RLAN_MINT}</span></p>
    </section>
  );
}
