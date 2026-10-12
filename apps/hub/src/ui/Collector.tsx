import type { CollectorRecord, HubSnapshot, PlayBadge } from "../data/types";
import { nextSeasonAction, pointsSeasonNetworkLine, seasonPhase } from "../data/season";
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
  if (!season) return <aside className="room-standing"><p className="label">Your season</p><p>The next season appears when its schedule is published.</p><a href="#/positions">My positions</a></aside>;
  const me = season.me;
  const record = snapshot.fan?.badges ? snapshot.fan : me ?? {};
  const phase = seasonPhase(season, now);
  const phaseLabel = phase === "open" ? "Open" : phase === "upcoming" ? "Upcoming" : "Closed";
  const networkLine = pointsSeasonNetworkLine(season);
  return <aside className="case room-standing" aria-label="Your season standing">
    <div className="room-standing__head"><p className="label">Your season</p>{snapshot.scenario === "sample" && <SampleTag />}</div>
    <h2 className="h3">Season {season.number} · {phaseLabel}</h2>
    {me ? <><div className="crt room-standing__readout"><div className="room-standing__stats"><span><strong>{fmt(me.points)}</strong> points</span><span><strong>{me.rank === null ? "Unranked" : `#${me.rank}`}</strong> on the board</span></div><p className="small">Today: {fmt(me.today)} of {fmt(season.policy.dailyCap)} points · season: {fmt(me.points)} of {fmt(season.policy.weeklyCap)}</p></div><EarnedBadges record={record} /></> : <p className="small">{snapshot.fan ? "Your points and badges stay with your account." : <><a href="#/me">Sign in with a passkey</a> to keep your points and badges. Watching and chat need no sign-in.</>}</p>}
    <p className="room-next"><span className="label">Next step</span>{nextSeasonAction(season, now)}</p>
    <div className="room-standing__links"><a href="#/play">Play free</a><a href="#/board">Points board</a><a href="#/circle">Superfans</a><a href="#/me">Profile</a><a href="#/positions">My positions</a></div>
    <p className="small fine"><span>An active RLAN position on your linked wallet gives eligible Play credits 2× weight, within caps. Badges are marks on your profile, not tokens.</span>{networkLine && <span className="room-standing__net">{networkLine}</span>}</p>
  </aside>;
}
