import { freshRead, type Station } from "../data/station";
import type { Market } from "../data/market";
import { fmt } from "../lib/format";

function Creator({ login, market }: { login: string; market: Market | null }) {
  const listing = market?.listings.find((l) => l.twitch === login);
  return listing ? <a href={`#/s/${encodeURIComponent(listing.slug)}`}>{listing.name}</a> : <a href={`https://www.twitch.tv/${login}`} target="_blank" rel="noopener noreferrer">{login}</a>;
}

/** A deterministic brief over source observations. It adds no provider inference or reward rule. */
export function StationBrief({ station, market, now, sample = false }: { station: Station; market: Market | null; now: number; sample?: boolean }) {
  const pulse = sample ? undefined : station.pulse;
  const current = pulse && freshRead(pulse.generatedAt, now) ? pulse : null;
  const board = current?.board && freshRead(current.board.at, now) ? current.board : null;
  const history = current?.history;
  const first = board?.live[0];
  return <div className="station-brief">
    {sample ? <p>The station brief uses current reads outside this preview.</p> : <>
      <p>{!board ? "I'm waiting for a fresh read of the tracked creators." : board.live.length === 0 ? `None of the ${current?.trackedTotal ? `${current.trackedTotal} ` : ""}tracked creators are live in the latest read.` : <>{board.live.length} tracked {board.live.length === 1 ? "creator is" : "creators are"} live. {first && <><Creator login={first.login} market={market} />{first.viewers === null ? " is live." : <> has the largest recorded audience, {fmt(first.viewers)} viewers.</>}</>}</>}</p>
      {history && (history.leader ? <p>Across recorded minutes in the last 6 hours, <Creator login={history.leader.login} market={market} /> led viewer-minutes, with {fmt(history.leader.minutesLive)} minutes live.</p> : <p>{history.recordedMinutes === 0 ? "No history is recorded for this six-hour window yet." : "No creator activity is recorded in this six-hour window."}</p>)}
      {history && history.coverage < 1 && <p className="small">The history has gaps. This brief describes recorded minutes.</p>}
      <p className="small">Data: Twitch{board && <> · Live read <time dateTime={new Date(board.at).toISOString()}>{new Date(board.at).toISOString().slice(11, 16)} UTC</time></>}{history && <> · History through <time dateTime={new Date(history.to).toISOString()}>{new Date(history.to).toISOString().slice(11, 16)} UTC</time></>}</p>
    </>}
    <div className="lan-guide__links"><a href="#/play">Play this season</a></div>
  </div>;
}
