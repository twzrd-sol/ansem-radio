import { useState } from "react";

import { isPlaceholderSeason } from "../data/season";
import type { HubSnapshot, PastSeason } from "../data/types";
import { showsMoney } from "../data/types";
import { fmt, units } from "../lib/format";
import { Address, EmptyBlock, ErrorBlock, PageHead, SampleTag, Skeleton, Stat } from "../ui/atoms";

function Row({ rank, name, points, me = false }: { rank: number; name: string; points: number; me?: boolean }) {
  const cls = ["row", rank <= 3 && `row--${rank}`, me && "row--me"].filter(Boolean).join(" ");
  return (
    <li className={cls} value={rank}>
      <span className="row__rank">{rank}</span>
      <span className="row__name">{name}</span>
      <span className="row__pts">
        {fmt(points)}
        <small>PTS</small>
      </span>
    </li>
  );
}

function LastSeason({ last }: { last: PastSeason }) {
  const r = last.reward;
  return (
    <>
      <section className="panel" style={{ marginTop: 18 }} aria-labelledby="h-last">
        <div className="panel__head">
          <h2 className="h3" id="h-last">
            Season {last.number}
          </h2>
          <span className="phase phase--closed">Closed</span>
          <SampleTag />
        </div>
        <div className="stats">
          <Stat label="Players" value={fmt(last.players)} />
          {showsMoney(r) ? <Stat label="Perks" value={`${units(r.pool.baseUnits, r.pool.decimals)} ${r.pool.asset}`} note="Funded, checked on chain" /> : <Stat label="Perks" value="Not funded" word />}
          <Stat label="Your rank" value={last.me ? `#${last.me.rank}` : "—"} />
        </div>
        {"root" in r && (
          <div className="root">
            <p className="label">Board root</p>
            <p className="mono root__hash">{`${r.root.slice(0, 20)}…${r.root.slice(-8)}`}</p>
            <p className="small">Signed at close and anchored on Solana devnet. Inclusion proves the published root; it does not prove the scoring was fair or that the perks are funded.</p>
            <p className="small">
              Anchor transaction <Address id={r.anchorTx} sample kind="tx" />
            </p>
          </div>
        )}
      </section>
      <ol className="board" style={{ marginTop: 12 }}>
        {last.top.map(([name, points], i) => (
          <Row key={name} rank={i + 1} name={name} points={points} />
        ))}
      </ol>
    </>
  );
}

export function Board({ snapshot, load, joined, onRetry }: { snapshot: HubSnapshot | null; load: "loading" | "error" | "ready"; joined: boolean; onRetry: () => void }) {
  const [tab, setTab] = useState<"this" | "last">("this");
  const season = snapshot?.season ?? null;
  const sampleSeason = isPlaceholderSeason(season);
  const head = <PageHead eyebrow={season ? (sampleSeason ? `Sample season ${season.number} · Radio LAN` : `Season ${season.number} · Radio LAN`) : "Radio LAN"} title="Board" lede="Ranked by points. Points set your share of a funded season's perks and have no other value." />;
  if (load === "loading") return <>{head}<Skeleton kinds={["line", "line", "line", "line", "line"]} /></>;
  if (load === "error" || !snapshot) return <>{head}<ErrorBlock text="The board didn't load. Scores are unchanged." onRetry={onRetry} /></>;
  if (!season) return <>{head}<EmptyBlock icon="board" title="No board yet" text="The first board appears when the first season opens. When that season closes, its board will be signed and anchored on Solana so anyone can check it." /></>;
  return (
    <>
      {head}
      <div className="board-wrap">
        <div className="seg" role="group" aria-label="Season">
          {(["this", "last"] as const).map((key) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
              {key === "this" ? "This season" : "Last season"}
            </button>
          ))}
        </div>
        {tab === "this" ? (
          <>
            <div className="board-head">
              <span className="label">{fmt(season.players)} players · provisional points so far</span>
              {(snapshot.scenario === "sample" || sampleSeason) && <SampleTag />}
            </div>
            {season.board.length === 0 ? (
              <EmptyBlock icon="board" title="No points yet" text={sampleSeason ? "Sample season. The board stays empty until a live season is published." : joined && season.me ? `Your points so far: ${fmt(season.me.points)}. The provisional board updates as activities are credited.` : "Nobody has played this season yet. Be the first, or look at a sample season with made-up data."}>
                {snapshot.scenario !== "sample" && !(joined && season.me) && <a className="btn" href="?preview=sample#/board">See a sample season</a>}
              </EmptyBlock>
            ) : (
              <ol className="board">
                {season.board.map(([name, points], i) => (
                  <Row key={name} rank={i + 1} name={name} points={points} />
                ))}
                <li className="board__gap" aria-hidden="true">
                  ···
                </li>
                {joined && season.me && season.me.rank !== null && season.me.rank > season.board.length && snapshot.fan && <Row rank={season.me.rank} name={`${snapshot.fan.handle} (you)`} points={season.me.points} me />}
              </ol>
            )}
          </>
        ) : snapshot.lastSeason ? (
          <LastSeason last={snapshot.lastSeason} />
        ) : (
          <EmptyBlock icon="board" title="No closed season yet" text="Results show here once a season closes." />
        )}
      </div>
    </>
  );
}
