import { pointsShare, recordFormatValid, rewardSummary } from "../data/collection";
import type { PastSeason } from "../data/types";
import { fmt } from "../lib/format";
import { Address, ErrorBlock, SampleTag, Stat } from "./atoms";

/** Displays an existing record. It builds no collection instruction and never treats inclusion as funding. */
export function SeasonRecord({ last, sample, onRetry }: { last: PastSeason; sample: boolean; onRetry: () => void }) {
  if (!recordFormatValid(last)) return <ErrorBlock text="Record unavailable. The season record has inconsistent fields." onRetry={onRetry} />;
  const reward = last.reward;
  const status = rewardSummary(reward);
  const funded = reward.kind === "funded" || reward.kind === "claimable";
  const share = funded && last.me ? pointsShare(last.me.points, last.eligiblePoints) : null;
  return <section className="case claim" aria-labelledby="h-season-record">
    <div className="season__head"><h2 className="h3" id="h-season-record">Season {last.number} record</h2>{sample && <SampleTag />}</div>
    <p className="season-record__status">{status.label}</p>
    <p className="small">{status.text}</p>
    <div className="stats">
      <Stat label="Your points" value={last.me ? fmt(last.me.points) : "—"} />
      <Stat label="Your rank" value={last.me ? `#${last.me.rank}` : "—"} />
      <Stat label="Players" value={fmt(last.players)} />
    </div>
    {funded && last.me && (share ? <div className="crt"><p className="crt__label">Your share</p><p className="crt__value crt__value--sm">{share}</p><p className="crt__sub">Set by your points: {fmt(last.me.points)} of {fmt(last.eligiblePoints)} eligible in season {last.number}.</p></div> : <p className="small">No eligible points are recorded for you in this season.</p>)}
    {"root" in reward && <div className="root">
      <p className="label">Board root</p><p className="mono root__hash">{reward.root}</p>
      <p className="small">Anchor transaction <Address id={reward.anchorTx} sample={sample} kind="tx" /></p>
    </div>}
    {funded && <><button className="btn btn--primary btn--block" type="button" disabled aria-describedby="claim-why">Collect · not available yet</button><p className="small" id="claim-why">A season-points collection instruction is not available. Your backing position is separate.</p></>}
    {!last.me && <p className="small"><a href="#/me">Sign in</a> to see your own season record.</p>}
  </section>;
}
