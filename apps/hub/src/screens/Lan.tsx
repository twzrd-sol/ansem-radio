// About radiolan.live: an open board of Twitch streamers and how a free season works. Not one streamer's page.
import type { Station } from "../data/station";
import type { HubSnapshot } from "../data/types";
import { BRAND } from "../brand";
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
        <p className="eyebrow">{BRAND.host}</p>
        <h1 className="h1" tabIndex={-1}>
          Radio LAN
        </h1>
        <p className="lede">{BRAND.tagline} Every streamer on Twitch can have a page here. A streamer who has not joined yet can sign in with Twitch later and make the page their own.</p>
        <div className="hero__actions">
          <a className="btn btn--primary" href="#/">
            <Icon name="board" />
            See who's live
          </a>
          <a className="btn btn--ghost" href="#/play">
            <Icon name="play" />
            Play this season
          </a>
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
