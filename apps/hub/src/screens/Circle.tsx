import { circleBySlug, creatorCircles, emptyCircleCopy, type CreatorCircle } from "../data/circle";
import type { Listing } from "../data/market";
import { pointsSeasonEyebrow } from "../data/season";
import type { HubSnapshot } from "../data/types";
import { SuperfanList } from "../ui/Competition";
import { EmptyBlock, ErrorBlock, PageHead, SampleTag, Skeleton } from "../ui/atoms";

export function Circle({ snapshot, load, listings, followed, selected = "", onRetry }: {
  snapshot: HubSnapshot | null;
  load: "loading" | "error" | "ready";
  listings: readonly Listing[];
  followed: readonly string[];
  selected?: string;
  onRetry: () => void;
}) {
  const season = snapshot?.season ?? null;
  const head = (
    <PageHead
      eyebrow={season ? pointsSeasonEyebrow(season) : "Radio LAN"}
      title="Superfans"
      lede="Other fans of the same creators, ranked by this season's site play. Following adds no points. Season points are not RLAN and not ICELAN."
    />
  );
  if (load === "loading") return <>{head}<Skeleton kinds={["line", "line", "line", "line"]} /></>;
  if (load === "error" || !snapshot) return <>{head}<ErrorBlock text="The circle didn't load. Scores are unchanged." onRetry={onRetry} /></>;
  const circles = creatorCircles(snapshot, listings, followed);
  const active = circleBySlug(circles, selected);
  const empty = emptyCircleCopy(active, Boolean(season));
  return (
    <>
      {head}
      {snapshot.scenario === "sample" && (
        <p className="small">
          <SampleTag /> Fictional handles and creator circles for preview. Return to today for the live board.
        </p>
      )}
      {circles.length > 1 && (
        <div className="seg" role="group" aria-label="Creator circle">
          {circles.map((circle) => (
            <a key={circle.slug} href={`#/circle/${circle.slug}`} aria-current={active?.slug === circle.slug ? "page" : undefined}>
              {circle.name}
              {circle.source === "sample-affinity" && <SampleTag />}
            </a>
          ))}
        </div>
      )}
      <CircleBody circle={active} empty={empty} sample={snapshot.scenario === "sample"} />
    </>
  );
}

function CircleBody({ circle, empty, sample }: { circle: CreatorCircle | null; empty: { title: string; text: string }; sample: boolean }) {
  if (!circle || circle.fans.length === 0) {
    return (
      <EmptyBlock icon="me" title={empty.title} text={empty.text}>
        <a className="btn" href="#/play">Play a challenge</a>
        <a className="btn" href="#/">Discover creators</a>
      </EmptyBlock>
    );
  }
  return (
    <div className="board-wrap">
      <div className="board-head">
        <span className="label">{circle.fans.length} superfans of {circle.name} · provisional points so far</span>
        {(sample || circle.fictional) && <SampleTag />}
      </div>
      {circle.source === "sample-affinity" && (
        <p className="small"><SampleTag /> Fictional fans of a fictional creator. Not a live circle.</p>
      )}
      {circle.source === "season-board" && (
        <p className="small">These fans are playing the same Radio LAN season. Follow the same creators on Discover to keep them on your list.</p>
      )}
      <SuperfanList fans={circle.fans} />
      <p className="small fine">
        Points come from the published poll, question, and accepted work. Badges are kept marks, not tokens.
        {sample && <> <SampleTag /> Made-up circle for preview.</>}
      </p>
    </div>
  );
}
