// The live backing flow on the build's network: real arena and position reads, a real wallet, the flow engine in src/chain/flow.ts.
import { address, type Address } from "@solana/kit";
import type { Wallet } from "@wallet-standard/base";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ARENA_PROGRAM, IS_MAINNET, NETWORK_LABEL, RPC_URL, TOKEN_DECIMALS } from "../chain/config";
import { prepare, prepareSetup, readChain, resume, sessionPendingStore, signAndSend, type ChainView, type FlowAction, type FlowFailure, type FlowState, type WalletPort } from "../chain/flow";
import { kitRpc } from "../chain/rpc";
import { nowSeconds, seasonIndex, withdrawAvailableAt, type ArenaSchedule } from "../chain/season";
import { connectWallet, NO_WALLET_APP_EVENT, registerMobileWallet, useWallets, walletHelp } from "../chain/wallet";
import { duration, feltCost, parseAmount, units, utc } from "../lib/format";
import { Address as AddressLink, EmptyBlock, ErrorBlock, Icon, Skeleton } from "../ui/atoms";
import type { Position } from "../app/preview";
import { useWalletSession } from "../data/wallet-session";
import { BackHeader, BackingFacts, ChainFacts, FailedStep, PositionCard, ReviewPanel, SeedNote, Stepper, type ReviewRow } from "./Back";


// Mobile Wallet Adapter registers itself only on Android; this module loads only on the backing screen.
if (typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)) registerMobileWallet();
const poll = { intervalMs: 1500 };
const rlan = (baseUnits: bigint) => `${units(baseUnits, TOKEN_DECIMALS)} RLAN`;
const sol = (lamports: bigint) => `${units(lamports, 9)} SOL`;

/** The position as the fan should read it, from chain: a request whose season has ended is releasable. */
function positionOf(view: ChainView | null, now: bigint): Position {
  const p = view?.position;
  if (!p || !view?.arena) return "none";
  if (view.arena.closed) return "releasable";
  if (p.state === "active") return "active";
  return now >= withdrawAvailableAt(view.arena.seasonStart, view.arena.seasonSeconds, p.requestedSeason) ? "releasable" : "requested";
}


export interface LiveBackProps {
  /** The listing's registry pair; null means no arena is configured for it. */
  target: { streamer: string; mint: string } | null;
  slug: string;
  name: string;
  /** Offer "Create the devnet arena" when none exists: the featured listing only (the official streamer key signs). */
  allowSetup: boolean;
  /** False while the board is still loading, so a missing target is not yet a verdict. */
  ready?: boolean;
  /** The board failed to load, so the listing's pair is unknown: an error with retry, not "no arena". */
  boardError?: boolean;
  onRetry?: () => void;
}

export function LiveBack({ target, slug, name, allowSetup, ready = true, boardError = false, onRetry }: LiveBackProps) {
  const pinnedTarget = useMemo(() => target ? { streamer: address(target.streamer), mint: address(target.mint) } : null, [target?.streamer, target?.mint]);
  if (!ready) return <><BackHeader schedule={undefined} slug={slug} name={name} /><Skeleton kinds={["block", "block"]} /></>;
  if (boardError) return <><BackHeader schedule={undefined} slug={slug} name={name} /><ErrorBlock text="The board didn't load, so this listing's arena is unknown. Nothing was sent." onRetry={onRetry} /></>;
  if (!target) {
    return (
      <>
        <BackHeader schedule={null} slug={slug} name={name} />
        <EmptyBlock icon="lock" title="Backing is not open" text={`Backing is not open for ${name}.`} />
      </>
    );
  }
  return <LiveFlow key={`${target.streamer}:${target.mint}`} target={pinnedTarget!} slug={slug} name={name} allowSetup={allowSetup} />;
}

function LiveFlow({ target, slug, name, allowSetup }: { target: { streamer: Address; mint: Address }; slug: string; name: string; allowSetup: boolean }) {
  const rpc = useMemo(() => kitRpc(RPC_URL), []);
  const store = useMemo(() => sessionPendingStore(), []);
  const wallets = useWallets();
  const { wallet, setWallet } = useWalletSession();
  const [view, setView] = useState<ChainView | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [state, setState] = useState<FlowState>({ step: "idle" });
  const [picking, setPicking] = useState(false);
  const [action, setAction] = useState<FlowAction>("deposit");
  const [amountText, setAmountText] = useState("");
  const [noWalletApp, setNoWalletApp] = useState(false);
  const [now, setNow] = useState(nowSeconds());

  const refresh = useCallback(
    async (fan: Address | null) => {
      try {
        setView(await readChain(rpc, target, fan));
        // target is fixed per build
        setNow(nowSeconds());
        setLoad("ready");
      } catch {
        setLoad("error");
      }
    },
    [rpc, target],
  );

  useEffect(() => {
    setView(null);
    setLoad("loading");
    setState({ step: "idle" });
    void refresh(wallet?.address ?? null);
    void resume(rpc, store, target, poll).then((s) => s && setState(s));
    const onNoApp = () => setNoWalletApp(true);
    window.addEventListener(NO_WALLET_APP_EVENT, onNoApp);
    const tick = setInterval(() => setNow(nowSeconds()), 15_000);
    return () => {
      window.removeEventListener(NO_WALLET_APP_EVENT, onNoApp);
      clearInterval(tick);
    };
  }, [refresh, rpc, store, target, wallet?.address]);

  const schedule: ArenaSchedule | null | undefined = load !== "ready" ? undefined : view?.arena ? { seasonStart: view.arena.seasonStart, seasonSeconds: view.arena.seasonSeconds } : null;
  const position = positionOf(view, now);
  // No arena yet: the only on-chain step is the official streamer creating it (FOUNDER_HUB_CHECK.md Part B).
  const setup = load === "ready" && !view?.arena && allowSetup;
  const flowAction: FlowAction = setup ? "init" : position === "releasable" ? "withdraw" : position === "active" && action === "request" ? "request" : "deposit";
  const amount = parseAmount(amountText, TOKEN_DECIMALS);
  const balance = view?.token?.amount ?? null;
  const amountError = flowAction !== "deposit" ? "" : amount === null ? "Enter an amount like 250 or 12.5, up to 6 decimals." : amount <= 0n ? "Enter more than 0." : balance !== null && amount > balance ? `More than your balance (${rlan(balance)}).` : "";

  const build = async (port: WalletPort) => {
    setState({ step: "working", label: `Building and simulating on ${NETWORK_LABEL}` });
    if (flowAction === "init") setState(await prepareSetup(rpc, { signer: port.address, ...target, now: nowSeconds() }));
    else setState(await prepare(rpc, { action: flowAction, fan: port.address, ...target, amount: flowAction === "deposit" ? (amount ?? 0n) : 0n, now: nowSeconds() }));
  };
  const onReview = async () => {
    if (!wallet) {
      setPicking(true);
      return;
    }
    await build(wallet);
  };
  // After connecting, show the fan's own position first: the right action (add, request, withdraw) depends on it,
  // so the fan taps Review or Continue once more instead of the page guessing from the pre-connect state.
  const onPick = async (w: Wallet) => {
    setState({ step: "working", label: `Connecting ${w.name}` });
    try {
      const port = await connectWallet(w);
      setWallet(port);
      setPicking(false);
      await refresh(port.address);
    } catch {
      /* the fan closed the wallet or it refused; nothing changed */
    }
    setState({ step: "idle" });
  };
  const onSign = async () => {
    if (state.step !== "review" || !wallet) return;
    setState({ step: "signing", plan: state.plan });
    const next = await signAndSend(rpc, wallet, store, state.plan, poll);
    setState(next);
    if (next.step === "done") void refresh(wallet.address);
  };
  const reset = () => {
    setState({ step: "idle" });
    if (wallet) void refresh(wallet.address);
  };

  const labels = flowAction === "deposit" ? ["Amount", "Wallet", "Review", "Sign"] : ["Wallet", "Review", "Sign"];
  const at = (() => {
    const offset = flowAction === "deposit" ? 0 : -1;
    switch (state.step) {
      case "idle":
        return picking ? 1 + offset : 0;
      case "working":
        return 1 + offset;
      case "review":
        return 2 + offset;
      case "signing":
      case "confirming":
        return 3 + offset;
      case "done":
        return labels.length;
      default:
        return labels.length - 1;
    }
  })();

  let body: ReactNode;
  if (state.step === "working") {
    body = (
      <div className="signing" role="status">
        <div className="signing__bars" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <p className="small">{state.label}…</p>
      </div>
    );
  } else if (state.step === "review") {
    const p = state.plan;
    const rows: ReviewRow[] = [];
    if (p.action === "deposit") {
      rows.push({ label: "You send", value: <span className="num sim__big">{rlan(p.amount)}</span> });
      rows.push({ label: "From", value: <>Your token account <AddressLink id={p.source ?? ""} /></> });
      rows.push({ label: "To", value: <>Your support account <AddressLink id={p.support} /><span className="small block">Only you can withdraw from it, once it's released. Nobody else can move it, including the streamer.</span></> });
      rows.push({ label: "Unlock", value: `Request withdrawal anytime. A request made during on-chain season ${p.onchainSeason} is available after ${utc(Number(p.releaseAt) * 1000)}.` });
    } else if (p.action === "request") {
      rows.push({ label: "Action", value: <>Request withdrawal of <span className="num">{rlan(p.amount)}</span></> });
      rows.push({ label: "Available after", value: utc(Number(p.releaseAt) * 1000) });
    } else if (p.action === "init") {
      rows.push({ label: "You create", value: <>Arena <AddressLink id={p.arena} /><span className="small block">This listing's arena on {NETWORK_LABEL}. You sign as its streamer wallet; you can close it later, and nothing else.</span></> });
      rows.push({ label: "Seasons", value: `${duration(Number(p.schedule?.seasonSeconds ?? 0n))} each, from ${utc(Number(p.schedule?.seasonStart ?? 0n) * 1000)}; on-chain season ${p.onchainSeason} now. Fixed at creation.` });
      rows.push({ label: "Account deposit (returned when you withdraw)", value: `${sol(p.rentLamports)} for the arena account. You get this back if the arena closes.` });
    } else {
      rows.push({ label: "You receive", value: <span className="num sim__big">{rlan(p.amount)}</span> });
      rows.push({ label: "To", value: <>Your token account <AddressLink id={p.destination ?? ""} /></> });
      rows.push({ label: "You get this back when you withdraw", value: sol(p.rentLamports) });
    }
    rows.push({ label: "Program", value: <>radiolan-arena <AddressLink id={ARENA_PROGRAM} /></> });
    if (p.action !== "request") rows.push({ label: "Token address", value: <AddressLink id={target.mint} /> });
    rows.push({ label: "Network", value: NETWORK_LABEL });
    if (p.action === "deposit" && p.rentLamports > 0n) rows.push({ label: "Account deposit (returned when you withdraw)", value: `${sol(p.rentLamports)}. You get this back when you withdraw everything after release.` });
    rows.push({ label: "Network fee", value: <>{feltCost(p.feeLamports)}<span className="small block">{sol(p.feeLamports)}</span></> });
    body = (
      <div>
        {p.action === "deposit" && (
          <p className="lede" style={{ marginBottom: 10 }}>
            {`You're setting aside ${rlan(p.amount)} for ${name}. You can ask for it back.`}
          </p>
        )}
        {state.notice === "not-signed" && (
          <p className="note note--warn" style={{ marginBottom: 12 }}>
            <Icon name="info" />
            Your wallet didn't sign. Nothing was sent.
          </p>
        )}
        {p.action === "deposit" ? (
          <details className="details">
            <summary className="small">Chain details</summary>
            <ReviewPanel rows={rows} preview={false} note={p.cancelsRequest ? "This deposit cancels your withdrawal request." : undefined} />
          </details>
        ) : (
          <ReviewPanel rows={rows} preview={false} note={p.cancelsRequest ? "This deposit cancels your withdrawal request." : undefined} />
        )}
        <p className="small" style={{ marginTop: 12 }}>Nothing is sent until you approve. One signature, for this step only.</p>
        <div className="actions">
          <button className="btn btn--primary" type="button" onClick={onSign}>
            <Icon name="wallet" />
            Open wallet to sign
          </button>
          <button className="btn btn--ghost" type="button" onClick={reset}>
            {p.action === "deposit" ? "Edit amount" : "Cancel"}
          </button>
        </div>
      </div>
    );
  } else if (state.step === "signing") {
    body = (
      <div className="signing" role="status">
        <div className="signing__bars" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <p className="h3">Approve in your wallet</p>
        <p className="small">Nothing is sent until you approve. One signature, for this step only.</p>
      </div>
    );
  } else if (state.step === "confirming") {
    body = (
      <div className="signing" role="status">
        <div className="signing__bars" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <p className="h3">Confirming on {NETWORK_LABEL}</p>
        <p className="small">
          Transaction <AddressLink id={state.signature} kind="tx" />
        </p>
      </div>
    );
  } else if (state.step === "done") {
    const read = state.action === "deposit" ? (state.position ? `Read back from chain: your position is ${rlan(state.position.amount)}.` : "Confirmed; the position read-back is pending.") : state.action === "request" ? "Read back from chain: your request is recorded." : state.action === "init" ? "Read back from chain: the arena exists. Fans can back it from this screen now." : "Read back from chain: your position and support account are closed.";
    body = (
      <div className="result result--ok" role="status">
        <Icon name="check" size="lg" />
        <p className="h3">{state.action === "deposit" ? `You're backing ${name}` : state.action === "request" ? "Withdrawal requested" : state.action === "init" ? `Arena created on ${NETWORK_LABEL}` : "Withdrawn"}</p>
        <p className="small">Confirmed on {NETWORK_LABEL}. {read}</p>
        <p className="small">
          Transaction <AddressLink id={state.signature} kind="tx" />
        </p>
        <div className="actions">
          <button className="btn btn--primary" type="button" onClick={reset}>
            Done
          </button>
          <a className="btn" href={`#/s/${slug}`}>
            Back to the listing
          </a>
        </div>
      </div>
    );
  } else if (state.step === "failed") {
    body = <FailedStep kind={state.kind satisfies FlowFailure} detail={state.detail} onRetry={reset} />;
  } else if (picking) {
    const help = walletHelp(navigator.userAgent);
    body = (
      <div>
        <p className="small">A wallet only opens for an on-chain step. Pick yours:</p>
        <div className="wallet-list">
          {wallets.map((w) => (
            <button key={w.name} className="wallet-opt" type="button" onClick={() => void onPick(w)}>
              {w.icon ? <img src={w.icon} alt="" width={24} height={24} /> : <Icon name="wallet" />}
              <span className="wallet-opt__text">
                <span className="wallet-opt__name">{w.name}</span>
                <span className="small">Connects for {NETWORK_LABEL}</span>
              </span>
              <Icon name="next" size="sm" />
            </button>
          ))}
        </div>
        {(wallets.length === 0 || noWalletApp) && (
          <p className="note">
            <Icon name="info" />
            {help.kind === "android"
              ? "No wallet app answered. Install a Solana wallet such as Phantom or Solflare on this phone, then tap Review again."
              : help.kind === "ios"
                ? "iPhone wallets work inside the wallet's own browser. Open this page there:"
                : "No Solana wallet extension was found in this browser. Install one such as Phantom, Solflare or Backpack, then reload."}
            {help.links.map(([label, href]) => (
              <a key={href} className="ext" href={href} style={{ marginLeft: 8 }}>
                {label}
              </a>
            ))}
          </p>
        )}
        <div className="actions">
          <button className="btn btn--ghost" type="button" onClick={() => setPicking(false)}>
            Back
          </button>
        </div>
      </div>
    );
  } else if (flowAction === "deposit") {
    body = (
      <div className="field">
        <label className="label" htmlFor="amount">
          Amount
        </label>
        <div className="amount">
          <input id="amount" inputMode="decimal" autoComplete="off" value={amountText} placeholder="0" aria-describedby="amount-msg" onChange={(e) => setAmountText(e.target.value)} />
          <span className="amount__unit">RLAN</span>
        </div>
        {balance === null ? (
          <p className="small">Your balance and the 25% / 50% / Max shortcuts appear after you connect a wallet, on the next step.</p>
        ) : (
          <div className="chips">
            {([["25%", 4n], ["50%", 2n], ["Max", 1n]] as const).map(([label, div]) => (
              <button key={label} className="chip" type="button" onClick={() => setAmountText(units(balance / div, TOKEN_DECIMALS).replace(/,/g, ""))}>
                {label}
              </button>
            ))}
            <span className="small">Balance: {rlan(balance)}</span>
          </div>
        )}
        <p className={amountError && amountText ? "field-msg field-msg--error" : "field-msg"} id="amount-msg" aria-live="polite">
          {!amountText ? "Enter an amount to review. RLAN has 6 decimals." : amountError || "RLAN has 6 decimals."}
        </p>
        {position === "requested" && (
          <p className="note note--warn">
            <Icon name="info" />
            Adding more cancels your withdrawal request.
          </p>
        )}
        <div className="actions">
          <button className="btn btn--primary" type="button" disabled={Boolean(amountError)} aria-describedby="amount-msg" onClick={() => void onReview()}>
            Review
          </button>
          {position === "active" && (
            <button className="btn btn--ghost" type="button" onClick={() => setAction("request")}>
              Request withdrawal instead
            </button>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <div>
        <p className="small">
          {flowAction === "init"
            ? `Creates this listing's arena on ${NETWORK_LABEL} with 7-day seasons that roll over Monday 00:00 UTC. The schedule cannot be changed afterwards. Only the streamer's wallet can sign this.`
            : flowAction === "withdraw"
            ? "Your release date has passed, so withdrawing everything sends your RLAN back to your wallet, closes your position, and sends your account deposit back."
            : schedule
              ? `Available after ${utc(Number(withdrawAvailableAt(schedule.seasonStart, schedule.seasonSeconds, seasonIndex(schedule.seasonStart, schedule.seasonSeconds, now))) * 1000)}. Your RLAN stays in your support account until then, and adding more before then cancels the request.`
              : ""}
        </p>
        <div className="actions">
          <button className="btn btn--primary" type="button" onClick={() => void onReview()}>
            {flowAction === "init" && !wallet ? "Connect the streamer wallet" : "Continue"}
          </button>
          {flowAction === "request" && (
            <button className="btn btn--ghost" type="button" onClick={() => setAction("deposit")}>
              Add more instead
            </button>
          )}
        </div>
      </div>
    );
  }

  const release = view?.position && view.arena ? Number(withdrawAvailableAt(view.arena.seasonStart, view.arena.seasonSeconds, view.position.requestedSeason)) * 1000 : null;
  const title = flowAction === "init" ? "Create the arena" : flowAction === "deposit" ? (position === "none" ? `Back ${name}` : "Add to your position") : flowAction === "request" ? "Request withdrawal" : "Withdraw everything";
  return (
    <>
      <BackHeader schedule={schedule} slug={slug} name={name} />
      {load === "loading" ? (
        <Skeleton kinds={["block", "block"]} />
      ) : load === "error" ? (
        <ErrorBlock text={`The arena couldn't be read from ${NETWORK_LABEL}. Nothing was sent.`} onRetry={() => void refresh(wallet?.address ?? null)} />
      ) : !view?.arena && !allowSetup ? (
        <div className="back">
          <div className="back__main">
            <EmptyBlock icon="lock" title="Backing is not open" text={IS_MAINNET ? "No mainnet arena is open for this listing, so there is no position to open." : `No arena is open for ${name}.`} />
          </div>
          <aside className="back__side">
            <ChainFacts schedule={null} mint={target.mint} />
            <SeedNote />
          </aside>
        </div>
      ) : !view?.arena ? (
        <div className="back">
          <div className="back__main">
            <section className="panel" aria-labelledby="h-flow">
              <div className="panel__head">
                <h2 className="h3" id="h-flow" tabIndex={-1}>
                  {title}
                </h2>
              </div>
              <Stepper labels={labels} at={Math.max(0, at)} />
              {body}
            </section>
            <p className="small">No arena exists yet for {name}. Fans see this until the streamer key creates it; no other arena is shown here.</p>
          </div>
          <aside className="back__side">
            <ChainFacts schedule={null} mint={target.mint} />
            <SeedNote />
          </aside>
        </div>
      ) : (
        <div className="back">
          <div className="back__main">
            {wallet ? (
              <PositionCard position={position} held={view.position?.amount ?? 0n} release={release} now={Number(now) * 1000} sample={false} />
            ) : (
              <section className="panel" aria-labelledby="h-pos">
                <h2 className="label" id="h-pos">
                  Your position
                </h2>
                <p className="small" style={{ marginTop: 8 }}>
                  Shows once a wallet is connected. Backing is optional; playing is free either way.
                </p>
              </section>
            )}
            <section className="panel" aria-labelledby="h-flow">
              <div className="panel__head">
                <h2 className="h3" id="h-flow" tabIndex={-1}>
                  {title}
                </h2>
              </div>
              <Stepper labels={labels} at={Math.max(0, at)} />
              {body}
            </section>
            {view.arena.closed && (
              <p className="note note--warn">
                <Icon name="info" />
                This arena is closed: no new backing, and every position is available to withdraw.
              </p>
            )}
            {schedule && (
              <p className="small">
                This arena's seasons last {duration(Number(schedule.seasonSeconds))}; it is on-chain season {String(seasonIndex(schedule.seasonStart, schedule.seasonSeconds, now))} now.
              </p>
            )}
          </div>
          <aside className="back__side">
            <BackingFacts />
            {state.step !== "review" && <ChainFacts schedule={schedule} mint={target.mint} />}
            <SeedNote />
          </aside>
        </div>
      )}
    </>
  );
}
