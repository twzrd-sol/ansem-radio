import type { Station } from "../data/station";
import type { Market } from "../data/market";

/** A deterministic brief over source observations. It adds no provider inference or reward rule. */
export function StationBrief(props: { station: Station; market: Market | null; now: number; sample?: boolean }) {
  const { station, sample = false } = props;
  return <div className="station-brief">
    {sample ? <p>The channel brief uses current reads outside this preview.</p> : <>
      <p>{station.status === "ready" ? `Twitch lists this channel as ${station.live ? "live" : "offline"}.` : "The channel status is not available right now."}</p>
      <p className="small">Data: Twitch</p>
    </>}
    <div className="lan-guide__links"><a href="#/play">Play this season</a></div>
  </div>;
}
