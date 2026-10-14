// Fan board. Markets rank by the RLAN fans have backed them with; creators without a market rank by how many fans asked
// for one. Everything else is a lane of creators listed by name. Twitch figures are a labelled read and never sort.
// Asking books no points and no ICELAN.
import { useEffect, useState } from "react";

import { createHubApi, HubApiError } from "../data/api";
import { fetchFanBoard, type FanBoard as Board, type FanBoardEntry } from "../data/fan-board";
import { HUB_FAN_BOARD_ENABLED } from "../data/feature-flags";
import { fmt, tokenAmount } from "../lib/format";
import { EmptyBlock, ErrorBlock, PageHead, Skeleton } from "../ui/atoms";

export type AskState = { status: "idle" } | { status: "sending" } | { status: "done"; already: boolean } | { status: "error"; text: string };
export type LaneKey = "backable" | "asked" | "big" | `game:${string}`;
export interface Lane { key: LaneKey; label: string; count: number; ranked: boolean }

const lede = (threshold: number) => `Fans back creators with $RLAN. A creator without a market gets in line for one at ${threshold} asks.`;
const byName = (a: FanBoardEntry, b: FanBoardEntry) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
const open = (e: FanBoardEntry) => e.market !== null && !e.market.closed;

export function askErrorText(error: unknown): string {
  if (error instanceof HubApiError) {
    if (error.status === 401) return "Sign in to ask.";
    if (error.code === "daily_ask_limit") return "That's today's 10 asks. Try again tomorrow.";
    if (error.code === "market_already_open") return "This creator already has a market.";
    if (error.status === 429) return "Too fast. Try again in a minute.";
  }
  return "That didn't go through. Try again.";
}

/** Lanes, in a fixed order, then categories by how many creators they hold (a count of creators, never of viewers). */
export function lanesOf(entries: FanBoardEntry[]): Lane[] {
  const lanes: Lane[] = [{ key: "backable", label: "Backable", count: entries.filter(open).length, ranked: true }];
  const asked = entries.filter((e) => !e.market && e.asks > 0).length;
  if (asked > 0) lanes.push({ key: "asked", label: "Asked", count: asked, ranked: true });
  const big = entries.filter((e) => !e.market && (e.kind === "tracked" || e.kind === "featured")).length;
  if (big > 0) lanes.push({ key: "big", label: "Big channels", count: big, ranked: false });
  const games = new Map<string, number>();
  for (const e of entries) {
    const game = e.performance?.game;
    if (!e.market && e.kind === "discovered" && game) games.set(game, (games.get(game) ?? 0) + 1);
  }
  for (const [game, count] of [...games].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lanes.push({ key: `game:${game}`, label: game, count, ranked: false });
  }
  return lanes;
}

/** Rows for a lane. Backable and Asked keep the station's order (backing, then asks); every other lane is by name. */
export function rowsOf(entries: FanBoardEntry[], lane: LaneKey): FanBoardEntry[] {
  if (lane === "backable") return entries.filter(open);
  if (lane === "asked") return entries.filter((e) => !e.market && e.asks > 0);
  if (lane === "big") return entries.filter((e) => !e.market && (e.kind === "tracked" || e.kind === "featured")).sort(byName);
  const game = lane.slice(5);
  return entries.filter((e) => !e.market && e.kind === "discovered" && e.performance?.game === game).sort(byName);
}

/** The Twitch state a row shows: live viewers, or "Offline" for a creator without a market. Markets show only when live. */
function twitchLine(entry: FanBoardEntry, lane: LaneKey): string | null {
  const p = entry.performance;
  if (!p) return null;
  if (p.live && typeof p.viewers === "number") return `${fmt(p.viewers)} watching${p.game && !lane.startsWith("game:") ? ` · ${p.game}` : ""}`;
  return p.live === false && !entry.market ? "Offline" : null;
}

function meta(entry: FanBoardEntry, lane: LaneKey, threshold: number): string {
  if (entry.market) {
    if (entry.market.closed) return "Market closed";
    const backed = `${tokenAmount(BigInt(entry.market.total), entry.market.decimals).label} $RLAN · ${fmt(BigInt(entry.market.backers))} ${entry.market.backers === "1" ? "backer" : "backers"}`;
    const twitch = twitchLine(entry, lane);
    return twitch ? `${backed} · ${twitch}` : backed;
  }
  const parts: string[] = [];
  if (entry.ready) parts.push(`In line for a market · ${fmt(entry.asks)} asks`);
  else if (entry.asks > 0) parts.push(`${fmt(entry.asks)} of ${fmt(threshold)} asks`);
  const twitch = twitchLine(entry, lane);
  if (twitch) parts.push(twitch);
  return parts.join(" · ");
}

function Action({ entry, ask, onAsk }: { entry: FanBoardEntry; ask: AskState; onAsk?: (login: string) => void }) {
  if (open(entry) && entry.slug) return <a className="btn btn--follow" href={`#/back/${entry.slug}`} aria-label={`Back ${entry.name}`}>Back</a>;
  if (entry.market) return null;
  if (ask.status === "done") return <span className="small">{ask.already ? "Already asked" : "Asked"}</span>;
  if (ask.status === "error") return <span className="small" role="alert">{ask.text}</span>;
  return (
    <button className="btn btn--follow" type="button" aria-label={`Ask for a market for ${entry.name}`} disabled={!onAsk || ask.status === "sending"} onClick={() => onAsk?.(entry.twitch)}>
      {ask.status === "sending" ? "Asking…" : "Ask"}
    </button>
  );
}

export function FanBoardView({ board, load, lane = "backable", onLane, asks = {}, onAsk, onRetry }: { board: Board | null; load: "loading" | "off" | "error" | "ready"; lane?: LaneKey; onLane?: (lane: LaneKey) => void; asks?: Record<string, AskState>; onAsk?: (login: string) => void; onRetry: () => void }) {
  const head = <PageHead title="Fan board" lede={load === "off" ? "This board is not published on this hub yet." : lede(board?.askThreshold ?? 5)} />;
  if (load === "loading") return <>{head}<Skeleton kinds={["line", "line", "line", "line"]} /></>;
  if (load === "off") return <>{head}<EmptyBlock icon="board" title="This board is not on" text="The fan board is not published on this hub yet." /></>;
  if (load === "error") return <>{head}<ErrorBlock text="The fan board didn't load. Nothing you backed has changed." onRetry={onRetry} /></>;
  if (!board || board.entries.length === 0) return <>{head}<EmptyBlock icon="board" title="No creators yet" text="No creators on the board yet." /></>;
  const s = board.summary;
  const lanes = lanesOf(board.entries);
  const current = lanes.find((l) => l.key === lane) ?? lanes[0]!;
  const rows = rowsOf(board.entries, current.key);
  const showsTwitch = rows.some((e) => twitchLine(e, current.key) !== null);
  return (
    <>
      {head}
      <p className="small fan-summary">
        {fmt(s.markets)} {s.markets === 1 ? "market" : "markets"} · {fmt(s.ready)} in line · {fmt(s.asks)} {s.asks === 1 ? "ask" : "asks"} · {fmt(s.creators)} creators
      </p>
      <div className="lanes" role="group" aria-label="Lane">
        {lanes.map((l) => (
          <button key={l.key} type="button" aria-pressed={l.key === current.key} onClick={() => onLane?.(l.key)}>
            {l.label} <span className="num">{fmt(l.count)}</span>
          </button>
        ))}
      </div>
      <p className="label fan-lane-head">
        {current.label} · {current.key === "backable" ? "ranked by $RLAN backed" : current.key === "asked" ? "no market yet · ranked by asks" : "no market yet · by name"}
        {showsTwitch ? <span className="label"> · Data: Twitch</span> : null}
      </p>
      {rows.length === 0 ? (
        <p className="small">No creators in this lane yet.</p>
      ) : (
        <ol className="fan-list">
          {rows.map((entry, i) => (
            <li key={entry.twitch} className="fan-row">
              {current.ranked ? <span className="fan-rank num">{i + 1}</span> : null}
              <div className="fan-who">
                {entry.slug ? <a href={`#/s/${entry.slug}`}>{entry.name}</a> : <a href={`https://www.twitch.tv/${entry.twitch}`} target="_blank" rel="noopener noreferrer">{entry.name}</a>}
                <span className="small fan-meta">{meta(entry, current.key, board.askThreshold)}</span>
              </div>
              <div className="fan-act"><Action entry={entry} ask={asks[entry.twitch] ?? { status: "idle" }} onAsk={onAsk} /></div>
            </li>
          ))}
        </ol>
      )}
      {current.key === "backable" && rows.length < 5 && lanes.length > 1 ? <p className="small">Your creator isn't here yet? Pick a lane above and ask for their market.</p> : null}
      <p className="small fine">Backing is a deposit of $RLAN you withdraw after the season. Asking books no points and no ICELAN. Lanes are ordered by how many creators they hold; inside a lane, creators are listed by name. Twitch figures never change the order.</p>
    </>
  );
}

export function FanBoard() {
  const [load, setLoad] = useState<"loading" | "off" | "error" | "ready">("loading");
  const [board, setBoard] = useState<Board | null>(null);
  const [lane, setLane] = useState<LaneKey>("backable");
  const [asks, setAsks] = useState<Record<string, AskState>>({});
  const [attempt, setAttempt] = useState(0);
  const [api] = useState(() => createHubApi());
  useEffect(() => {
    let live = true;
    if (!HUB_FAN_BOARD_ENABLED) { setLoad("off"); return; }
    setLoad("loading");
    fetchFanBoard().then(
      (next) => { if (!live) return; if (next === null) { setLoad("off"); return; } setBoard(next); setLoad("ready"); },
      () => { if (live) setLoad("error"); },
    );
    return () => { live = false; };
  }, [attempt]);
  const onAsk = (login: string) => {
    setAsks((prev) => ({ ...prev, [login]: { status: "sending" } }));
    api.askForMarket(login).then(
      (result) => {
        setAsks((prev) => ({ ...prev, [login]: { status: "done", already: result.already } }));
        setBoard((prev) => prev && { ...prev, entries: prev.entries.map((e) => (e.twitch === login ? { ...e, asks: result.asks, ready: result.asks >= prev.askThreshold } : e)) });
      },
      (error) => setAsks((prev) => ({ ...prev, [login]: { status: "error", text: askErrorText(error) } })),
    );
  };
  return <FanBoardView board={board} load={load} lane={lane} onLane={setLane} asks={asks} onAsk={onAsk} onRetry={() => setAttempt((n) => n + 1)} />;
}
