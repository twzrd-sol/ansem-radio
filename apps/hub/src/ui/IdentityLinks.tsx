import { useCallback, useEffect, useRef, useState } from "react";
import type { HubApi } from "../data/api";
import type { LinkedIdentities, WalletLinkReview } from "../data/identity-api";
import { explainIdentityError, startTwitchLink } from "../data/twitch-link";
import type { ConnectedWallet } from "../data/wallet-session";
import { Fact, Tag } from "./atoms";

export function IdentityFacts({ identity, onTwitch, onUnlinkTwitch, onWallet, onUnlinkWallet, busy = false }: { identity: LinkedIdentities; onTwitch?: () => void; onUnlinkTwitch?: () => void; onWallet?: () => void; onUnlinkWallet?: () => void; busy?: boolean }) {
  return <>
    <dl className="facts">
      <Fact label="Linked wallet">
        {identity.wallet ? <><code>{identity.wallet.address}</code> <span className="small">Signature verified</span>{onUnlinkWallet && <button className="btn btn--ghost" type="button" disabled={busy} onClick={onUnlinkWallet}>Unlink wallet</button>}</> : <>Not linked. {onWallet && <button className="btn btn--ghost" type="button" disabled={busy} onClick={onWallet}>Link connected wallet</button>}</>}
      </Fact>
      <Fact label="Twitch">
        {identity.twitch ? <>{identity.twitch.displayName} <span className="small">Identity verified</span>{onUnlinkTwitch && <button className="btn btn--ghost" type="button" disabled={busy} onClick={onUnlinkTwitch}>Unlink Twitch</button>}</> : <>Not linked. {identity.twitchEnabled ? onTwitch && <button className="btn btn--ghost" type="button" disabled={busy} onClick={onTwitch}>Link Twitch</button> : <Tag kind="soon">Not available yet</Tag>}</>}
      </Fact>
    </dl>
    <p className="small">Linking is optional and adds no points. Your activity history stays on your hub account.</p>
  </>;
}

interface Props { api: HubApi; accountId: string | null; wallet: ConnectedWallet | null }
export function IdentityLinks(props: Props) {
  if (!props.accountId) return <p className="small">Sign in with a passkey to optionally link Twitch or a wallet. Linking adds no points.</p>;
  return <SignedIdentityLinks key={props.accountId} {...props} accountId={props.accountId} />;
}

function SignedIdentityLinks({ api, accountId, wallet }: Props & { accountId: string }) {
  const [identity, setIdentity] = useState<LinkedIdentities | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<WalletLinkReview | null>(null);
  const running = useRef(false);
  const currentWallet = useRef(wallet);
  currentWallet.current = wallet;
  const refresh = useCallback(async () => {
    const me = await api.me();
    if (me?.accountId !== accountId) throw new Error("Your hub account changed. Reload Me before linking.");
    return api.identity();
  }, [api, accountId]);
  useEffect(() => {
    let active = true;
    refresh().then((next) => { if (active) { setIdentity(next); setError(""); } }).catch((err: unknown) => { if (active) setError(explainIdentityError(err)); });
    return () => { active = false; };
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (err) { setError(explainIdentityError(err)); }
    finally { running.current = false; setBusy(false); }
  };
  const beginWallet = async () => {
    if (!wallet?.signMessage) throw new Error("Connect a wallet that can sign messages from My positions first.");
    await refresh();
    const next = await api.beginWalletLink(wallet.address);
    if (currentWallet.current !== wallet || next.address !== wallet.address) throw new Error("Your wallet changed. Review the link again.");
    setReview(next);
  };
  const signWallet = async () => {
    if (!review || !wallet?.signMessage || review.address !== wallet.address || review.expiresAt <= Date.now() / 1000) throw new Error("This wallet link expired or changed. Review it again.");
    await refresh();
    const signature = await wallet.signMessage(new TextEncoder().encode(review.message));
    if (currentWallet.current !== wallet) throw new Error("Your wallet changed. Review the link again.");
    const next = await api.finishWalletLink(review.challenge, signature);
    setIdentity(next); setReview(null); setNotice("Wallet linked. Your points are unchanged.");
  };
  return <div className="identity-links">
    {identity ? <IdentityFacts identity={identity} busy={busy} onTwitch={() => void run(async () => { await refresh(); await startTwitchLink(api); })} onWallet={wallet?.signMessage ? () => void run(beginWallet) : undefined} onUnlinkTwitch={() => void run(async () => { await refresh(); setIdentity(await api.unlinkTwitch()); setNotice("Twitch unlinked. Your points are unchanged."); })} onUnlinkWallet={() => void run(async () => { await refresh(); setIdentity(await api.unlinkWallet()); setReview(null); setNotice("Wallet unlinked. Your points are unchanged."); })} /> : <p className="small">{error ? "Account links couldn't load." : "Loading account links"} {error && <button className="link-btn" type="button" disabled={busy} onClick={() => void run(async () => setIdentity(await refresh()))}>Try again</button>}</p>}
    {identity && !identity.wallet && !wallet?.signMessage && <p className="small"><a href="#/positions">My positions</a> lets you connect a wallet. Message signing is needed to link it.</p>}
    {review && review.address === wallet?.address && <section className="identity-review" aria-label="Review wallet link">
      <h3 className="h3">Review wallet link</h3>
      <p className="small">Sign this message to link your wallet. No transaction is sent. One signature, for this step only.</p>
      <pre>{review.message}</pre>
      <div className="actions"><button className="btn btn--primary" type="button" disabled={busy} onClick={() => void run(signWallet)}>Sign link</button><button className="btn btn--ghost" type="button" disabled={busy} onClick={() => setReview(null)}>Cancel</button></div>
    </section>}
    {error && <p className="small" role="alert">{error}</p>}
    {notice && <p className="small" role="status">{notice}</p>}
  </div>;
}
