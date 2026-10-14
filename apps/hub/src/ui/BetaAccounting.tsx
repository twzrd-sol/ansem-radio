import type { CurrentSeason } from "../data/types";
import type { Market } from "../data/market";
import { BETA_LINE, TOKEN_RISK_LINE } from "../data/public-copy";
import { pointsSeasonNetworkLabel } from "../data/season";
import "../styles/beta-accounting.css";

/** Resource-specific accounting context; no acquisition or claim call to action. */
export function BetaAccounting({ season = null, market }: {
  season?: Pick<CurrentSeason, "network"> | null;
  market: Pick<Market, "network" | "stale" | "observedAt"> | null;
}) {
  const pointsNetwork = season ? pointsSeasonNetworkLabel(season) : null;
  const backingNetwork = market && !market.stale && market.observedAt
    && ["mainnet", "devnet"].includes(market.network) ? `Solana ${market.network}` : null;
  return (
    <section className="beta-accounts" aria-label="Points and token records">
      <p className="label beta-accounts__scope">Controlled beta · discovery, sign-in, free seasons and points</p>
      <div className="beta-accounts__grid">
        <article>
          <h2 className="h3">Season points</h2>
          <p className="small">Free site activities build your season standing. Points do not convert to tokens.</p>
          <p className="small">{pointsNetwork ? `Season record: ${pointsNetwork}.` : "Season network is not available yet."}</p>
          <a href="#/play">Play free</a>
        </article>
        <article>
          <h2 className="h3">RLAN backing</h2>
          <p className="small">Back a channel with $RLAN. Optional token backing is separate from your points and ICELAN task records. Backers' deposits do not fund the ICELAN vault.</p>
          <p className="small">{BETA_LINE}</p>
          <p className="small">{TOKEN_RISK_LINE}</p>
          <p className="small">{backingNetwork ? `Backing records: ${backingNetwork}.` : "Backing network awaits a fresh read."}</p>
          <details>
            <summary>Existing weighting rules</summary>
            <p className="small">A fresh read of an active position in an open listed RLAN arena on your linked wallet gives eligible Play credits 2× weight, within caps. Holding RLAN alone adds no points. This does not multiply ICELAN task amounts.</p>
          </details>
        </article>
        <article>
          <h2 className="h3">ICELAN task records</h2>
          <p className="small">Recorded ICELAN is an account-task ledger amount, not a token balance in your wallet. It is separate from season points and RLAN backing.</p>
          <a href="/legal#icelan">Read the ICELAN disclosure</a>
        </article>
      </div>
      <a className="small" href="#/how">Read the accounting rules</a>
    </section>
  );
}
