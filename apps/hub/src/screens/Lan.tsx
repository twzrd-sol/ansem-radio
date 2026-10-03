// Radio LAN: the station, its founder, and how a free season works. The featured listing on the Board links here.
import type { Station } from "../data/station";
import type { HubSnapshot } from "../data/types";
import { fmt } from "../lib/format";
import { ErrorBlock, Icon, LanMark, SampleTag, Skeleton, StationPill } from "../ui/atoms";
import { HowLink } from "../ui/HowItWorks";

const LoopStep = ({ when, word, text }: { when: string; word: string; text: string }) => (
  <li>
    <span className="loop__when">{when}</span>
    <span className="loop__word">{word}</span>
    <span className="loop__text">{text}</span>
  </li>
);

export function Lan({ snapshot, load, onRetry, station }: { snapshot: HubSnapshot | null; load: "loading" | "error" | "ready"; onRetry: () => void; station: Station }) {
  if (load === "loading") return <Skeleton kinds={["title", "block", "line"]} />;
  if (load === "error" || !snapshot) return <ErrorBlock text="This page didn't load. Nothing was changed." onRetry={onRetry} />;
  const season = snapshot.season;
  return (
    <>
      <section className="hero">
        <div className="lan__brand">
          <LanMark className="lan__mark" />
          <StationPill station={station} />
        </div>
        <p className="eyebrow">Founded by THE WZRD OF ZO</p>
        <h1 className="h1" tabIndex={-1}>
          Radio LAN
        </h1>
        <p className="lede">A station for streamer culture. Follow who's live, play each season, and back creators with RLAN. THE WZRD OF ZO founded Radio LAN.</p>
        <div className="hero__actions">
          <a className="btn btn--primary" href="#/s/radiolanlive">
            <Icon name="stream" />
            Open the Radio LAN listing
          </a>
          <a className="btn btn--ghost" href="#/">
            <Icon name="board" />
            The Board
          </a>
          <a className="btn btn--ghost" href="/stream">Macro view</a>
        </div>
        {season ? (
          <p className="counter">
            <span className="counter__dot" aria-hidden="true" />
            <span className="num">{fmt(season.players)}</span>players this season
            <SampleTag />
          </p>
        ) : (
          <p className="counter">The player count appears when the first season opens.</p>
        )}
      </section>
      <section className="section" aria-labelledby="h-loop">
        <div className="section__head">
          <h2 className="h2" id="h-loop">
            How a season works
          </h2>
        </div>
        <ol className="loop">
          <LoopStep when="Season start" word="Open" text="Each points season has a published opening time, and everyone starts at 0 points." />
          <LoopStep when="While it runs" word="Play" text="Do activities on this site. Each has a published point value, with caps per day and per season." />
          <LoopStep when="Close" word="Freeze" text="Points freeze. Once a final board is anchored on Solana, anyone can check it." />
          <LoopStep when="After close" word="Split" text="If the season is funded, your part of its perks follows your points over everyone's. The perks are only what was funded before the season opened." />
          <LoopStep when="Next season" word="Reset" text="Points go back to 0; badges and history stay." />
        </ol>
        <p className="note aside-note">
          <Icon name="info" />
          Backing adds no points. <HowLink />
        </p>
      </section>
    </>
  );
}
