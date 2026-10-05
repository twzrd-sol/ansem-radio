import { useState, type ReactNode } from "react";

import type { FailKind, FlowStep, Position, PreviewState } from "../app/preview";
import { writePreview } from "../app/preview";
import { ARENA_MINT, ARENA_PROGRAM, IS_MAINNET, NETWORK_LABEL, RLAN_MINT, TOKEN_DECIMALS } from "../chain/config";
import { currentSeason, releaseIfRequestedAt, type ArenaSchedule } from "../chain/season";
import { SAMPLE_MINT, SAMPLE_POSITION, SAMPLE_WALLET } from "../data/sample";
import type { HubSnapshot } from "../data/types";
import { left, parseAmount, units, utc } from "../lib/format";
import { Address, ErrorBlock, Fact, Icon, Item, Skeleton, Tag } from "../ui/atoms";

export type FlowAction = "deposit" | "request" | "withdraw";

/** A first deposit opens a position (104 B) and a support account (165 B); rent comes back on a full withdrawal. */
export const FIRST_DEPOSIT_RENT_LAMPORTS = BigInt((128 + 104) * 6960 + (128 + 165) * 6960);
export const FEE_LAMPORTS = 5000n;

const rlan = (baseUnits: bigint) => `${units(baseUnits, TOKEN_DECIMALS)} RLAN`;
const sol = (lamports: bigint) => `${units(lamports, 9)} SOL`;

export function releaseLine(schedule: ArenaSchedule | null): string {
  if (!schedule) return "It becomes available when the on-chain season you asked in ends. No arena is open yet, so there is no date to show.";
  return `Available after ${utc(releaseIfRequestedAt(schedule))}, for a request made during on-chain season ${currentSeason(schedule)}.`;
}

export function BackHeader({ schedule, slug = "radiolanlive", name = "Radio LAN" }: { schedule: ArenaSchedule | null; slug?: string; name?: string }) {
  return (
    <header className="page-head">
      <a className="crumb" href={`#/s/${slug}`}>
        <Icon name="chev" size="sm" />
        {name}
      </a>
      <p className="eyebrow">Optional · on chain</p>
      <h1 className="h1" tabIndex={-1}>
        Back {name}
      </h1>
      <p className="rule-sub">Request withdrawal anytime. {releaseLine(schedule)}</p>
    </header>
  );
}

export function PositionCard({ position, held, release, now, sample }: { position: Position; held: bigint; release: number | null; now: number; sample: boolean }) {
  const amount = <p className="pos__amt num">{rlan(held)}</p>;
  const body: Record<Position, ReactNode> = {
    none: (
      <>
        <p className="pos__state">No backing yet</p>
        <p className="small">Backing is optional. Playing is free either way.</p>
      </>
    ),
    active: (
      <>
        <p className="pos__state pos__state--ok">Active</p>
        {amount}
        <p className="small">Withdraw by requesting it; it becomes available when the on-chain season you ask in ends.</p>
      </>
    ),
    requested: (
      <>
        <p className="pos__state pos__state--warn">Withdrawal requested</p>
        {amount}
        <p className="small">{release ? `Available after ${utc(release)}, in ${left(release - now)}. ` : ""}Adding more before then cancels the request.</p>
      </>
    ),
    releasable: (
      <>
        <p className="pos__state pos__state--ok">Ready to withdraw</p>
        {amount}
        <p className="small">Your release date has passed, so your RLAN is available to withdraw.</p>
      </>
    ),
  };
  return (
    <section className="panel" aria-labelledby="h-pos">
      <div className="panel__head">
        <h2 className="label" id="h-pos">
          Your position
        </h2>
        {sample && position !== "none" && <Tag kind="sample">Sample</Tag>}
      </div>
      {body[position]}
    </section>
  );
}

export function Stepper({ labels, at }: { labels: string[]; at: number }) {
  return (
    <ol className="steps" aria-label="Progress">
      {labels.map((label, i) => (
        <li key={label} className={i < at ? "done" : i === at ? "now" : undefined} aria-current={i === at ? "step" : undefined}>
          {label}
        </li>
      ))}
    </ol>
  );
}

export interface ReviewRow {
  label: string;
  value: ReactNode;
}

export function ReviewPanel({ rows, preview, note }: { rows: ReviewRow[]; preview: boolean; note?: string }) {
  return (
    <>
      <div className="sim">
        <div className="sim__head">
          <span className="sim__ok">
            <Icon name="check" size="sm" />
            Simulation passed
          </span>
          {preview && <Tag kind="sample">Preview</Tag>}
        </div>
        <dl className="sim__rows">
          {rows.map((r) => (
            <div key={r.label} className="sim__row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {note && (
        <p className="note note--warn" style={{ marginTop: 12 }}>
          <Icon name="info" />
          {note}
        </p>
      )}
    </>
  );
}

/** Preview failures plus the ones only the live flow can hit. */
export type FailureKind = FailKind | "wrong-network" | "no-arena" | "no-tokens" | "failed-onchain" | "not-streamer";

export const FAILURES: Record<FailureKind, { title: string; text: string; retry: boolean }> = {
  cancelled: { title: "Cancelled in your wallet", text: "Nothing was sent. Try again whenever you like.", retry: true },
  simulation: { title: "Your wallet never opened", text: "The simulation failed before signing, so nothing was sent.", retry: false },
  network: { title: `Couldn't reach ${NETWORK_LABEL}`, text: "Nothing was sent. Check your connection and try again.", retry: true },
  expired: { title: "The transaction expired", text: "It never landed, so nothing changed. It needs a fresh review before you sign again.", retry: true },
  "wrong-network": { title: `Not ${NETWORK_LABEL}`, text: "The connection points at another network, so nothing was built or sent.", retry: false },
  "no-arena": { title: "No arena here", text: "Nothing was sent.", retry: false },
  "no-tokens": { title: "Not enough tokens", text: "Nothing was sent.", retry: true },
  "failed-onchain": { title: "The transaction failed on chain", text: "The network refused it, so your position is unchanged.", retry: true },
  "not-streamer": { title: "Not the streamer wallet", text: "Only this listing's streamer wallet can create the arena. Nothing was sent.", retry: true },
};

export function FailedStep({ kind, detail, onRetry }: { kind: FailureKind; detail?: string; onRetry?: () => void }) {
  const copy = FAILURES[kind];
  return (
    <div className="result result--error" role="alert">
      <Icon name="info" size="lg" />
      <p className="h3">{copy.title}</p>
      <p className="small">
        {copy.text}
        {detail ? ` ${detail}` : ""}
      </p>
      <div className="actions">
        {copy.retry && onRetry && (
          <button className="btn btn--primary" type="button" onClick={onRetry}>
            {kind === "expired" ? "Review again" : "Try again"}
          </button>
        )}
        <a className="btn" href="#/s/radiolanlive">
          Back to the stream
        </a>
      </div>
    </div>
  );
}

export function BackingFacts() {
  return (
    <section className="panel" aria-labelledby="h-what">
      <h2 className="label" id="h-what" style={{ marginBottom: 12 }}>
        What backing does
      </h2>
      <ul className="list">
        <Item kind="check">A Backer badge on your profile.</Item>
        <Item kind="check">A voice in future programming as those tools open: a later MC, producer or theme.</Item>
        <Item kind="x">No points, and no change to your share of any season's perks.</Item>
        <Item kind="lock">Your RLAN sits in your own support account. Nobody else can move it, including the streamer.</Item>
      </ul>
    </section>
  );
}

export function ChainFacts({ schedule, mint = ARENA_MINT }: { schedule: ArenaSchedule | null; mint?: string | null }) {
  return (
    <section className="panel" aria-labelledby="h-chain">
      <h2 className="label" id="h-chain" style={{ marginBottom: 12 }}>
        On chain
      </h2>
      <dl className="facts">
        <Fact label="Network">{NETWORK_LABEL}</Fact>
        <Fact label="Program">
          radiolan-arena <Address id={ARENA_PROGRAM} />
        </Fact>
        <Fact label="Token">{mint ? <>{IS_MAINNET && mint === RLAN_MINT ? "$RLAN" : "Token-2022 test mint"} <Address id={mint} /></> : "A Token-2022 test mint, set when the devnet arena is configured. Mainnet uses RLAN."}</Fact>
        <Fact label="Unlock">
          {schedule
            ? `Request withdrawal anytime. A request is available once the on-chain season it was made in ends: ${utc(releaseIfRequestedAt(schedule))} for season ${currentSeason(schedule)}.`
            : "Request withdrawal anytime. A request is available once the on-chain season it was made in ends; the date comes from the arena's own schedule."}
        </Fact>
        <Fact label="If the arena closes">If the arena closes, every position unlocks at once.</Fact>
        {!IS_MAINNET && <Fact label="Mainnet">The radiolan-arena program has been live on mainnet since 2 Oct 2026. This build rehearses on devnet with test tokens.</Fact>}
      </dl>
    </section>
  );
}

export const SeedNote = () => (
  <p className="note">
    <Icon name="lock" />
    Radio LAN never asks for your seed phrase or private key. Your wallet opens once per action, only when you tap Sign.
  </p>
);

export const WALLET_OPTIONS: Array<[string, string]> = [
  ["Phantom", "Extension or app"],
  ["Solflare", "Extension or app"],
  ["Backpack", "Extension"],
  ["Android: your wallet app", "Opens through Mobile Wallet Adapter"],
  ["iPhone: continue in your wallet", "Reopens this page inside a tested wallet's browser"],
];

/** Design-review flow (?preview=sample|today). Every on-chain value here is a fixture or a computed constant. */
function PreviewFlow({ snapshot, preview, now }: { snapshot: HubSnapshot; preview: PreviewState; now: number }) {
  const sample = snapshot.scenario === "sample";
  const schedule = snapshot.arena;
  const release = schedule ? releaseIfRequestedAt(schedule) : null;
  const position: Position = sample ? preview.position : "none";
  const [action, setAction] = useState<FlowAction>("deposit");
  const [amountText, setAmountText] = useState(sample ? units(SAMPLE_POSITION, TOKEN_DECIMALS) : "");
  const amount = parseAmount(amountText, TOKEN_DECIMALS);
  const amountError = amount === null ? "Enter an amount like 250 or 12.5, up to 6 decimals." : amount <= 0n ? "Enter more than 0." : "";
  const flowAction: FlowAction = position === "releasable" ? "withdraw" : position === "active" && action === "request" ? "request" : "deposit";
  const step: FlowStep | "start" = !sample ? (preview.flow === "edit" ? "edit" : "connect") : flowAction !== "deposit" && preview.flow === "edit" ? "start" : preview.flow;
  const go = (flow: FlowStep, nextAction?: FlowAction) => {
    if (nextAction) setAction(nextAction);
    writePreview({ ...preview, flow });
  };
  const labels = flowAction === "deposit" ? ["Amount", "Wallet", "Review", "Sign"] : ["Wallet", "Review", "Sign"];
  const order: Array<FlowStep | "start"> = flowAction === "deposit" ? ["edit", "connect", "review", "signing"] : ["connect", "review", "signing"];
  const at = step === "done" ? labels.length : step === "failed" ? labels.length - 1 : step === "start" ? 0 : Math.max(0, order.indexOf(step));
  const held = position === "none" ? 0n : SAMPLE_POSITION;
  const afterDeposit = held + (amount ?? 0n);
  const title = flowAction === "deposit" ? (position === "none" ? "Back Radio LAN" : "Add to your position") : flowAction === "request" ? "Request withdrawal" : "Withdraw everything";

  let body: ReactNode;
  if (step === "edit") {
    body = (
      <div className="field">
        <div className="panel__head" style={{ marginBottom: 0 }}>
          <label className="label" htmlFor="amount">
            Amount
          </label>
          {sample && <Tag kind="sample">Sample</Tag>}
        </div>
        <div className="amount">
          <input id="amount" inputMode="decimal" autoComplete="off" value={amountText} aria-describedby="amount-msg" onChange={(e) => setAmountText(e.target.value)} />
          <span className="amount__unit">RLAN</span>
        </div>
        <div className="chips">
          {["25%", "50%", "Max"].map((c) => (
            <button key={c} className="chip" type="button" disabled>
              {c}
            </button>
          ))}
          <span className="small">Your balance shows once a wallet is connected.</span>
        </div>
        <p className={amountError ? "field-msg field-msg--error" : "field-msg"} id="amount-msg" aria-live="polite">
          {amountError || "RLAN has 6 decimals."}
        </p>
        {position === "requested" && (
          <p className="note note--warn">
            <Icon name="info" />
            Adding more cancels your withdrawal request.
          </p>
        )}
        <div className="actions">
          <button className="btn btn--primary" type="button" disabled={Boolean(amountError)} onClick={() => go("connect")}>
            Review
          </button>
          {position === "active" && (
            <button className="btn btn--ghost" type="button" onClick={() => go("connect", "request")}>
              Request withdrawal instead
            </button>
          )}
          {position === "requested" && release && (
            <button className="btn btn--ghost" type="button" disabled>
              Withdraw · available after {utc(release)}
            </button>
          )}
        </div>
      </div>
    );
  } else if (step === "start") {
    body = (
      <div>
        <p className="small">
          {flowAction === "withdraw"
            ? "Your release date has passed, so withdrawing everything sends your RLAN back to your wallet, closes your position and gives back the account rent."
            : `Available after ${release ? utc(release) : "the end of this on-chain season"}. Your RLAN stays in your support account until then, and adding more before then cancels the request.`}
        </p>
        <div className="actions">
          <button className="btn btn--primary" type="button" onClick={() => go("connect")}>
            Continue
          </button>
        </div>
      </div>
    );
  } else if (step === "connect") {
    body = (
      <div>
        <p className="small">A wallet only opens for an on-chain step. Pick yours:</p>
        <div className="wallet-list">
          {WALLET_OPTIONS.map(([name, note]) => (
            <button key={name} className="wallet-opt" type="button" disabled={!sample} onClick={() => go("review")}>
              <Icon name="wallet" />
              <span className="wallet-opt__text">
                <span className="wallet-opt__name">{name}</span>
                <span className="small">{note}</span>
              </span>
              <Icon name="next" size="sm" />
            </button>
          ))}
        </div>
        <p className="note">
          <Icon name="info" />
          {sample ? "Preview: no wallet is contacted. Picking an option shows the next step." : "Preview of today's state: no arena is open, so nothing here contacts a wallet."}
        </p>
        <div className="actions">
          <button className="btn btn--ghost" type="button" onClick={() => go("edit", "deposit")}>
            Edit amount
          </button>
        </div>
      </div>
    );
  } else if (step === "review") {
    const rows: ReviewRow[] = [];
    if (flowAction === "deposit") {
      rows.push({ label: "You send", value: <><span className="num sim__big">{rlan(amount ?? 0n)}</span> <Tag kind="net">Devnet test mint</Tag></> });
      rows.push({ label: "From", value: <>Your wallet <Address id={SAMPLE_WALLET.address} sample /></> });
      rows.push({ label: "To", value: <>Your support account <Address id={SAMPLE_WALLET.support} sample /><span className="small block">Only you can withdraw from it, once it's released. Nobody else can move it, including the streamer.</span></> });
      rows.push({ label: "Unlock", value: `Request withdrawal anytime. A request made during on-chain season ${schedule ? currentSeason(schedule) : 0} is available after ${release ? utc(release) : "its season ends"}.` });
    } else if (flowAction === "request") {
      rows.push({ label: "Action", value: <>Request withdrawal of <span className="num">{rlan(SAMPLE_POSITION)}</span></> });
      rows.push({ label: "Available after", value: release ? utc(release) : "the end of this on-chain season" });
    } else {
      rows.push({ label: "You receive", value: <span className="num sim__big">{rlan(SAMPLE_POSITION)}</span> });
      rows.push({ label: "To", value: <>Your wallet <Address id={SAMPLE_WALLET.address} sample /></> });
      rows.push({ label: "Rent back", value: sol(FIRST_DEPOSIT_RENT_LAMPORTS) });
    }
    rows.push({ label: "Program", value: <>radiolan-arena <Address id={ARENA_PROGRAM} /></> });
    if (flowAction !== "request") rows.push({ label: "Token", value: ARENA_MINT ? <>Test mint <Address id={ARENA_MINT} /></> : <>Test mint <Address id={SAMPLE_MINT} sample /></> });
    rows.push({ label: "Network", value: "Solana devnet" });
    if (flowAction === "deposit" && position === "none") rows.push({ label: "Account rent", value: `${sol(FIRST_DEPOSIT_RENT_LAMPORTS)}, returned when you withdraw everything after release` });
    rows.push({ label: "Network fee", value: `About ${sol(FEE_LAMPORTS)}` });
    body = (
      <div>
        <ReviewPanel rows={rows} preview note={flowAction === "deposit" && position === "requested" ? "This deposit cancels your withdrawal request." : undefined} />
        <div className="actions">
          <button className="btn btn--primary" type="button" onClick={() => go("signing")}>
            <Icon name="wallet" />
            Open wallet to sign
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => go(flowAction === "deposit" ? "edit" : "connect")}>
            {flowAction === "deposit" ? "Edit amount" : "Change"}
          </button>
        </div>
      </div>
    );
  } else if (step === "signing") {
    body = (
      <div className="signing" role="status">
        <div className="signing__bars" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </div>
        <p className="h3">Approve in your wallet</p>
        <p className="small">Nothing is sent until you approve. One signature, for this step only.</p>
        <div className="actions">
          <button className="btn btn--primary" type="button" onClick={() => go("done")}>
            Approve (preview)
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => writePreview({ ...preview, flow: "failed", fail: "cancelled" })}>
            Cancel
          </button>
        </div>
      </div>
    );
  } else if (step === "done") {
    const read = flowAction === "deposit" ? `Read back from chain: your position is ${rlan(afterDeposit)}.` : flowAction === "request" ? "Read back from chain: your request is recorded for this season." : "Read back from chain: your position and support account are closed.";
    body = (
      <div className="result result--ok" role="status">
        <Icon name="check" size="lg" />
        <p className="h3">{flowAction === "deposit" ? "You're backing Radio LAN" : flowAction === "request" ? "Withdrawal requested" : "Withdrawn"}</p>
        <p className="small">Confirmed on Solana devnet. {read}</p>
        <p className="small">
          Transaction <Address id={SAMPLE_WALLET.tx} sample kind="tx" />
        </p>
        {flowAction === "deposit" && (
          <div className="sticker sticker--silver">
            <span className="sticker__art" aria-hidden="true">B</span>
            <span className="sticker__name">Backer badge added</span>
          </div>
        )}
        <div className="actions">
          <a className="btn btn--primary" href="#/s/radiolanlive">Back to the stream</a>
          <a className="btn" href="#/me">See your profile</a>
        </div>
      </div>
    );
  } else {
    body = <FailedStep kind={preview.fail} detail={preview.fail === "simulation" ? "The arena is closed to new backing (error 6304)." : undefined} onRetry={() => go("review")} />;
  }

  const shown: Position = step === "done" ? (flowAction === "deposit" ? "active" : flowAction === "request" ? "requested" : "none") : position;
  const shownHeld = step === "done" && flowAction === "deposit" ? afterDeposit : held;
  return (
    <div className="back">
      <div className="back__main">
        <PositionCard position={shown} held={shownHeld} release={release} now={now} sample={sample} />
        <section className="panel" aria-labelledby="h-flow">
          <div className="panel__head">
            <h2 className="h3" id="h-flow" tabIndex={-1}>
              {title}
            </h2>
          </div>
          <Stepper labels={labels} at={at} />
          {body}
        </section>
      </div>
      <aside className="back__side">
        <BackingFacts />
        {/* The review card already lists network, program, token and unlock; no second copy beside it. */}
        {preview.flow !== "review" && <ChainFacts schedule={schedule} />}
        <SeedNote />
      </aside>
    </div>
  );
}

export function Back({ snapshot, load, preview, now, onRetry, live, slug = "radiolanlive", name = "Radio LAN" }: {
  snapshot: HubSnapshot | null;
  load: "loading" | "error" | "ready";
  preview: PreviewState;
  now: number;
  onRetry: () => void;
  /** The live flow (wallet + chain), used outside design preview. */
  live?: ReactNode;
  slug?: string;
  name?: string;
}) {
  if (!preview.enabled && live) return <>{live}</>;
  const schedule = snapshot?.arena ?? null;
  return (
    <>
      <BackHeader schedule={schedule} slug={slug} name={name} />
      {load === "loading" ? (
        <Skeleton kinds={["block", "block"]} />
      ) : load === "error" || !snapshot ? (
        <ErrorBlock text={`Your position couldn't be read from ${NETWORK_LABEL}. Nothing was sent.`} onRetry={onRetry} />
      ) : (
        <PreviewFlow snapshot={snapshot} preview={preview} now={now} />
      )}
    </>
  );
}
