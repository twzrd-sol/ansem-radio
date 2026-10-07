import type { ReactNode } from "react";
import { creatorCircles } from "../data/circle";
import type { CollectorRecord, HistoryRow, HubSnapshot } from "../data/types";
import { showsMoney } from "../data/types";
import { useBacker } from "../data/backer";
import { EarnedBadges } from "../ui/Collector";
import { SuperfansPeek } from "../ui/Competition";
import { fmt } from "../lib/format";
import { EmptyBlock, ErrorBlock, Fact, Icon, PageHead, SampleTag, Skeleton, Stat, Tag } from "../ui/atoms";

/** A fan's share of a funded pool: pool x points / eligible points, rounded down. Shown as an amount only on a review. */
export const shareOf = (pool: bigint, points: number, eligiblePoints: number) => (pool * BigInt(points)) / BigInt(eligiblePoints);

/** The share as a percentage of the season's perks, rounded down to two decimals. */
export const sharePercent = (points: number, eligiblePoints: number) => `${(Math.floor((points * 10_000) / eligiblePoints) / 100).toFixed(2)}%`;

function shareCell(r: HistoryRow): string {
  if (!showsMoney(r.reward)) return r.reward.kind === "anchored" || r.reward.kind === "finalized" ? "Not funded, nothing to share" : "Provisional recap; no funded share";
  return `${sharePercent(r.points, r.eligiblePoints)} of the perks, collect later`;
}

export type AccountAction = (mode: "register" | "login") => Promise<void>;

function AccountPanel({ snapshot, wallet, onAccount, onSignOut, links }: { snapshot: HubSnapshot; wallet: string | null; onAccount?: AccountAction; onSignOut?: () => Promise<void>; links?: ReactNode }) {
  const points = snapshot.season?.me?.points ?? null;
  return (
    <section className="panel" aria-labelledby="h-account">
      <h2 className="label" id="h-account" style={{ marginBottom: 6 }}>
        Account
      </h2>
      <p className="h3" style={{ margin: "0 0 10px" }}>
        {points === null ? "No season standing yet" : `${fmt(points)} points this season`}
      </p>
      <dl className="facts">
        <Fact label="Hub account">
          {snapshot.fan ? (
            <>
              {snapshot.fan.handle} {snapshot.scenario === "sample" && <SampleTag />}
              {onSignOut && (
                <button className="btn btn--ghost" type="button" style={{ marginLeft: 8 }} onClick={() => void onSignOut()}>
                  Sign out
                </button>
              )}
            </>
          ) : (
            "Created with a passkey on your first visit. No wallet needed."
          )}
        </Fact>
        <Fact label="Connected wallet">
          {wallet ?? "Not connected. Your wallet locker is separate from free site play."} <a href="#/positions">Your locker</a>
        </Fact>
        {!links && <Fact label="Twitch">
          Not linked. Optional; linking never adds points. <Tag kind="soon">Not available yet</Tag>
        </Fact>}
        <Fact label="Communities">
          Real membership can unlock season-points eligibility. <a href="#/communities">Open communities</a>
        </Fact>
      </dl>
      {links}
      {!snapshot.fan && onAccount && (
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn btn--primary" type="button" onClick={() => void onAccount("register")}>
            Create account with a passkey
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => void onAccount("login")}>
            Sign in with a passkey
          </button>
        </div>
      )}
    </section>
  );
}

export function Profile({ snapshot, load, backer, wallet, onRetry, onAccount, onSignOut, links }: { snapshot: HubSnapshot | null; load: "loading" | "error" | "ready"; backer: boolean; wallet: string | null; onRetry: () => void; onAccount?: AccountAction; onSignOut?: () => Promise<void>; links?: ReactNode }) {
  const liveBacker = useBacker(wallet, snapshot?.scenario === "today" && load === "ready");
  const head = <PageHead title="Profile" lede="Your play, collected marks and season history. Points reset; your record stays." />;
  if (load === "loading") return <>{head}<Skeleton kinds={["block", "block"]} /></>;
  if (load === "error" || !snapshot) return <>{head}<ErrorBlock text="Your profile didn't load. Your history is unchanged." onRetry={onRetry} /></>;
  if (!snapshot.fan) {
    return (
      <>
        {head}
        <AccountPanel snapshot={snapshot} wallet={wallet} onAccount={onAccount} onSignOut={onSignOut} links={links} />
        <div style={{ marginTop: 16 }}>
          <EmptyBlock icon="star" title="No history yet" text="Your history starts when you join the first season. Badges and receipts stay when points reset." />
        </div>
      </>
    );
  }
  const last = snapshot.history[0];
  const collector: CollectorRecord = snapshot.fan.badges ? snapshot.fan : snapshot.season?.me ?? {};
  const stationCircle = creatorCircles(snapshot, [], [])[0] ?? null;
  return (
    <>
      {head}
      {last && (
        <section className="case" aria-labelledby="h-recap">
          <div className="season__head">
            <h2 className="h3" id="h-recap">
              Season {last.season} recap
            </h2>
            {snapshot.scenario === "sample" && <SampleTag />}
          </div>
          <div className="who">
            <div>
              <p className="h3">{snapshot.fan.handle}</p>
              <p className="small">{snapshot.fan.since > 0 ? `Playing since Season ${snapshot.fan.since}` : "Your site play record"}</p>
            </div>
          </div>
          <div className="stats">
            <Stat label="Points" value={fmt(last.points)} />
            <Stat label="Rank" value={`#${last.rank}`} note={`of ${fmt(last.players)}`} />
            <Stat label="Share" value={showsMoney(last.reward) ? sharePercent(last.points, last.eligiblePoints) : "None"} note="Of the season's perks, set by points" />
          </div>
          <div className="actions">
            <a className="btn" href="#/claim">
              <Icon name="receipt" />
              Collect details
            </a>
          </div>
        </section>
      )}
      <div className="me-grid">
        <AccountPanel snapshot={snapshot} wallet={wallet} onAccount={onAccount} onSignOut={onSignOut} links={links} />
        <section className="panel" aria-labelledby="h-badges">
          <div className="panel__head">
            <h2 className="label" id="h-badges">
              Badges
            </h2>
            {snapshot.scenario === "sample" && <SampleTag />}
          </div>
          <p className="small" style={{ marginBottom: 14 }}>
            Credited site play lights your marks. Badges stay when points reset.
          </p>
          <EarnedBadges record={collector} backer={snapshot.scenario === "sample" ? backer : liveBacker} sample={snapshot.scenario === "sample"} />
          {snapshot.scenario === "today" && <div className="collector-goals">
            {!collector.badges?.includes("three_days") && <p className="small">Three days played (locked) · {collector.activityDays === undefined ? "Play on 3 distinct UTC days" : `${collector.activityDays} of 3 distinct UTC days`} with credited site play.</p>}
            {(collector.streakDays ?? 0) > 0 && <p className="small">{collector.streakDays}-day active streak · consecutive credited UTC days.</p>}
            <p className="small">Backer (optional) · a current position in <a href="#/positions">your locker</a>. Backing adds no points.</p>
          </div>}
        </section>
        <SuperfansPeek circle={stationCircle} sample={snapshot.scenario === "sample"} />
        <section className="panel" aria-labelledby="h-history">
          <div className="panel__head">
            <h2 className="label" id="h-history">
              History
            </h2>
            {snapshot.scenario === "sample" && <SampleTag />}
          </div>
          {snapshot.history.length === 0 ? (
            <p className="small">No finished seasons yet. Each season you play shows here with your points and rank.</p>
          ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col">Points</th>
                <th scope="col">Rank</th>
                <th scope="col">Perks share</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.history.map((r) => (
                <tr key={r.season}>
                  <td className="n">{r.season}</td>
                  <td className="n">{fmt(r.points)}</td>
                  <td>
                    #{r.rank} of {fmt(r.players)}
                  </td>
                  <td>{shareCell(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </section>
        <section className="panel" aria-labelledby="h-receipts">
          <div className="panel__head">
            <h2 className="label" id="h-receipts">
              Receipts
            </h2>
            {snapshot.scenario === "sample" && <SampleTag />}
          </div>
          {snapshot.history.filter((r) => "anchorTx" in r.reward).map((r) => (
            <div key={r.season} className="receipt">
              <Icon name="receipt" />
              <div>
                <p>Season {r.season} receipt</p>
                <p className="small">Signed at close and recorded in the public ledger.</p>
                <p className="small">Network detail: Solana devnet.</p>
              </div>
            </div>
          ))}
          {!snapshot.history.some((r) => "anchorTx" in r.reward) && <p className="small">No anchored receipts yet. Frozen season recaps remain provisional; they are not ledger receipts.</p>}
        </section>
      </div>
    </>
  );
}
