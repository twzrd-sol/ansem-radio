// One creator: the channel panel (Twitch, display only) and the backing panel (on chain, owned), as two panels that
// never merge. The featured listing also carries the stream and the free season card, kept visibly separate.
import { seasonIndex, withdrawAvailableAt } from "../chain/season";
import { sparkline, type Listing as ListingData } from "../data/market";
import type { Station } from "../data/station";
import type { HubSnapshot } from "../data/types";
import { duration, fmt, units, utc } from "../lib/format";
import { EmptyBlock, ErrorBlock, Fact, Icon, PageHead, SampleTag, Skeleton, Stat, Tag } from "../ui/atoms";
import { Player } from "../ui/Player";
import { FollowButton } from "../ui/FollowButton";
import { HowLink } from "../ui/HowItWorks";
import { SeasonCard, SeasonNotOpen } from "../ui/SeasonCard";
import { TOKEN_DECIMALS } from "../chain/config";
import { ago, ObservedLine } from "./Market";

export function ChannelPanel({ l, station, sample }: { l: ListingData; station: Station; sample?: boolean }) {
  const p = l.performance;
  return (
    <section className="panel" aria-labelledby="h-channel">
      <div className="panel__head">
        <h2 className="h3" id="h-channel">
          Channel
        </h2>
        <span className="label">Data: Twitch</span>
        {sample && <SampleTag />}
      </div>
      {!p ? (
        <p className="small">No Twitch read for {l.twitch} yet.</p>
      ) : (
        <>
          <div className="stats">
            <Stat label="Now" value={p.live ? "Live" : "Offline"} word />
            <Stat label="Viewers" value={p.live && p.viewers !== null ? fmt(p.viewers) : "—"} note={p.live && p.deltaViewers !== null ? `${p.deltaViewers >= 0 ? "+" : ""}${fmt(p.deltaViewers)} since last read` : undefined} />
            <Stat label="Playing" value={p.live && p.game ? p.game : "—"} word />
          </div>
          <p className="small fine">{p.provenance}</p>
        </>
      )}
    </section>
  );
}

export function BackingPanel({ l, now, sample }: { l: ListingData; now: number; sample?: boolean }) {
  const a = l.arena;
  const nowSeconds = BigInt(Math.floor(now / 1000));
  const spark = (() => {
    const h = l.history ?? [];
    const points = sparkline(h);
    if (!points || h.length < 2) return null;
    const totals = h.map((x) => BigInt(x.total));
    const low = totals.reduce((m, v) => (v < m ? v : m));
    const high = totals.reduce((m, v) => (v > m ? v : m));
    const first = Date.parse(h[0]!.at);
    const days = Math.max(1, Math.round((now - first) / 86_400_000));
    return { points, low: units(low, TOKEN_DECIMALS), high: units(high, TOKEN_DECIMALS), from: ago(now - first), span: days === 1 ? "day" : `${days} days` };
  })();
  return (
    <section className="panel" aria-labelledby="h-backing">
      <div className="panel__head">
        <h2 className="h3" id="h-backing">
          Backing
        </h2>
        <span className="label">On chain</span>
        {sample && <SampleTag />}
      </div>
      {!a ? (
        <>
          <p className="small">
            {l.kind === "featured"
              ? "The official arena has not been created on devnet yet. It appears here the moment the official streamer key creates it."
              : "Not listed for backing yet. A creator is backable only after they create their own arena with their own key; nothing here is created on anyone's behalf."}
          </p>
          {l.kind === "featured" && l.keys && (
            <div className="actions">
              <a className="btn" href={`#/back/${l.slug}`}>
                <Icon name="wallet" />
                Streamer: create the devnet arena
              </a>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="stats">
            <Stat label="Backed, RLAN" value={<span className="num">{units(BigInt(a.total), TOKEN_DECIMALS)}</span>} note={a.netFlow === null ? undefined : `${BigInt(a.netFlow) >= 0n ? "+" : "−"}${units(BigInt(a.netFlow) < 0n ? -BigInt(a.netFlow) : BigInt(a.netFlow), TOKEN_DECIMALS)} this season`} />
            <Stat label="Backers" value={fmt(Number(a.backers))} note="Wallets, not people" />
            <Stat label="Leaving" value={fmt(a.requested)} note="Withdrawal requests" />
          </div>
          {spark && (
            <figure className="spark" aria-label={`Total backed over the last ${spark.span}: low ${spark.low}, high ${spark.high} RLAN`}>
              <div className="spark__plot">
                <span className="spark__y" aria-hidden="true">
                  <span>{spark.high}</span>
                  <span>{spark.low}</span>
                </span>
                <svg viewBox="0 0 200 48" preserveAspectRatio="none" role="img" aria-hidden="true">
                  <line x1="0" y1="46" x2="200" y2="46" className="spark__base" />
                  <polyline points={spark.points} fill="none" />
                </svg>
              </div>
              <figcaption className="spark__x small">
                <span>{spark.from}</span>
                <span>now</span>
              </figcaption>
            </figure>
          )}
          <dl className="facts">
            <Fact label="Season">
              On-chain season {a.season} · {duration(Number(a.seasonSeconds))} each
              {!a.closed && ` · next release ${utc(Number(withdrawAvailableAt(BigInt(a.seasonStart), BigInt(a.seasonSeconds), seasonIndex(BigInt(a.seasonStart), BigInt(a.seasonSeconds), nowSeconds))) * 1000)}`}
            </Fact>
            <Fact label="Rule">Request withdrawal anytime; it is available when the on-chain season you asked in ends. Depositing again cancels a pending request. {a.closed ? "This arena is closed: every position is available now." : "If the arena closes, every position unlocks at once."}</Fact>
          </dl>
          <div className="actions">
            {a.closed ? (
              <a className="btn" href={`#/back/${l.slug}`}>
                Withdraw
              </a>
            ) : (
              <a className="btn btn--primary" href={`#/back/${l.slug}`}>
                <Icon name="heart" />
                Back {l.name}
              </a>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function Listing({ listing, observed, load, onRetry, station, now, snapshot, onJoin, slug }: {
  listing: ListingData | null;
  observed: { network: string; observedAt: string | null; slot: number | null; stale: boolean; sample?: boolean } | null;
  load: "loading" | "error" | "ready";
  onRetry: () => void;
  station: Station;
  now: number;
  /** The points season (free, separate), shown on the featured listing only. */
  snapshot: HubSnapshot | null;
  onJoin: () => void;
  slug: string;
}) {
  const crumb = (
    <a className="crumb" href="#/">
      <Icon name="chev" size="sm" />
      The Board
    </a>
  );
  if (load === "loading") return <><PageHead title={slug} before={crumb} /><Skeleton kinds={["block", "block"]} /></>;
  if (load === "error") return <><PageHead title={slug} before={crumb} /><ErrorBlock text="This listing didn't load. Nothing on chain changed." onRetry={onRetry} /></>;
  if (!listing || !observed) {
    return (
      <EmptyBlock icon="stream" title="No listing here" text="Only creators on the board have a page.">
        <a className="btn" href="#/">
          The Board
        </a>
      </EmptyBlock>
    );
  }
  const featured = listing.kind === "featured";
  const season = snapshot?.season ?? null;
  return (
    <>
      <PageHead
        before={crumb}
        eyebrow={featured ? "Featured · founded by THE WZRD OF ZO" : listing.demo ? "Demo listing · fictional" : "Listed creator"}
        title={listing.name}
        lede={
          <>
            {listing.blurb ?? (listing.twitch ? `twitch.tv/${listing.twitch}` : "")}
            {listing.demo && <Tag kind="sample">Demo</Tag>}
          </>
        }
      />
      {featured && <Player channel={listing.twitch ?? "radiolanlive"} station={station} />}
      <div className="actions"><FollowButton slug={listing.slug} name={listing.name} /><HowLink /></div>
      <ObservedLine data={observed} sample={observed.sample} now={now} onRefresh={onRetry} />
      <div className={listing.twitch ? "two" : "two two--one"}>
        <BackingPanel l={listing} now={now} sample={observed.sample} />
        {listing.twitch && <ChannelPanel l={listing} station={station} sample={observed.sample} />}
      </div>
      {featured && (
        <section className="section" aria-labelledby="h-free-season">
          <div className="section__head">
            <h2 className="h2" id="h-free-season">
              Season · points
            </h2>
            <span className="label">Free · separate from backing</span>
          </div>
          {season ? <SeasonCard season={season} now={now} onJoin={onJoin} /> : <SeasonNotOpen />}
          <p className="small fine">Points come from activities on this site and never from backing or Twitch. {season && <a href="#/board">See the points board</a>}{season && " · "}<a href="#/play">Play</a></p>
        </section>
      )}
      <p className="small fine">
        {featured && listing.twitch && (
          <a className="ext" href={`https://www.twitch.tv/${listing.twitch}`} target="_blank" rel="noopener noreferrer">
            Watch on Twitch
          </a>
        )}
        {featured && listing.twitch && " · "}
        <a href="#/positions">My positions</a>
        {featured && " · "}
        {featured && <a href="#/lan">About Radio LAN</a>}
      </p>
    </>
  );
}
