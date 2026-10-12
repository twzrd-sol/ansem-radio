import { useState } from "react";

import { TOKEN_DECIMALS } from "../chain/config";
import { collectionSummary } from "../data/collection";
import { DAY_ZERO_ENABLED, ICELAN_CLAIM_ENABLED, claimsAreOpen, newlyCollectable, previewFromBooked, useAlreadyClaimed, useIcelanBook, type IcelanBookView, type VaultView } from "../data/day-zero";
import { VAULT_HOLDS, claimsHereCopy } from "../data/public-copy";
import { explainApiError, HubApiError } from "../data/api";
import { seasonPhase } from "../data/season";
import type { HubSnapshot } from "../data/types";
import { units } from "../lib/format";
import { EmptyBlock, ErrorBlock, Icon, PageHead, Skeleton } from "../ui/atoms";
import { HowLink, SUPPORT_BOOST_COPY } from "../ui/HowItWorks";
import { OpeningTime } from "../ui/SeasonOpening";
import { SeasonRecord } from "../ui/SeasonRecord";

function claimNotice(error: unknown): string {
  if (error instanceof HubApiError) return explainApiError(error);
  if (error instanceof Error && error.name === "NotAllowedError") return "Wallet approval was cancelled. Nothing was sent.";
  if (error instanceof Error && /failed to fetch|networkerror|load failed|econnrefused|err_connection/i.test(error.message)) {
    return "Couldn't reach the hub. Nothing changed.";
  }
  if (error instanceof Error && error.message) return error.message;
  return explainApiError(error);
}

export function IcelanCollect({ vault, book, refreshBook = async () => {}, showClaim, walletReady, wallet = null, alreadyClaimed, claimedRead, onClaim }: { vault: VaultView | null; book: IcelanBookView | null; refreshBook?: () => Promise<void>; showClaim: boolean; walletReady: boolean; wallet?: string | null; alreadyClaimed?: bigint; claimedRead?: "ready" | "error" | "loading"; onClaim?: () => Promise<{ signature: string }> }) {
  const claimWallet = book?.claimWallet ?? null;
  // `wallet` can be App's preview/fallback address after session.wallet disconnects.
  // Only a currently connected linked wallet is an identity for paid reads or claims.
  const walletMatchesClaim = walletReady && Boolean(wallet) && (claimWallet === null || wallet === claimWallet);
  const liveClaimed = useAlreadyClaimed(claimedRead == null && alreadyClaimed === undefined && claimWallet !== null && walletMatchesClaim, claimWallet);
  const status = claimedRead ?? (alreadyClaimed !== undefined ? "ready" : liveClaimed.status);
  const claimed = alreadyClaimed ?? liveClaimed.claimed;
  const booked = previewFromBooked(book?.earned ?? 0n);
  const unread = status === "error" || status === "loading";
  const remaining = unread || claimed == null || !book || !walletMatchesClaim || (!claimWallet && alreadyClaimed === undefined) ? null : newlyCollectable(book.earned, claimed);
  const open = claimsAreOpen(showClaim, vault);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const coSignedLine = !claimWallet
    ? " Station co-sign: none."
    : ` Station co-signed ${units(book?.issuedCumulative ?? 0n, TOKEN_DECIMALS)} ICELAN for the bound claim wallet.`;
  const paidLine = !claimWallet
    ? " Confirmed paid amount is unknown until the station co-signs and binds a claim wallet."
    : !walletReady
      ? " Confirmed paid amount: unknown until a linked wallet is connected."
      : !walletMatchesClaim
      ? " Confirmed paid amount: unknown for the connected wallet because it does not match the bound claim wallet."
      : status === "error"
        ? " Confirmed paid amount: unknown because the on-chain claim record could not be read."
        : status === "loading"
          ? " Reading the confirmed paid amount from the on-chain claim record."
          : ` Confirmed paid on chain: ${units(claimed ?? 0n, TOKEN_DECIMALS)} ICELAN.`;
  const leftover = !book
    ? " Recorded task total is unavailable."
    : `${coSignedLine}${paidLine}${remaining === 0n && booked > 0n && walletMatchesClaim && !unread ? " Nothing new to collect." : remaining != null && remaining > 0n ? ` Newly collectable: ${units(remaining, TOKEN_DECIMALS)} ICELAN.` : ""}`;
  const request = async () => {
    if (!onClaim || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await onClaim();
      await liveClaimed.refresh();
      await refreshBook();
      setNotice(`Claim confirmed on chain. Transaction ${result.signature}.`);
    } catch (error) {
      setNotice(claimNotice(error));
      try { await refreshBook(); } catch { /* Keep the claim result visible if the task-book refresh also fails. */ }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" style={{ marginTop: 18 }} aria-labelledby="h-icelan-collect">
      <div className="panel__head">
        <h2 className="h3" id="h-icelan-collect">ICELAN</h2>
        <span className="label">Task book</span>
      </div>
      {vault?.status === "funded" ? (
        <p className="small">Vault on chain holds {units(vault.fundedBaseUnits, TOKEN_DECIMALS)} ICELAN. Recorded from account tasks: {book ? `${units(booked, TOKEN_DECIMALS)} ICELAN` : "unknown"}.{leftover} Season points are not converted again.</p>
      ) : (
        <p className="small">{VAULT_HOLDS} Recorded from account tasks: {book ? `${units(booked, TOKEN_DECIMALS)} ICELAN` : "unknown"}.{leftover} Season points are not converted again.</p>
      )}
      {open ? (
        status === "error" ? (
          <p className="small">Unable to read what this wallet has already collected on chain. Newly collectable is unknown. Twitch figures do not count.</p>
        ) : remaining === 0n && booked > 0n ? (
          <p className="small">Nothing new to collect. Your booked total is already in this wallet. Twitch figures do not count.</p>
        ) : (
          <p className="small">Read the <a href="/terms#claims">claim terms and program risks</a>. Review the claim in your linked wallet. The wallet pays the Solana network fee and, if needed, ICELAN token-account rent. Twitch figures do not count.</p>
        )
      ) : (
        <p className="small">{claimsHereCopy({ stationClaim: book?.claim })} {VAULT_HOLDS} Twitch figures do not count.</p>
      )}
      {open && (
        <div className="actions" style={{ marginTop: 12 }}>
          {walletReady ? <button className="btn" type="button" disabled={busy || unread || !book || !walletMatchesClaim || remaining === 0n} onClick={() => { void request(); }}>
            {busy ? "Reviewing claim…" : status === "error" ? "Unable to read claimed amount" : status === "loading" ? "Reading claimed amount…" : remaining === 0n ? (booked === 0n ? "No task rewards booked" : "Nothing new to collect") : "Claim ICELAN"}
          </button> : <a className="btn" href="#/me">Connect linked wallet</a>}
        </div>
      )}
      {walletReady && claimWallet && walletMatchesClaim && <button className="link-btn" type="button" disabled={status === "loading"} onClick={() => { void liveClaimed.refresh(); }}>{status === "loading" ? "Reading paid status…" : "Refresh on-chain paid status"}</button>}
      {notice && <p className="small" style={{ marginTop: 8 }} role="status" aria-live="polite">{notice}</p>}
    </section>
  );
}

export function Claim({ snapshot, load, onRetry, now = Date.now(), vault = null, book = null, accountId = null, showIcelan = DAY_ZERO_ENABLED, showIcelanClaim = ICELAN_CLAIM_ENABLED, walletReady = false, wallet = null, alreadyClaimed, claimedRead, onClaim }: { snapshot: HubSnapshot | null; load: "loading" | "error" | "ready"; onRetry: () => void; now?: number; vault?: VaultView | null; book?: IcelanBookView | null; accountId?: string | null; showIcelan?: boolean; showIcelanClaim?: boolean; walletReady?: boolean; wallet?: string | null; alreadyClaimed?: bigint; claimedRead?: "ready" | "error" | "loading"; onClaim?: () => Promise<{ signature: string }> }) {
  const providedBook = book && (!accountId || book.accountId === accountId) ? book : null;
  const liveBook = useIcelanBook(showIcelan && providedBook === null, accountId);
  const shownBook = providedBook ?? liveBook.book;
  const head = <PageHead title="Collect" lede="Your season records, and whether a season's perks were funded." />;
  if (load === "loading") return <>{head}<Skeleton kinds={["block"]} /></>;
  if (load === "error" || !snapshot) return <>{head}<ErrorBlock text="Collect details didn't load. Nothing changed." onRetry={onRetry} /></>;
  // A closed season nobody joined has no record to collect; say so instead of "Results pending".
  const empty = snapshot.lastSeason && snapshot.lastSeason.players === 0 ? snapshot.lastSeason : null;
  const last = empty ? null : snapshot.lastSeason;
  const status = empty ? { label: `Season ${empty.number} closed with no players`, text: snapshot.season ? `There is nothing to collect from it. Season ${snapshot.season.number} is the one to play.` : "There is nothing to collect from it." } : collectionSummary(snapshot, now);
  return <div className="collect-page">
    {head}
    {last ? <SeasonRecord last={last} sample={snapshot.scenario === "sample"} onRetry={onRetry} /> : <EmptyBlock icon="receipt" title={status.label} text={status.text}>{snapshot.season && seasonPhase(snapshot.season, now) === "upcoming" && <OpeningTime at={snapshot.season.opensAt} />}</EmptyBlock>}
    {showIcelan ? <IcelanCollect vault={vault} book={shownBook} refreshBook={providedBook === null ? liveBook.refresh : async () => {}} showClaim={showIcelanClaim} walletReady={walletReady} wallet={wallet} alreadyClaimed={alreadyClaimed} claimedRead={claimedRead} onClaim={onClaim} /> : <p className="note collect-page__notice">{claimsHereCopy({ stationClaim: shownBook?.claim })} {VAULT_HOLDS}</p>}
    <div className="actions claim" style={{ marginTop: 16 }}><a className="btn" href="#/board"><Icon name="board" />Points board</a><a className="btn btn--ghost" href="#/play">Play activities</a></div>
    <p className="small claim" style={{ marginTop: 16 }}>{SUPPORT_BOOST_COPY} <HowLink /></p>
  </div>;
}
