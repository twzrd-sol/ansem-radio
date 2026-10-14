import { useCallback, useEffect, useRef, useState } from "react";
import { HubApiError, type HubApi } from "../data/api";
import type { LinkedIdentities, WalletLinkReview } from "../data/identity-api";
import { explainIdentityError, startTwitchLink } from "../data/twitch-link";
import type { ConnectedWallet } from "../data/wallet-session";
import { POPULAR_WALLETS, orderWallets, useWallets, walletHelp } from "../chain/wallet";
import { Fact, Icon, Tag } from "./atoms";

/** Session-bound identity read. A 401 must not keep showing the previous account's links. */
export async function loadLinkedIdentities(api: HubApi, accountId: string) {
  const me = await api.me();
  if (!me) throw new HubApiError(401, "sign_in_required");
  if (me.accountId !== accountId) throw new Error("Your hub account changed. Reload Profile before linking.");
  return api.identity();
}

export function IdentityFacts({ identity, onTwitch, onUnlinkTwitch, onWallet, onUnlinkWallet, busy = false }: { identity: LinkedIdentities; onTwitch?: () => void; onUnlinkTwitch?: () => void; onWallet?: () => void; onUnlinkWallet?: () => void; busy?: boolean }) {
  return <>
    <dl className="facts">
      <Fact label="Linked wallet">
        {identity.wallet ? <><code>{identity.wallet.address}</code> <span className="small">Signature verified</span>{onUnlinkWallet && <button className="btn btn--ghost" type="button" disabled={busy} onClick={onUnlinkWallet}>Unlink wallet</button>}</> : <>Not linked. {onWallet && <button className="btn btn--ghost" type="button" disabled={busy} onClick={onWallet}>Link connected wallet</button>}</>}
      </Fact>
      {identity.claimWallet && <Fact label="Claim wallet"><code>{identity.claimWallet}</code> <span className="small">Claims stay with this wallet. A different wallet can't be linked for claims.</span></Fact>}
      <Fact label="Twitch">
        {identity.twitch ? <>{identity.twitch.displayName} <span className="small">Identity verified</span>{onUnlinkTwitch && <button className="btn btn--ghost" type="button" disabled={busy} onClick={onUnlinkTwitch}>Unlink Twitch</button>}</> : <>Not linked. {identity.twitchEnabled ? onTwitch && <button className="btn btn--ghost" type="button" disabled={busy} onClick={onTwitch}>Link Twitch</button> : <><Tag kind="soon">Not configured</Tag><span className="small block">Twitch linking is disabled on this release, so Twitch tasks can't be recorded yet.</span></>}</>}
      </Fact>
    </dl>
    <p className="small">Linking Twitch here is for your Radio LAN profile and task records only; it does not sign you into Twitch chat, which signs in on Twitch.</p>
    <p className="small">Linking connects these identities in your hub account. On-chain transactions are public; unlinking keeps anti-duplication and claim records. <a href="/privacy#identity">Privacy details</a>.</p>
    <p className="small">Season points come from Play. Task rewards are recorded as ICELAN; no tokens are sent. Recorded rewards stay if you remove a link.</p>
  </>;
}

interface Props { api: HubApi; accountId: string | null; wallet: ConnectedWallet | null; onConnectWallet?: (walletName: string) => Promise<string | null>; onChange?: () => void }
export function IdentityLinks(props: Props) {
  if (!props.accountId) return <p className="small">Sign in with a passkey to see which identity links are enabled on this release. Season points come from Play.</p>;
  return <SignedIdentityLinks key={props.accountId} {...props} accountId={props.accountId} />;
}

function SignedIdentityLinks({ api, accountId, wallet, onConnectWallet, onChange }: Props & { accountId: string }) {
  const [identity, setIdentity] = useState<LinkedIdentities | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<WalletLinkReview | null>(null);
  const running = useRef(false);
  const currentWallet = useRef(wallet);
  currentWallet.current = wallet;
  const refresh = useCallback(() => loadLinkedIdentities(api, accountId), [api, accountId]);
  const forgetSession = () => { setIdentity(null); setReview(null); };
  useEffect(() => {
    let active = true;
    refresh().then((next) => { if (active) { setIdentity(next); setError(""); } }).catch((err: unknown) => {
      if (active) {
        if (err instanceof HubApiError && err.status === 401) forgetSession();
        setError(explainIdentityError(err));
      }
    });
    return () => { active = false; };
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (err) {
      if (err instanceof HubApiError && err.status === 401) forgetSession();
      setError(explainIdentityError(err));
    }
    finally { running.current = false; setBusy(false); }
  };
  const beginWallet = async () => {
    if (!wallet?.signMessage) throw new Error("Connect a Solana wallet that can sign messages first.");
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
    setIdentity(next); setReview(null); onChange?.(); setNotice("Wallet linked by message signature. No transaction was sent; season points are unchanged.");
  };
  return <div className="identity-links">
    {identity ? <IdentityFacts identity={identity} busy={busy} onTwitch={() => void run(async () => { await refresh(); await startTwitchLink(api); })} onWallet={wallet?.signMessage ? () => void run(beginWallet) : undefined} onUnlinkTwitch={() => void run(async () => { await refresh(); setIdentity(await api.unlinkTwitch()); onChange?.(); setNotice("Twitch removed. Season points are unchanged. ICELAN already recorded stays."); })} onUnlinkWallet={() => void run(async () => { await refresh(); setIdentity(await api.unlinkWallet()); setReview(null); onChange?.(); setNotice("Wallet removed. Season points are unchanged. ICELAN already recorded stays."); })} /> : <p className="small">{error ? "Account links couldn't load." : "Loading account links"} {error && <button className="link-btn" type="button" disabled={busy} onClick={() => void run(async () => setIdentity(await refresh()))}>Try again</button>}</p>}
    {identity && !wallet && <WalletChoices busy={busy} alreadyLinked={Boolean(identity.wallet)} onConnect={onConnectWallet ? (name) => run(async () => {
      await refresh();
      const connected = await onConnectWallet(name);
      if (connected) setNotice(identity.wallet ? "Wallet connected. Return to Collect to claim." : "Wallet connected. Choose Link connected wallet to review the signature.");
    }) : undefined} />}
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

function WalletChoices({ busy, onConnect, alreadyLinked = false }: { busy: boolean; alreadyLinked?: boolean; onConnect?: (walletName: string) => Promise<void> }) {
  const detected = orderWallets(useWallets());
  const help = typeof navigator === "undefined" ? { kind: "desktop" as const, links: [] as Array<[string, string]> } : walletHelp(navigator.userAgent);
  const missing = POPULAR_WALLETS.filter((name) => !detected.some((wallet) => wallet.name.toLowerCase().includes(name.toLowerCase())));
  return <div>
    <p className="small">{alreadyLinked ? "Connect that wallet in this browser to sign Collect." : "Choose your wallet. Connecting reads the address; linking asks for a message signature."}</p>
    <div className="wallet-list">
      {detected.map((wallet) => (
        <button key={wallet.name} className="wallet-opt" type="button" disabled={busy || !onConnect} onClick={() => onConnect && void onConnect(wallet.name)}>
          {wallet.icon ? <img src={wallet.icon} alt="" width={24} height={24} /> : <Icon name="wallet" />}
          <span className="wallet-opt__text"><span className="wallet-opt__name">{wallet.name}</span><span className="small">Connect, then sign the link</span></span>
        </button>
      ))}
    </div>
    {missing.length > 0 && <p className="small">Not installed here: {missing.join(", ")}. {help.links.filter(([label]) => missing.some((name) => label.includes(name))).map(([label, href]) => <a key={href} className="ext" href={href} target="_blank" rel="noopener noreferrer">{label}</a>)}</p>}
  </div>;
}
