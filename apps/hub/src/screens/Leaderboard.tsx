// Streamer board. Rank is this season's points — the same credited actions as #/board. Chat is a labelled Twitch read.
import { useEffect, useState } from "react";

import { HUB_LEADERBOARD_ENABLED } from "../data/feature-flags";
import { fetchLeaderboard, type LeaderboardPage, type LeaderboardRow } from "../data/leaderboard";
import { pointsSeasonEyebrow } from "../data/season";
import { fmt } from "../lib/format";
import { EmptyBlock, ErrorBlock, PageHead, Skeleton } from "../ui/atoms";

function seasonEyebrow(season: LeaderboardPage["season"]): string {
  if (!season) return "Radio LAN";
  const network = season.network === "mainnet" || season.network === "devnet" ? season.network : null;
  return pointsSeasonEyebrow({ number: Number(season.number), network });
}

function ChatCell({ row }: { row: LeaderboardRow }) {
  if (!row.chat) return <span className="small">No chat read</span>;
  return (
    <span>
      {fmt(row.chat.messages)}
      <span className="small"> · {row.chat.source}</span>
    </span>
  );
}

function MarksCell({ row }: { row: LeaderboardRow }) {
  if (row.marks.count === 0) return <span className="small">None</span>;
  return <span className="small">{fmt(row.marks.count)}{row.marks.scored ? "" : " · not scored"}</span>;
}

export function LeaderboardView({
  board,
  load,
  onRetry,
  onMore,
}: {
  board: LeaderboardPage | null;
  load: "loading" | "off" | "error" | "ready";
  onRetry: () => void;
  onMore?: () => void;
}) {
  const head = (
    <PageHead
      eyebrow={load === "ready" && board ? seasonEyebrow(board.season) : "Radio LAN"}
      title="Streamer board"
      lede={load === "off" ? "This board is not published on this hub yet." : "Channels ranked by this season's points — the same credited actions and caps as the points board. Chat, when present, is a read. It does not change the rank."}
    />
  );
  if (load === "loading") return <>{head}<Skeleton kinds={["line", "line", "line", "line"]} /></>;
  if (load === "off") {
    return <>{head}<EmptyBlock icon="board" title="This board is not on" text="The streamer board is not published on this hub yet. Nothing here is a live rank." /></>;
  }
  if (load === "error") return <>{head}<ErrorBlock text="The streamer board didn't load. Scores are unchanged." onRetry={onRetry} /></>;
  if (!board || board.empty || board.rows.length === 0) {
    return <>{head}<EmptyBlock icon="board" title="No channels yet" text="No channels match the current read yet." /></>;
  }
  return (
    <>
      {head}
      <p className="small" style={{ marginTop: -8, marginBottom: 14 }}>
        {board.season?.network === "devnet" || Number(board.season?.number) === 2 ? "Season 2 points are on Solana devnet. " : ""}
        Rank uses the published season weights and caps. Viewer counts and watch minutes score nothing.
        {board.source.chat ? ` Chat: ${board.source.chat}.` : " No chat rollup on this read."}
      </p>
      <div className="table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Channel</th>
              <th scope="col" className="num">Points</th>
              <th scope="col">Marks</th>
              <th scope="col">Chat <span className="label">Data: Twitch</span></th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={row.login}>
                <td className="num">{row.rank}</td>
                <th scope="row"><a href={`#/s/${row.slug}`}>{row.name}</a></th>
                <td className="num">{fmt(BigInt(row.points))}</td>
                <td><MarksCell row={row} /></td>
                <td><ChatCell row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {board.page.next && onMore && (
        <p className="actions">
          <button className="btn" type="button" onClick={onMore}>More channels</button>
        </p>
      )}
      <p className="small fine">Points are provisional while the season is open. This board does not offer a collect action. Amounts here are unpriced.</p>
    </>
  );
}

export function Leaderboard() {
  const [load, setLoad] = useState<"loading" | "off" | "error" | "ready">("loading");
  const [board, setBoard] = useState<LeaderboardPage | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    if (!HUB_LEADERBOARD_ENABLED) {
      setBoard(null);
      setLoad("off");
      return;
    }
    setLoad("loading");
    fetchLeaderboard({ after }).then(
      (page) => {
        if (!live) return;
        if (page === null) { setBoard(null); setLoad("off"); return; }
        setBoard((prev) => (after && prev ? { ...page, rows: [...prev.rows, ...page.rows], empty: prev.rows.length + page.rows.length === 0 } : page));
        setLoad("ready");
      },
      () => { if (live) { setBoard(null); setLoad("error"); } },
    );
    return () => { live = false; };
  }, [attempt, after]);
  return (
    <LeaderboardView
      board={board}
      load={load}
      onRetry={() => { setAfter(null); setAttempt((n) => n + 1); }}
      onMore={board?.page.next ? () => setAfter(board.page.next) : undefined}
    />
  );
}
