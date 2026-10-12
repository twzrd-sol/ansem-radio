import { useCallback, useEffect, useRef, useState } from "react";
import { ICELAN_MINT } from "../chain/config";
import { HubApiError } from "../data/api";
import { fetchIcelanTasks, type IcelanTasksView, type TaskId } from "../data/icelan-tasks";
import { VAULT_HOLDS, claimsStory, icelanClaimsOpen, type ClaimsInput } from "../data/public-copy";
import { watchVisible } from "../data/refresh";
import { units } from "../lib/format";
import { Icon } from "./atoms";

const LABEL: Record<TaskId, string> = { twitch_link: "Link Twitch", wallet_link: "Link a wallet", chat: "Chat in #radiolanlive" };

export function TaskRecord({ view, claims }: { view: IcelanTasksView; claims?: ClaimsInput }) {
  const open = icelanClaimsOpen({ stationClaim: view.claim, ...claims });
  const full = BigInt(view.pool) >= BigInt(view.poolCap);
  return <>
    <p className="icelan-tasks__total num">{units(BigInt(view.earned), 6)} <span>ICELAN recorded</span></p>
    <ul className="icelan-tasks__list">
      {view.tasks.map((task) => <li key={task.id}>
        <div><span>{LABEL[task.id]}</span><span className="small block">{task.id === "chat"
          ? view.chatEnabled ? `${view.today} of ${view.dailyCap} today · resets at 00:00 UTC` : "Chat recording is paused"
          : task.done ? "Recorded once" : "One-time task"}</span></div>
        <span className="icelan-tasks__amount">{units(BigInt(task.amount), 6)} ICELAN{task.id === "chat" ? " each" : ""}{task.done && task.id !== "chat" && <Icon name="check" size="sm" />}</span>
      </li>)}
    </ul>
    {view.claimWallet && <p className="small">Claim wallet <code>{view.claimWallet}</code>. Claims for this account stay with it; the station has co-signed up to {units(BigInt(view.issuedCumulative ?? "0"), 6)} ICELAN for it. Co-signing records the station's approval; Collect reads this wallet's on-chain claim record to show confirmed paid amounts.</p>}
    {full && <p className="small" role="status">The recording cap has been reached. New rewards are paused.</p>}
    <p className="small">Recorded here. {open ? "Claims are open at Collect when your wallet passes the on-chain checks." : claimsStory({ stationClaim: view.claim, ...claims })} {VAULT_HOLDS}</p>
    <p className="small">Data: Twitch · Chat is observed on the channel. Season points stay in Play.</p>
    <details className="icelan-tasks__details"><summary className="small">Reward availability</summary>
      <p className="small">Recording stops at {units(BigInt(view.poolCap), 6)} ICELAN across all accounts. That cap is separate from the vault balance.</p>
      <a className="small ext" href={`https://explorer.solana.com/address/${ICELAN_MINT}`} target="_blank" rel="noopener noreferrer">ICELAN mint on mainnet</a>
    </details>
  </>;
}

export function IcelanTasks({ accountId, refreshKey = 0 }: { accountId: string | null; refreshKey?: number }) {
  const [view, setView] = useState<IcelanTasksView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!accountId) return;
    const id = ++request.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const next = await fetchIcelanTasks(accountId, abort.signal);
      if (id === request.current) { setView(next); setError(""); }
    } catch (err) {
      if (id === request.current) {
        setView(null);
        setError(err instanceof HubApiError && err.status === 401 ? "Sign in on Profile to see your task records." : "Task records couldn't load. Try again.");
      }
    } finally { if (id === request.current) setLoading(false); }
  }, [accountId]);
  useEffect(() => {
    setView(null); setError("");
    if (!accountId) return;
    const stop = watchVisible(refresh, 5000);
    return () => { ++request.current; controller.current?.abort(); stop(); };
  }, [accountId, refreshKey, refresh]);
  if (!accountId) return null;
  const shown = view?.accountId === accountId ? view : null;
  return <section className="icelan-tasks" aria-labelledby="h-icelan-tasks" aria-busy={loading}>
    <div className="panel__head"><h3 className="label" id="h-icelan-tasks">Task rewards</h3>
      <button className="link-btn" type="button" disabled={loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh"}</button>
    </div>
    {shown ? <TaskRecord view={shown} /> : <p className="small" role={error ? "status" : undefined}>{error || "Loading task records…"}</p>}
  </section>;
}
