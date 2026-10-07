import type { CollectorRecord, HubSnapshot, PlayBadge } from "../data/types";
import { nextSeasonAction, seasonPhase } from "../data/season";
import { fmt } from "../lib/format";
import { Icon, type IconName, SampleTag } from "./atoms";

const badges: Record<PlayBadge, { name: string; icon: IconName; detail: string }> = {
  first_play: { name: "First play", icon: "play", detail: "Your first credited site activity" },
  three_days: { name: "Three days played", icon: "star", detail: "Credited site activity on three distinct UTC days" },
};

/** The real collector row contains earned marks only. Locked goals are presented separately. */
export function EarnedBadges({ record, backer = false, sample = false, compact = false }: { record: CollectorRecord; backer?: boolean; sample?: boolean; compact?: boolean }) {
  const earned = (record.badges ?? []).filter((id) => id in badges);
  return <>
    <ul className="collector-row" aria-label="Earned badges">
      {earned.map((id) => <li className="collector-mark" key={id} title={badges[id].detail}><Icon name={badges[id].icon} /><span>{badges[id].name}</span></li>)}
      {backer && <li className="collector-mark collector-mark--backer"><Icon name="heart" /><span>Backer</span></li>}
    </ul>
    {!compact && earned.length === 0 && !backer && <p className="small">No earned badges yet. Your first credited site activity lights First play.</p>}
    {sample && <div className="collector-demo"><p className="small"><SampleTag /> Fictional collector designs</p><ul className="collector-row">{([['First poll', 'poll'], ['Question asked', 'question'], ['3-day streak', 'clock'], ['5-day streak', 'clock'], ['Accepted work', 'receipt']] as Array<[string, IconName]>).map(([name, icon]) => <li className="collector-mark" key={name}><Icon name={icon} /><span>{name}</span></li>)}</ul></div>}
  </>;
}

export function nextBadge(record: CollectorRecord): string | null {
  if (!record.badges?.includes("first_play")) return "First play";
  if (!record.badges.includes("three_days") && record.activityDays === 2 && record.playedToday === false) return "Three days played";
  return null;
}

export function SeasonStanding({ snapshot, now }: { snapshot: HubSnapshot; now: number }) {
  const season = snapshot.season;
  if (!season) return <aside className="room-standing"><p className="label">LAN · AI DJ and broadcast console</p><p>The next season appears when its schedule is published.</p><a href="#/positions">Your locker</a></aside>;
  const me = season.me;
  const record = snapshot.fan?.badges ? snapshot.fan : me ?? {};
  const phase = seasonPhase(season, now);
  return <aside className="room-standing" aria-label="Your season standing">
    <div className="room-standing__head"><p className="label">LAN · AI DJ and broadcast console</p>{snapshot.scenario === "sample" && <SampleTag />}</div>
    <h2 className="h3">Season {season.number}{season.number === 2 ? " · Devnet" : ""} · {phase}</h2>
    {me ? <><div className="room-standing__stats"><span><strong>{fmt(me.points)}</strong> points</span><span><strong>{me.rank === null ? "Unranked" : `#${me.rank}`}</strong> on the board</span></div><p className="small">Today: {fmt(me.today)} of {fmt(season.policy.dailyCap)} points · season: {fmt(me.points)} of {fmt(season.policy.weeklyCap)}</p><EarnedBadges record={record} /></> : <p className="small">{snapshot.fan ? "Your collector record stays with your account." : "Sign in with a passkey to start your collector record."}</p>}
    <p className="room-next"><span className="label">Next action</span>{nextSeasonAction(season, now)}</p>
    <div className="room-standing__links"><a href="#/play">Play free</a><a href="#/board">Points board</a><a href="#/circle">Meet superfans</a><a href="#/me">Collector profile</a><a href="#/positions">Your locker</a></div>
    <p className="small fine">Backing adds no points. Badges are collected marks, not tokens.</p>
  </aside>;
}
