import type { ReactNode } from "react";
import type { Market } from "../data/market";
import { pointsSeasonNetworkLabel } from "../data/season";
import { SupportStatus } from "../ui/SupportStatus";
import type { CollectorRecord, HistoryRow, HubSnapshot } from "../data/types";
import { showsMoney } from "../data/types";
import { useBacker } from "../data/backer";
import { EarnedBadges } from "../ui/Collector";
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

function AccountPanel({ snapshot, wallet, onAccount, onSignOut, links, tasks }: { snapshot: HubSnapshot; wallet: string | null; onAccount?: AccountAction; onSignOut?: () => Promise<void>; links?: ReactNode; tasks?: ReactNode }) {
  const points = snapshot.season?.me?.points ?? null;
  return (
    <section className="panel account-panel" aria-labelledby="h-account">
      <div className="who">
        <span className="who__identity" aria-hidden="true"><Icon name="me" size="lg" /></span>
        <div>
          <h2 className="h3" id="h-account" style={{ margin: 0 }}>
            {snapshot.fan ? snapshot.fan.handle : "Your account"} {snapshot.scenario === "sample" && <SampleTag />}
          </h2>
          <p className="small">{points === null ? "Season points start in Play." : `${fmt(points)} season points from Play.`}{snapshot.season && pointsSeasonNetworkLabel(snapshot.season) && <span className="block small">{pointsSeasonNetworkLabel(snapshot.season)} · Season {snapshot.season.number}</span>}</p>
        </div>
        {snapshot.fan && onSignOut && (
          <button className="btn btn--ghost" type="button" onClick={() => void onSignOut()}>
            Sign out
          </button>
        )}
      </div>
      {!snapshot.fan && <p className="small">A passkey creates the account. No wallet is required to play.</p>}
      {!links && <dl className="facts">
        <Fact label="Twitch">
          Not linked. <Tag kind="soon">Not available yet</Tag>
        </Fact>
        <Fact label="Wallet">
          {wallet ?? "Not connected."} <a href="#/positions">Locker</a>
        </Fact>
      </dl>}
      {links && <div className="account-links"><p className="label">Linked identities</p>{links}</div>}
      {snapshot.fan && <p className="small"><a href="#/play">Play</a> · <a href="#/positions">Locker</a></p>}
      <div className="account-access">
        {!snapshot.fan && <p className="small">By creating an account you confirm you are 18 or older and agree to the <a href="/terms">Terms</a>. Read how we use your information in the <a href="/privacy">Privacy Policy</a>.</p>}
        {!snapshot.fan && onAccount && (
          <div className="actions">
            <button className="btn btn--primary" type="button" onClick={() => void onAccount("register")}>
              Create account with a passkey
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => void onAccount("login")}>
              Sign in with a passkey
            </button>
          </div>
        )}
      </div>
      {tasks}
    </section>
  );
}

export function Profile({ snapshot, load, backer, wallet, onRetry, onAccount, onSignOut, links, tasks, market = null, now = Date.now() }: { snapshot: HubSnapshot | null; load: "loading" | "error" | "ready"; backer: boolean; wallet: string | null; onRetry: () => void; onAccount?: AccountAction; onSignOut?: () => Promise<void>; links?: ReactNode; tasks?: ReactNode; market?: Market | null; now?: number }) {
  const liveBacker = useBacker(wallet, snapshot?.scenario === "today" && load === "ready");
  const head = <PageHead title="Profile" lede="Your account, Twitch, wallet, and ICELAN recorded from those tasks." />;
  if (load === "loading") return <>{head}<Skeleton kinds={["block", "block"]} /></>;
  if (load === "error" || !snapshot) return <>{head}<ErrorBlock text="Your profile didn't load. Your history is unchanged." onRetry={onRetry} /></>;
  if (!snapshot.fan) {
    return (
      <>
        {head}
        <AccountPanel snapshot={snapshot} wallet={wallet} onAccount={onAccount} onSignOut={onSignOut} links={links} tasks={tasks} />
        <div style={{ marginTop: 16 }}>
          <EmptyBlock icon="star" title="No history yet" text="Your history starts when you join a season. Badges and receipts stay when points reset." />
        </div>
      </>
    );
  }
  const last = snapshot.history[0];
  const collector: CollectorRecord = snapshot.fan.badges ? snapshot.fan : snapshot.season?.me ?? {};
  return (
    <>
      {head}
      <div className="me-grid">
        <AccountPanel snapshot={snapshot} wallet={wallet} onAccount={onAccount} onSignOut={onSignOut} links={links} tasks={tasks} />
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
        <SupportStatus market={market} now={now} />
        <section className="panel" aria-labelledby="h-badges">
          <div className="panel__head">
            <h2 className="label" id="h-badges">
              Badges
            </h2>
            {snapshot.scenario === "sample" && <SampleTag />}
          </div>
          <p className="small" style={{ marginBottom: 14 }}>
            Marks from credited site play. They stay when season points reset.
          </p>
          <EarnedBadges record={collector} backer={snapshot.scenario === "sample" ? backer : liveBacker} sample={snapshot.scenario === "sample"} />
          {snapshot.scenario === "today" && !collector.badges?.includes("three_days") && <p className="small">Three days played (locked) · {collector.activityDays ?? 0} of 3 days with credited site play.</p>}
        </section>
        <section className="panel" aria-labelledby="h-history">
          <div className="panel__head">
            <h2 className="label" id="h-history">
              Record
            </h2>
            {snapshot.scenario === "sample" && <SampleTag />}
          </div>
          {snapshot.history.length === 0 ? (
            <p className="small">No finished seasons yet.</p>
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
          {snapshot.history.filter((r) => "anchorTx" in r.reward).map((r) => (
            <div key={r.season} className="receipt">
              <Icon name="receipt" />
              <div>
                <p>Season {r.season} receipt</p>
                <p className="small">Signed at close and recorded in the public ledger.</p>
              </div>
            </div>
          ))}
          {!snapshot.history.some((r) => "anchorTx" in r.reward) && <p className="small">No anchored receipts yet.</p>}
        </section>
      </div>
    </>
  );
}
