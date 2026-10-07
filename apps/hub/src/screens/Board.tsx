import { useState } from "react";

import { pointsSeasonEyebrow } from "../data/season";
import type { HubSnapshot, PastSeason, PlayBadge } from "../data/types";
import { showsMoney } from "../data/types";
import { EarnedBadges } from "../ui/Collector";
import { fmt, units } from "../lib/format";
import { Address, EmptyBlock, ErrorBlock, PageHead, SampleTag, Skeleton, Stat } from "../ui/atoms";

function Row({ rank, name, points, me = false, badges = [], streakDays = 0 }: { rank: number; name: string; points: number; me?: boolean; badges?: PlayBadge[]; streakDays?: number }) {
  const cls = ["row", rank <= 3 && `row--${rank}`, me && "row--me"].filter(Boolean).join(" ");
  return (
    <li className={cls} value={rank}>
      <span className="row__rank">{rank}</span>
      <div className="row__identity"><span className="row__name">{name}</span>{me && <span className="row__you">You are here</span>}{(badges.length > 0 || streakDays > 0) && <span className="row__marks">{badges.length > 0 && <EarnedBadges record={{ badges }} compact />}{streakDays > 0 && <span className="small">{streakDays}-day active streak</span>}</span>}</div>
      <span className="row__pts">
        {fmt(points)}
        <small>PTS</small>
      </span>
    </li>
  );
}

function LastSeason({ last, sample }: { last: PastSeason; sample: boolean }) {
  const r = last.reward;
  return (
    <>
      <section className="panel" style={{ marginTop: 18 }} aria-labelledby="h-last">
        <div className="panel__head">
          <h2 className="h3" id="h-last">
            Season {last.number}
          </h2>
          <span className="phase phase--closed">Closed</span>
          {sample && <SampleTag />}
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
            <p className="small">Signed at close and recorded in the public ledger. Inclusion proves the published root; it does not prove the scoring was fair or that the perks are funded.</p>
            <p className="small">Network detail: Solana devnet.</p>
            <p className="small">
              Anchor transaction <Address id={r.anchorTx} sample={sample} kind="tx" />
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
  const head = <PageHead eyebrow={season ? pointsSeasonEyebrow(season) : "Radio LAN"} title="Board" lede="Season standing, not redeemable. Joined fans rank by credited site play. Backing adds no points. Meet superfans of the same season on the circle." />;
  if (load === "loading") return <>{head}<Skeleton kinds={["line", "line", "line", "line", "line"]} /></>;
  if (load === "error" || !snapshot) return <>{head}<ErrorBlock text="The board didn't load. Scores are unchanged." onRetry={onRetry} /></>;
  if (!season) return <>{head}<EmptyBlock icon="board" title="No board yet" text="The first board appears when the first season opens. A closed season keeps a provisional record of site play." /></>;
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
              <span className="label">{fmt(season.players)} joined players · provisional points so far</span>
              {snapshot.scenario === "sample" && <SampleTag />}
            </div>
            {snapshot.scenario === "sample" && <p className="small"><SampleTag /> Fictional handles, points and ranks. Return to today for the live board.</p>}
            {season.board.length === 0 ? (
              <EmptyBlock icon="board" title="No points yet" text={joined && season.me ? `Your points so far: ${fmt(season.me.points)}. The provisional board updates as activities are credited.` : "Nobody has played this season yet. Be the first, or look at a sample season with made-up data."}>
                {snapshot.scenario !== "sample" && !(joined && season.me) && <a className="btn" href="?preview=sample#/board">See a sample season</a>}
              </EmptyBlock>
            ) : (
              <ol className="board">
                {season.board.map(([name, points], i) => (
                  <Row key={name} rank={i + 1} name={name} points={points} me={name === snapshot.fan?.handle} badges={season.boardDetails?.find((r) => r.handle === name)?.badges ?? (name === snapshot.fan?.handle ? snapshot.fan?.badges : [])} streakDays={season.boardDetails?.find((r) => r.handle === name)?.streakDays ?? (name === snapshot.fan?.handle ? snapshot.fan?.streakDays : 0)} />
                ))}
                {joined && season.me?.rank && season.me.rank > season.board.length ? <li className="board__gap" aria-hidden="true">···</li> : null}
                {joined && season.me && season.me.rank !== null && season.me.rank > season.board.length && snapshot.fan && <Row rank={season.me.rank} name={`${snapshot.fan.handle} (you)`} points={season.me.points} me badges={snapshot.fan.badges} streakDays={snapshot.fan.streakDays} />}
              </ol>
            )}
            {joined && season.me?.rank === null && snapshot.fan && <p className="note">{snapshot.fan.handle} · You are here · {fmt(season.me.points)} points · Unranked until your first credit. <a href="#/play">Play free</a></p>}
          </>
        ) : snapshot.lastSeason ? (
          <LastSeason last={snapshot.lastSeason} sample={snapshot.scenario === "sample"} />
        ) : (
          <EmptyBlock icon="board" title="No closed season yet" text="Results show here once a season closes." />
        )}
      </div>
      <p className="small fine"><a href="#/circle">Meet superfans</a> of the same season.</p>
    </>
  );
}
