import { RLAN_MINT } from "../chain/config";
import "../styles/presentation.css";

const rlanDetails = `https://clawpump.tech/tokens/${RLAN_MINT}`;

/** Public status of the three money layers. This is context, not a transaction surface. */
export function RevenueStory() {
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
          <p className="revenue-card__figure revenue-card__figure--word">Future shows</p>
          <h3 className="h3">Programming token</h3>
          <p className="small">RLAN is a separate token for future programming. Holder controls are not live in this hub; it does not change this season's points.</p>
          <a className="revenue-card__link" href={rlanDetails} target="_blank" rel="noopener noreferrer">View RLAN token record <span aria-hidden="true">↗</span></a>
        </article>
        <article className="revenue-card revenue-card--closed">
          <p className="label">ICELAN rewards</p>
          <p className="revenue-card__figure revenue-card__figure--word">Closed</p>
          <h3 className="h3">Vault not created</h3>
          <p className="small">The rewards program exists, but its vault has not been created. Collect stays disabled.</p>
          <span className="revenue-card__state">No vault · no Collect</span>
        </article>
      </div>
    </section>
  );
}
