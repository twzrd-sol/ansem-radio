import type { ReactNode } from "react";
import type { HistoryRow, HubSnapshot } from "../data/types";
import { showsMoney } from "../data/types";
import { fmt } from "../lib/format";
import { EmptyBlock, ErrorBlock, Fact, Icon, PageHead, SampleTag, Skeleton, Stat, Tag } from "../ui/atoms";

/** A fan's share of a funded pool: pool x points / eligible points, rounded down. Shown as an amount only on a review. */
export const shareOf = (pool: bigint, points: number, eligiblePoints: number) => (eligiblePoints > 0 ? (pool * BigInt(points)) / BigInt(eligiblePoints) : 0n);

/** The share as a percentage of the season's perks, rounded down to two decimals. */
export const sharePercent = (points: number, eligiblePoints: number) => (eligiblePoints > 0 ? `${(Math.floor((points * 10_000) / eligiblePoints) / 100).toFixed(2)}%` : "0.00%");

function shareCell(r: HistoryRow): string {
  if (!showsMoney(r.reward)) return r.reward.kind === "anchored" || r.reward.kind === "finalized" ? "Not funded, nothing to share" : "Season still open";
  return `${sharePercent(r.points, r.eligiblePoints)} of the perks, collect later`;
}

export type AccountAction = (mode: "register" | "login") => Promise<void>;

function AccountPanel({ snapshot, wallet, onAccount, onSignOut, links }: { snapshot: HubSnapshot; wallet: string | null; onAccount?: AccountAction; onSignOut?: () => Promise<void>; links?: ReactNode }) {
  return (
    <section className="panel" aria-labelledby="h-account">
      <h2 className="label" id="h-account" style={{ marginBottom: 12 }}>
        Account
      </h2>
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
          {wallet ?? "Not connected. You only need one to back a creator or collect season perks."} <a href="#/positions">My positions</a>
        </Fact>
        {!links && <Fact label="Twitch">
          Not linked. Optional; linking never adds points. <Tag kind="soon">Not available yet</Tag>
        </Fact>}
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
  const head = <PageHead title="Profile" />;
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
  const earned = new Set(snapshot.season?.me?.badges ?? []);
  const badges: Array<[string, string, string, boolean]> = snapshot.scenario === "sample"
    ? [
        ["First poll", "P", "", true],
        ["Question asked", "?", "cream", true],
        ["3-day streak", "3", "lime", true],
        ["5-day streak", "5", "", false],
        ["Accepted work", "A", "", false],
        ["Backer", "B", "silver", backer],
      ]
    : [
        ["First play", "1", "lime", earned.has("first_play")],
        ["Three days played", "3", "cream", earned.has("three_days")],
        ["Backer", "B", "silver", backer],
      ];
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
            <span className="who__avatar" aria-hidden="true">
              {snapshot.fan.handle[0]?.toUpperCase()}
            </span>
            <div>
              <p className="h3">{snapshot.fan.handle}</p>
              <p className="small">Playing since Season {snapshot.fan.since}</p>
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
            Streaks count days you did an activity on this site. Badges stay when points reset.
          </p>
          <div className="stickers">
            {badges.map(([name, mark, color, earned]) => (
              <div key={name} className={["sticker", earned ? color && `sticker--${color}` : "sticker--locked"].filter(Boolean).join(" ")}>
                <span className="sticker__art" aria-hidden="true">
                  {mark}
                </span>
                <span className="sticker__name">{earned ? name : name === "Backer" ? "Backer (optional)" : `${name} (locked)`}</span>
              </div>
            ))}
          </div>
        </section>
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
          {snapshot.history.map((r) => (
            <div key={r.season} className="receipt">
              <Icon name="receipt" />
              <div>
                <p>Season {r.season} receipt</p>
                <p className="small">Signed with the board root. Anchored on Solana devnet.</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
