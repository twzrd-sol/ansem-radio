import { collectionSummary } from "../data/collection";
import { seasonPhase } from "../data/season";
import type { HubSnapshot } from "../data/types";
import { EmptyBlock, ErrorBlock, Icon, PageHead, Skeleton } from "../ui/atoms";
import { HowLink } from "../ui/HowItWorks";
import { OpeningTime } from "../ui/SeasonOpening";
import { SeasonRecord } from "../ui/SeasonRecord";

export function Claim({ snapshot, load, onRetry, now = Date.now() }: { snapshot: HubSnapshot | null; load: "loading" | "error" | "ready"; onRetry: () => void; now?: number }) {
  const head = <PageHead title="Collect" lede="Keep your season records. Funded perks follow eligible points." />;
  if (load === "loading") return <>{head}<Skeleton kinds={["block"]} /></>;
  if (load === "error" || !snapshot) return <>{head}<ErrorBlock text="Collect details didn't load. Nothing changed." onRetry={onRetry} /></>;
  const last = snapshot.lastSeason;
  const status = collectionSummary(snapshot, now);
  return <>
    {head}
    {last ? <SeasonRecord last={last} sample={snapshot.scenario === "sample"} onRetry={onRetry} /> : <EmptyBlock icon="receipt" title={status.label} text={status.text}>{snapshot.season && seasonPhase(snapshot.season, now) === "upcoming" && <OpeningTime at={snapshot.season.opensAt} />}</EmptyBlock>}
    <div className="actions claim" style={{ marginTop: 16 }}><a className="btn" href="#/board"><Icon name="board" />Points board</a><a className="btn btn--ghost" href="#/play">Play activities</a></div>
    <p className="small claim" style={{ marginTop: 16 }}>Backing adds no points and changes nobody's share. <HowLink /></p>
  </>;
}
