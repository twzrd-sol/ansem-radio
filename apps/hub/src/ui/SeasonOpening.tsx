import { seasonCalendar } from "../data/season";
import type { CurrentSeason } from "../data/types";
import { left, utc } from "../lib/format";
import { Icon } from "./atoms";

export function OpeningTime({ at }: { at: number }) {
  const local = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(at);
  return <span className="opening-time"><time dateTime={new Date(at).toISOString()}>Opens {local} your time</time><span className="small block">{utc(at)}</span></span>;
}

export function SeasonOpening({ season, now }: { season: CurrentSeason; now: number }) {
  return <section className="season-opening" aria-label={`Season ${season.number} opening`}>
    <Icon name="clock" />
    <div><p className="h3">Season {season.number}</p><OpeningTime at={season.opensAt} /><p className="small">Starts in {left(season.opensAt - now)} · Free to play</p></div>
    <a className="btn" href={seasonCalendar(season)} download={`radio-lan-season-${season.number}.ics`}>Add to calendar</a>
  </section>;
}
