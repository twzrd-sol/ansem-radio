// My positions: what one wallet has committed across every listed arena, read from the station's index. A wallet is
// pasted or connected; nothing is signed here. Points are free and separate, and are only linked to, never mixed in.
import { useEffect, useState } from "react";

import { NETWORK_LABEL, TOKEN_DECIMALS } from "../chain/config";
import { fetchPositions, isAddress, positionStatus, type FanPositions, type Listing } from "../data/market";
import { fmt, left, units, utc } from "../lib/format";
import { EmptyBlock, ErrorBlock, Icon, PageHead, SampleTag, Skeleton } from "../ui/atoms";
import { ObservedLine } from "./Market";

const FAN_KEY = "radiolan-hub:fan";
const remember = (fan: string) => {
  try {
    window.sessionStorage.setItem(FAN_KEY, fan);
  } catch {
    /* storage unavailable */
  }
};
const recall = (): string => {
  try {
    return window.sessionStorage.getItem(FAN_KEY) ?? "";
  } catch {
    return "";
  }
};

export function Positions({ listings, now, wallet, onConnect, sample, load: marketLoad, onRetry, read = fetchPositions }: {
  listings: Listing[];
  now: number;
  /** A wallet the page already connected, if any. */
  wallet: string | null;
  /** Opens the fan's wallet to read its address; absent in a design preview. */
  onConnect?: () => Promise<string | null>;
  /** Fixtures for design review. */
  sample?: FanPositions | null;
  load: "loading" | "error" | "ready";
  onRetry: () => void;
  read?: (fan: string) => Promise<FanPositions>;
}) {
  const [fan, setFan] = useState("");
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "error"; text: string } | { status: "ready"; data: FanPositions }>(sample ? { status: "ready", data: sample } : { status: "idle" });
  const [busy, setBusy] = useState(false);
  useEffect(() => setFan(wallet ?? recall()), [wallet]);

  const lookup = async (address: string) => {
    if (!isAddress(address)) {
      setState({ status: "error", text: "Enter a Solana address (32 to 44 base58 characters)." });
      return;
    }
    remember(address);
    setState({ status: "loading" });
    try {
      setState({ status: "ready", data: await read(address) });
    } catch {
      setState({ status: "error", text: "Couldn't read positions from the station. Nothing on chain changed." });
    }
  };
  const connect = async () => {
    if (!onConnect) return;
    setBusy(true);
    try {
      const address = await onConnect();
      if (address) {
        setFan(address);
        await lookup(address);
      }
    } finally {
      setBusy(false);
    }
  };

  const head = <PageHead title="My positions" lede="Every arena this wallet backs, read from chain. Request withdrawal anytime; it is available when the on-chain season you asked in ends. Reading needs no signature." />;
  if (marketLoad === "loading") return <>{head}<Skeleton kinds={["block", "block"]} /></>;
  if (marketLoad === "error") return <>{head}<ErrorBlock text="The board didn't load, so positions can't be matched to listings." onRetry={onRetry} /></>;
  const nameOf = (slug: string | null) => listings.find((l) => l.slug === slug)?.name ?? "An unlisted arena";
  const nowSeconds = BigInt(Math.floor(now / 1000));

  return (
    <>
      {head}
      {!sample && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(fan.trim());
          }}
        >
          <label className="label" htmlFor="fan">
            Wallet address
          </label>
          <div className="amount">
            <input id="fan" value={fan} inputMode="text" autoComplete="off" spellCheck={false} placeholder="Paste an address" onChange={(e) => setFan(e.target.value)} />
          </div>
          <div className="actions">
            {onConnect && (
              <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void connect()}>
                <Icon name="wallet" />
                {busy ? "Opening wallet…" : "Use my wallet"}
              </button>
            )}
            <button className={onConnect ? "btn btn--ghost" : "btn btn--primary"} type="submit" disabled={state.status === "loading" || fan.trim() === ""}>
              {state.status === "loading" ? "Reading…" : "Show positions"}
            </button>
          </div>
          {state.status === "error" && (
            <p className="field-msg field-msg--error" role="alert">
              {state.text}
            </p>
          )}
        </form>
      )}
      {state.status === "ready" && (
        <>
          <ObservedLine data={state.data} sample={Boolean(sample)} now={now} />
          {state.data.positions.length === 0 ? (
            <EmptyBlock icon="heart" title="No positions" text={`This wallet backs no listed creator on ${NETWORK_LABEL}. Backing is optional; playing is free either way.`}>
              <a className="btn" href="#/">
                The Board
              </a>
            </EmptyBlock>
          ) : (
            <ul className="poslist" aria-label="Positions">
              {state.data.positions.map((p) => {
                const s = positionStatus(p, nowSeconds);
                return (
                  <li key={p.address} className="poslist__row">
                    <div className="poslist__main">
                      <a className="poslist__name" href={p.slug ? `#/s/${p.slug}` : "#/"}>
                        {nameOf(p.slug)}
                        {sample && <SampleTag />}
                      </a>
                      <p className="small">
                        {s.state === "active" && "Active. Withdraw by requesting it."}
                        {s.state === "requested" && s.releaseAt && `Withdrawal requested; available after ${utc(s.releaseAt)}, in ${left(s.releaseAt - now)}.`}
                        {s.state === "releasable" && "Ready to withdraw."}
                        {p.schedule?.closed && " The arena is closed."}
                      </p>
                    </div>
                    <div className="poslist__side">
                      <span className="pos__amt num">{units(BigInt(p.amount), TOKEN_DECIMALS)} RLAN</span>
                      <span className={s.state === "requested" ? "pos__state pos__state--warn" : "pos__state pos__state--ok"}>{s.state === "active" ? "Active" : s.state === "requested" ? "Requested" : "Ready"}</span>
                      {p.slug && (
                        <a className="btn btn--ghost" href={`#/back/${p.slug}`}>
                          Manage
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
              <li className="poslist__total">
                <span className="label">Committed, all listings</span>
                <span className="num">{units(state.data.positions.reduce((sum, p) => sum + BigInt(p.amount), 0n), TOKEN_DECIMALS)} RLAN</span>
                <span className="small">{fmt(state.data.positions.length)} {state.data.positions.length === 1 ? "position" : "positions"}</span>
              </li>
            </ul>
          )}
        </>
      )}
      <p className="note aside-note">
        <Icon name="info" />
        Season points are free and separate: backing never adds points or changes a season's perks. <a href="#/play">Play</a> · <a href="#/me">Profile</a>
      </p>
    </>
  );
}
