import { useState } from "react";
import { IS_MAINNET, RLAN_MINT } from "../chain/config";
import { useFollowing } from "../data/following";
import { collectionSummary } from "../data/collection";
import { followingListings, type Market } from "../data/market";
import { isPlaceholderSeason, seasonPhase } from "../data/season";
import type { HubSnapshot } from "../data/types";
import type { Station } from "../data/station";
import { short } from "../lib/format";
import { Icon, LanMark, SampleTag } from "./atoms";
import { HowLink, PUBLIC_SOURCE } from "./HowItWorks";
import { OpeningTime } from "./SeasonOpening";
import { StationBrief } from "./StationBrief";

type Topic = "pulse" | "now" | "play" | "rlan" | "collect";
export function LanCompanion({ market, snapshot, now, ready, station = { status: "unknown" } }: { market: Market | null; snapshot: HubSnapshot | null; now: number; ready: boolean; station?: Station }) {
  const [topic, setTopic] = useState<Topic>("pulse");
  const { slugs } = useFollowing();
  const live = ready && market && !market.stale ? followingListings(market.listings, slugs).filter((l) => l.performance?.live) : [];
  const season = snapshot?.season;
  const sampleSeason = isPlaceholderSeason(season);
  const record = collectionSummary(snapshot, now);
  return <aside className="lan-guide" aria-label="LAN station guide">
    <div className="lan-guide__head"><LanMark className="lan-guide__mark" /><div><p className="label">LAN · AI station guide</p><p className="small">Radio LAN, wherever you go</p></div>{(market?.sample || snapshot?.scenario === "sample" || sampleSeason) && <SampleTag />}</div>
    <div className="lan-guide__topics" role="group" aria-label="Ask LAN">
      {([["pulse", "Station brief"], ["now", "Who's on"], ["play", "What can I do"], ["rlan", "What's RLAN"], ["collect", "Can I collect"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={topic === key} onClick={() => setTopic(key)}>{label}</button>)}
    </div>
    <div className="lan-guide__body">
      {topic === "pulse" ? <StationBrief station={station} market={market} now={now} sample={market?.sample || snapshot?.scenario === "sample"} /> : topic === "now" ? <>
        <p>{!ready || market?.stale ? "I'm waiting for a fresh channel read." : live.length > 0 ? `${live.length} of your followed creators ${live.length === 1 ? "is" : "are"} live.` : slugs.length > 0 ? "No followed creator is live in the latest read." : "Follow creators to build your watchlist. I'll keep their live channels up front."}</p>
        <div className="lan-guide__links">{live.slice(0, 3).map((l) => <a key={l.slug} href={`#/s/${l.slug}`}><span className="live-dot" aria-hidden="true" />{l.name}</a>)}</div>
        <p className="small">Channel status · Data: Twitch</p>
      </> : topic === "play" ? <>
        <p>{!season ? "The next points season appears here when its schedule is published." : sampleSeason ? `Season ${season.number} is a sample season. Today's poll is a placeholder.` : seasonPhase(season, now) === "upcoming" ? `Season ${season.number} is up next.` : seasonPhase(season, now) === "closed" ? `Season ${season.number} is closed. Your points are frozen.` : snapshot?.fan ? `Season ${season.number} is open. ${season.me ? `You have ${season.me.points} points so far.` : "Join to start your points."}` : `Season ${season.number} is open. Join free and ask the room a question.`}</p>
        {season && seasonPhase(season, now) === "upcoming" && <OpeningTime at={season.opensAt} />}
        <div className="lan-guide__links"><a href="#/play">Play activities <Icon name="play" size="sm" /></a><a href="#/board">Points board</a></div>
      </> : topic === "collect" ? <>
        <p>{record.label}. {record.text}</p>
        <div className="lan-guide__links"><a href="#/claim">Season record <Icon name="receipt" size="sm" /></a><a href="#/board">Points board</a></div>
      </> : <>
        <p>RLAN is Radio LAN's mainnet token, launched through ClawPump. {IS_MAINNET ? "Backing on this hub uses it." : "This build rehearses creator backing with devnet test tokens."}</p>
        <div className="lan-guide__links"><a href="https://clawpump.tech" target="_blank" rel="noopener noreferrer">ClawPump</a><a href={`https://explorer.solana.com/address/${RLAN_MINT}?cluster=mainnet-beta`} target="_blank" rel="noopener noreferrer" title={RLAN_MINT}>RLAN mint {short(RLAN_MINT)}</a><a href={PUBLIC_SOURCE} target="_blank" rel="noopener noreferrer">MIT source</a></div>
      </>}
    </div>
    <div className="lan-guide__foot"><span>Play is free · Backing is optional</span><HowLink /></div>
  </aside>;
}
