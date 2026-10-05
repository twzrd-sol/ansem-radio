// "Your page": shown to the streamer who joined this listing with Twitch. Two steps make it backable on its own:
// link a wallet (the existing identity flow, on the Profile page), then create the arena as that wallet. The station
// derives the listing's backing pair from the linked wallet; nothing here reads Twitch data or touches points.
import { useEffect, useState } from "react";

import { createHubApi, explainApiError, HubApiError } from "../data/api";
import type { MyClaim } from "../data/identity-api";
import type { Listing } from "../data/market";
import { Icon } from "./atoms";

const REASONS: Record<string, string> = {
  wallet_link_required: "Link a wallet first. The arena is created under it.",
  wallet_not_allowed: "This wallet can't be used for a listing. Link a different one.",
  no_default_mint: "This station has no token set for backing yet.",
  operator_set: "This listing's backing is set by the station operator.",
  wallet_differs_from_pinned: "This page is tied to an earlier wallet. Connect that wallet to create the arena.",
};

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

export function YourPageView({ claim, listing, onRelease, busy = false, notice = "" }: { claim: MyClaim; listing: Listing; onRelease?: () => void; busy?: boolean; notice?: string }) {
  const linked = Boolean(claim.wallet);
  const open = listing.backingOpen;
  const mismatch = Boolean(claim.pinned) && claim.wallet !== null && claim.wallet !== claim.pinned!.streamer;
  const canCreate = claim.ready && listing.claimDerived === true && !listing.arena;
  return (
    <section className="panel" aria-labelledby="h-yourpage">
      <div className="panel__head">
        <h2 className="h3" id="h-yourpage">Your page</h2>
        <span className="label">Streamer</span>
      </div>
      <p className="small">You joined this page with Twitch. Two steps open it for backing, and backing never changes anyone's points.</p>
      <ol className="yourpage__steps">
        <li className={linked ? "step step--done" : "step"}>
          <strong>1. Link your wallet</strong>
          <span className="small">{linked ? "Linked. The arena is created under this wallet." : "Use the wallet you will keep for this page."}</span>
          {!linked && <a className="btn" href="#/me">Link your wallet</a>}
        </li>
        <li className={open ? "step step--done" : "step"}>
          <strong>2. Create your arena</strong>
          <span className="small">{open ? "Your arena is open. Fans can back this page." : mismatch ? `This page is tied to wallet ${short(claim.pinned!.streamer)}, not the wallet you have linked now. Connect ${short(claim.pinned!.streamer)} to create the arena.` : canCreate ? `One signature from ${claim.pinned ? short(claim.pinned.streamer) : "the linked wallet"}. Nothing else is sent.` : claim.reason ? REASONS[claim.reason] ?? "Not ready yet." : "Not ready yet."}</span>
          {canCreate && <a className="btn btn--primary" href={`#/back/${listing.slug}`}><Icon name="heart" size="sm" />Create your arena</a>}
        </li>
      </ol>
      {claim.pinned && (
        <p className="small fine">
          This page is tied to wallet {short(claim.pinned.streamer)}. Releasing the page does not move it: the listing stays tied to this wallet's arena, so anyone who backed it can always withdraw.
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
