// "Your page": the same signed-in listing page as before. The words are the fan's three actions.
// Who sees it is unchanged. Nothing here reads Twitch data into points.
import { useEffect, useState } from "react";

import { createHubApi, explainApiError, HubApiError } from "../data/api";
import type { MyClaim } from "../data/identity-api";
import type { Listing } from "../data/market";
import { Address } from "./atoms";

export function YourPageView({ claim, listing, onRelease, busy = false, notice = "" }: { claim: MyClaim; listing: Listing; onRelease?: () => void; busy?: boolean; notice?: string }) {
  return (
    <section className="panel" aria-labelledby="h-yourpage">
      <div className="panel__head">
        <h2 className="h3" id="h-yourpage">Your page</h2>
        <span className="label">Fan</span>
      </div>
      <p className="small">Backing does not add season points by itself.</p>
      <ol className="yourpage__steps">
        <li className="step">
          <strong>Link Twitch</strong>
          <span className="small">Sign in on this account, then link Twitch.</span>
          <a className="btn" href="#/me">Link Twitch</a>
        </li>
        <li className="step">
          <strong>Chat to earn credit</strong>
          <span className="small">Chat in the linked channel. Credit from that chat shows on this page.</span>
        </li>
        <li className="step">
          <strong>Back a channel with $RLAN</strong>
          <span className="small">Backing is optional and separate from season points.</span>
          <a className="btn btn--primary" href={`#/back/${listing.slug}`}>Back with $RLAN</a>
        </li>
      </ol>
      {claim.pinned && (
        <p className="small fine">
          This page is tied to wallet <Address id={claim.pinned.streamer} />. Releasing the page does not move it: the listing stays tied to this wallet's arena, so anyone who backed it can always withdraw.
        </p>
      )}
      {onRelease && (
        <div className="actions">
          <button className="btn btn--ghost" type="button" disabled={busy} onClick={onRelease}>Release this page</button>
        </div>
      )}
      {notice && <p className="small" role="status">{notice}</p>}
    </section>
  );
}

/** Fetches the signed-in streamer's own claims; renders nothing for a visitor who is not signed in or not this page's streamer. */
export function YourPage({ listing }: { listing: Listing }) {
  const [claim, setClaim] = useState<MyClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    if (!listing.claimed) return undefined;
    createHubApi().myClaims().then((r) => live && setClaim(r.claims.find((c) => c.slug === listing.slug) ?? null), () => live && setClaim(null));
    return () => { live = false; };
  }, [listing.slug, listing.claimed, listing.claimDerived, listing.arena?.address]);
  const release = async () => {
    if (!window.confirm("Release this page? It stops being yours until you join it again.")) return;
    setBusy(true);
    try {
      await createHubApi().releaseListing(listing.slug);
      setClaim(null);
    } catch (error) {
      setNotice(explainApiError(error));
    } finally {
      setBusy(false);
    }
  };
  return claim ? <YourPageView claim={claim} listing={listing} onRelease={() => void release()} busy={busy} notice={notice} /> : null;
}
