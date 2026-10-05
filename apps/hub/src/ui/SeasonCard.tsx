import { IS_MAINNET } from "../chain/config";
import type { CurrentSeason, RewardState } from "../data/types";
import { seasonPhase } from "../data/season";
import { showsMoney } from "../data/types";
import { fmt, left, units } from "../lib/format";
import { Icon, SampleTag, Stat, Vu } from "./atoms";
import { SeasonOpening } from "./SeasonOpening";

/** The most points one fan can hold this season: the published season cap. */
export const seasonMax = (season: CurrentSeason) => season.policy.weeklyCap;

/** The pool cell follows plan section 4: money only once the pool is funded and checked on chain. */
export function poolStat(reward: RewardState) {
  if (showsMoney(reward)) return <Stat label="Perks" value={`${units(reward.pool.baseUnits, reward.pool.decimals)} ${reward.pool.asset}`} note="Funded, checked on chain" />;
  return <Stat label="Perks" value="Not funded" note="Shown once funded and checked on chain" word />;
}

export const rewardLabel: Record<RewardState["kind"], string> = {
  provisional: "Your points so far",
  finalized: "Final points",
  anchored: "Final points, anchored",
  funded: "Final points, perks funded",
  claimable: "Final points, ready to collect",
};

export function SeasonCard({ season, now, onJoin, backingOpen = false }: { season: CurrentSeason; now: number; onJoin: () => void; backingOpen?: boolean }) {
  const phase = seasonPhase(season, now);
  const open = phase === "open";
  const max = seasonMax(season);
  const me = season.me;
  return (
    <section className="case" aria-labelledby="h-season">
      <div className="season__head">
        <h2 className="h3" id="h-season">
          Season {season.number}
        </h2>
        <SampleTag />
        <span className={open ? "phase phase--open" : "phase phase--closed"}>{open ? "Open" : phase === "upcoming" ? "Upcoming" : "Closed"}</span>
        <span className="season__clock">
          <Icon name="clock" size="sm" />
          {open ? `Points freeze in ${left(season.freezesAt - now)}` : phase === "upcoming" ? `Starts in ${left(season.opensAt - now)}` : "Points are frozen"}
        </span>
      </div>
      {season.poll?.placeholder && <p className="small">Sample season. Today's poll is a placeholder and does not count for points.</p>}
      {phase === "upcoming" ? <SeasonOpening season={season} now={now} /> : me ? (
        <div className="crt">
          <div className="crt__row">
            <div>
              <p className="crt__label">{rewardLabel[season.reward.kind]}</p>
              <p className="crt__value">{fmt(me.points)}</p>
            </div>
            <div className="crt__rank">
              <p className="crt__label">Rank</p>
              <p className="crt__value crt__value--sm">{me.rank === null ? "—" : `#${me.rank}`}</p>
              <p className="crt__sub">{me.rank === null ? "board not published" : `of ${fmt(season.players)}`}</p>
            </div>
          </div>
          <Vu value={me.points} max={max} />
          <p className="crt__sub">
            {fmt(me.points)} of {fmt(max)} possible this season · {fmt(me.today)} today of {fmt(season.policy.dailyCap)}
          </p>
        </div>
      ) : (
        <div className="crt">
          <p className="crt__label">Free to play</p>
          <p className="crt__value crt__value--idle">Join this season</p>
          <p className="crt__sub">No wallet needed. Points start at 0 every season.</p>
          <button className="btn btn--primary" type="button" disabled={!open} onClick={onJoin}>
            Join free
          </button>
        </div>
      )}
      <div className="stats">
        {poolStat(season.reward)}
        <Stat label="Players" value={fmt(season.players)} note="This season" />
        <Stat label="Backers" value={fmt(season.backers)} note="Optional" />
      </div>
      <div className="season__actions">
        <a className="btn btn--primary" href="#/play">
          <Icon name="play" />
          Play activities
        </a>
        {backingOpen && <a className="btn" href="#/back">
          <Icon name="heart" />
          Back the streamer
        </a>}
      </div>
    </section>
  );
}

export function SeasonNotOpen({ backingOpen = false }: { backingOpen?: boolean } = {}) {
  return (
    <section className="case" aria-labelledby="h-season">
      <div className="season__head">
        <h2 className="h3" id="h-season">
          Season
        </h2>
        <span className="phase phase--off">Not open</span>
      </div>
      <div className="crt">
        <p className="crt__label">First season</p>
        <p className="crt__value crt__value--idle">Not open yet</p>
        <p className="crt__sub">Free to play when it opens. No wallet needed to play.</p>
      </div>
      <div className="stats">
        <Stat label="Perks" value="Not funded" note="An unfunded season has no perks" word />
        <Stat label="Players" value="0" note="This season" />
        <Stat label="Backing" value={IS_MAINNET ? (backingOpen ? "Open" : "Not open") : "Devnet test"} note={IS_MAINNET ? (backingOpen ? "Your own support account, on mainnet" : "No mainnet arena is open") : "Program on mainnet; this build rehearses on devnet"} word />
      </div>
    </section>
  );
}
