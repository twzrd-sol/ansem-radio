// The Board: every listed creator, with backing (on chain, the only owned metric) and Twitch figures (display only)
// side by side and never merged. The station's own channel is one listing among them.
import { useState } from "react";

import { TOKEN_DECIMALS } from "../chain/config";
import { followingListings, sortListings, type Listing, type Market as MarketData } from "../data/market";
import { useFollowing } from "../data/following";
import { categoryLanes, collection } from "../data/slate";
import type { Station } from "../data/station";
import { HUB_LEADERBOARD_ENABLED } from "../data/feature-flags";
import { BACKING_BOOST, FOLLOWING_LOCAL } from "../data/public-copy";
import { ago, fmt, tokenAmount, utc } from "../lib/format";
import { EmptyBlock, ErrorBlock, Icon, LanMark, SampleTag, Skeleton, StationPill, Tag } from "../ui/atoms";
import { BuyRlanBar } from "../ui/BuyRlanBar";
import { FollowButton } from "../ui/FollowButton";
import { HowLink } from "../ui/HowItWorks";
import { HubStory } from "../ui/HubStory";
import { CreatorAffinity } from "../ui/CreatorAffinity";

type Filter = "all" | "live" | "following";

export const rlan = (baseUnits: string) => {
  const shown = tokenAmount(BigInt(baseUnits), TOKEN_DECIMALS);
  return { label: `${shown.label} RLAN`, title: `${shown.title} RLAN` };
};

type LockerRead = Pick<MarketData, "observedAt" | "stale">;
export type LockerStatus = "open" | "closed" | "stale" | "unavailable";

/** Use the observed market index as the source of locker state; samples remain visibly marked fixtures. */
export function lockerStatus(listing: Listing, read: LockerRead | null): LockerStatus {
  if (!read?.observedAt || !Number.isFinite(Date.parse(read.observedAt))) return "unavailable";
  if (read.stale) return "stale";

  const arena = listing.arena;
  if (!arena) return listing.backingOpen ? "unavailable" : "closed";
  if (!listing.keys || arena.streamer !== listing.keys.streamer || arena.mint !== listing.keys.mint) return "unavailable";
  if (listing.backingOpen !== !arena.closed) return "unavailable";
  return listing.backingOpen ? "open" : "closed";
}

export function lockerIsOpen(listing: Listing, read: LockerRead | null): boolean {
  return lockerStatus(listing, read) === "open";
}

/** Names of the listings whose locker is open in a fresh read; empty on a stale or missing read. */
export function openForNames(market: MarketData | null): string[] {
  if (!market || market.stale) return [];
  return market.listings.filter((l) => lockerIsOpen(l, market)).map((l) => l.name);
}

const flow = (netFlow: string | null) => {
  if (netFlow === null) return null;
  const n = BigInt(netFlow);
  const shown = tokenAmount(n < 0n ? -n : n, TOKEN_DECIMALS);
  return { text: `${n > 0n ? "+" : n < 0n ? "−" : ""}${shown.label} RLAN this season`, title: `${shown.title} RLAN`, dir: n > 0n ? "up" : n < 0n ? "down" : "flat" };
};

export { ago };

/** Where and when the numbers were true, relative first; the exact time and slot are in the tooltip. */
export function ObservedLine({ data, sample, now, onRefresh }: { data: { network: string; observedAt: string | null; slot: number | null; stale: boolean }; sample?: boolean; now?: number; onRefresh?: () => void }) {
  const at = data.observedAt ? Date.parse(data.observedAt) : null;
  const exact = at === null ? undefined : `${utc(at)}${data.slot ? ` · slot ${fmt(data.slot)}` : ""} · Solana ${data.network}`;
  return (
    <p className={data.stale ? "meta-line meta-line--stale" : "meta-line"} role={data.stale ? "status" : undefined}>
      <Icon name={data.stale ? "clock" : "info"} size="sm" />
      <span title={exact}>{at === null ? `Solana ${data.network}: no read yet.` : `Read from Solana ${data.network} ${ago((now ?? Date.now()) - at)}.`}</span>
      {data.stale && " Radio LAN has not refreshed it since."}
      {onRefresh && (data.stale || at === null) && (
        <button className="link-btn" type="button" onClick={onRefresh}>
          Refresh
        </button>
      )}
      {sample && <SampleTag />}
    </p>
  );
}

function BackingCell({ l, read }: { l: Listing; read: LockerRead }) {
  const status = lockerStatus(l, read);
  if (status === "stale") return <span className="mkt__none">Locker status unavailable · last read is stale</span>;
  if (status === "unavailable") return <span className="mkt__none">Locker status unavailable · no current read</span>;
  if (status === "closed") return <span className="mkt__none">{l.arena ? "Closed · this locker is not taking backing" : "No locker yet · this channel is not backable here"}</span>;
  if (!l.arena) return <span className="mkt__none">No verified backing read</span>;
  const f = flow(l.arena.netFlow);
  return (
    <>
      <span className="mkt__num num" title={rlan(l.arena.total).title}>{rlan(l.arena.total).label}</span>
      <span className="mkt__sub">
        {fmt(Number(l.arena.backers))} {Number(l.arena.backers) === 1 ? "backer" : "backers"}
        {l.arena.requested > 0 && ` · ${l.arena.requested} leaving`}
        {l.arena.closed && " · closed"}
      </span>
      {f && <span className={`mkt__flow mkt__flow--${f.dir}`} title={f.title}>{f.text}</span>}
    </>
  );
}

function PerformanceCell({ l }: { l: Listing }) {
  const p = l.performance;
  if (!p) return <span className="mkt__sub">No Twitch read yet</span>;
  return (
    <span className="mkt__perf" title={p.provenance}>
      <span className={p.live ? "pill pill--live pill--sm" : "pill pill--sm"}>
        <span className="pill__dot" aria-hidden="true" />
        {p.live ? `Live · ${fmt(p.viewers ?? 0)}` : "Offline"}
      </span>
      {p.live && p.game && <span className="mkt__sub">{p.game}</span>}
      <span className="mkt__src">Data: Twitch</span>
    </span>
  );
}

function Row({ l, rank, market }: { l: Listing; rank: number | null; market: MarketData }) {
  const sample = market.sample;
  // A channel with no arena has no locker cell to show; the group heading says so once instead of every row.
  const hasLocker = Boolean(l.arena) || l.backingOpen || !l.twitch;
  return (
    <li className={[lockerIsOpen(l, market) ? "mkt__row mkt__row--open" : "mkt__row", rank !== null && "mkt__row--ranked", !hasLocker && "mkt__row--channel"].filter(Boolean).join(" ")}>
      {rank !== null && <span className="mkt__rank num" aria-label={`Backing rank ${rank}`}>{rank}</span>}
      <a className="mkt__main" href={`#/s/${l.slug}`}>
        <span className="mkt__name">
          {l.name}
          {l.demo && <Tag kind="sample">Fictional creator</Tag>}
          {sample && <SampleTag />}
        </span>
        <span className={l.twitch && hasLocker ? "mkt__cells" : "mkt__cells mkt__cells--one"}>
          {hasLocker && <span className="mkt__cell mkt__cell--backing">
            <span className="label">Locker</span>
            <BackingCell l={l} read={market} />
          </span>}
          {l.twitch && (
            <span className="mkt__cell">
              <span className="label">Twitch</span>
              <PerformanceCell l={l} />
            </span>
          )}
        </span>
      </a>
      <FollowButton slug={l.slug} name={l.name} />
    </li>
  );
}

export function Market({ market, load, onRetry, station, now, streamerBoard = HUB_LEADERBOARD_ENABLED }: { market: MarketData | null; load: "loading" | "error" | "ready"; onRetry: () => void; station: Station; now: number; streamerBoard?: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState<string | null>(null);
  const { slugs: followed } = useFollowing();

  const head = (
    <section className="hero hero--discover">
      <HubStory />
      <BuyRlanBar variant="hero" />
      <p className="small">Fans, creators, and AI agents share one room. Follow creators, compare public Twitch reads, and find your season crew. Season points are free. Backing is optional; an active position only changes the Play-credit weight described in How this works.</p>
    </section>
  );
  if (load === "loading") return <>{head}<Skeleton kinds={["block", "line", "line", "line"]} /></>;
  if (load === "error" || !market) return <>{head}<ErrorBlock text="The board didn't load. No scores changed. Nothing was sent." onRetry={onRetry} /></>;

  const featured = market.listings.find((l) => l.kind === "featured") ?? null;
  const q = query.trim().toLowerCase();
  const narrowed = filter !== "all" || q !== "" || lane !== null;
  const showFeatured = !narrowed;
  const following = followingListings(market.listings, followed);
  const visible = (filter === "following" ? following : sortListings(market.listings)).filter((l) => {
    if (l.kind === "featured" && showFeatured) return false; // shown once
    if (filter === "live" && !l.performance?.live) return false;
    if (lane !== null && l.performance?.game !== lane) return false;
    return !q || l.name.toLowerCase().includes(q) || l.slug.includes(q) || (l.twitch ?? "").includes(q);
  });
  const open = visible.filter((l) => lockerIsOpen(l, market));
  const twitchOnly = visible.filter((l) => !lockerIsOpen(l, market));
  const liveCount = twitchOnly.filter((l) => l.performance?.live).length;

  const featuredCard = featured && showFeatured ? (
    <div className="featured-wrap">
      <a className="feature" href={`#/s/${featured.slug}`} aria-label={`${featured.name}, the featured listing`}>
        <LanMark className="feature__mark" />
        <span className="feature__body">
          <span className="feature__row">
            <span className="feature__name">{featured.name}</span>
            <Tag kind="soon">Featured</Tag>{market.sample && <SampleTag />}
          </span>
          <span className="small">{featured.blurb ?? ""}</span>
          <span className="mkt__cells feature__cells">
            <span className="mkt__cell mkt__cell--backing"><span className="label">Locker · on chain</span><span className="feature__meta"><BackingCell l={featured} read={market} /></span></span>
            <span className="mkt__cell"><span className="label">Twitch</span><span className="feature__meta"><StationPill station={station} /></span></span>
          </span>
        </span>
        <Icon name="next" />
      </a>
      <FollowButton slug={featured.slug} name={featured.name} />
    </div>
  ) : null;

  return (
    <>
      {head}
      <ObservedLine data={market} sample={market.sample} now={now} onRefresh={onRetry} />
      {featuredCard}
      <section className="room-paths" aria-label="Your Radio LAN universe">
        <a href="#/play"><Icon name="play" /><strong>Play the season</strong><span>Free site activities and real points</span></a>
        <a href="#/board"><Icon name="board" /><strong>Find your standing</strong><span>The room's points board</span></a>
        {streamerBoard && <a href="#/leaderboard"><Icon name="stream" /><strong>Streamer board</strong><span>Channels ranked by season points. Chat is a labelled Twitch read.</span></a>}
      </section>
      <p className="small">Rewards, the locker, and communities are in <HowLink />.</p>
      {market.sample && <p className="small"><SampleTag /> Fictional creators and backing for preview. No live locker is opened here.</p>}
      <section className="discover-controls" aria-label="Channel controls">
      <div className="mkt__controls">
        <div className="seg" role="group" aria-label="Show">
          {([["all", "All"], ["live", "Live now"], ["following", `Following (${following.length})`]] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        <label className="search">
          <span className="sr-only">Search creators</span>
          <Icon name="search" size="sm" />
          <input type="search" value={query} placeholder="Search creators" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <Lanes listings={market.listings} lane={lane} onLane={setLane} />
      </section>
      {filter === "following" ? (
        visible.length === 0 ? <EmptyBlock icon="star" title="Your watchlist" text="Follow creators to keep them here. Following is saved in this browser and adds no points." /> :
        <ul className="mkt" aria-label="Following">{visible.map((l) => <Row key={l.slug} l={l} rank={null} market={market} />)}</ul>
      ) : <>{open.length > 0 && <section aria-labelledby="h-open">
        <h2 className="label mkt__group" id="h-open">
          Open lockers · {open.length}
        </h2>
        <ol className="mkt" aria-labelledby="h-open">
          {open.map((l, i) => (
            <Row key={l.slug} l={l} rank={i + 1} market={market} />
          ))}
        </ol>
      </section>}
      {twitchOnly.length > 0 && (open.length === 0 ? (
        <section aria-labelledby="h-channels">
          <h2 className="label mkt__group" id="h-channels">
            Channels · {twitchOnly.length} {twitchOnly.length === 1 ? "channel" : "channels"}
            {liveCount > 0 && `, ${liveCount} live`}
          </h2>
          {twitchOnly.every((l) => !l.arena && !l.backingOpen) && <p className="small mkt__group-note">Twitch status only. None of these channels has a locker yet, so backing is not open for them here.</p>}
          <ul className="mkt" aria-labelledby="h-channels">
            {twitchOnly.map((l) => (
              <Row key={l.slug} l={l} rank={null} market={market} />
            ))}
          </ul>
        </section>
      ) : (
        <details className="mkt__more" open={narrowed || undefined}>
          <summary>
            On Twitch, not listed yet · {twitchOnly.length} {twitchOnly.length === 1 ? "channel" : "channels"}
            {liveCount > 0 && `, ${liveCount} live`}
          </summary>
          <ul className="mkt">
            {twitchOnly.map((l) => (
              <Row key={l.slug} l={l} rank={null} market={market} />
            ))}
          </ul>
        </details>
      ))}
      {open.length === 0 && twitchOnly.length === 0 && (narrowed ? <EmptyBlock icon="board" title="Nothing matches" text="Try another filter or search." /> : <p className="small mkt__empty">No channels match the current read yet.</p>)}
      
      </>}
      <Collect listings={market.listings} followed={followed} />
      <CreatorAffinity listings={market.listings} followed={followed} sample={Boolean(market.sample)} />
      <p className="small fine">{FOLLOWING_LOCAL} {BACKING_BOOST} <HowLink /></p>
    </>
  );
}

function Lanes({ listings, lane, onLane }: { listings: Listing[]; lane: string | null; onLane: (game: string | null) => void }) {
  const lanes = categoryLanes(listings);
  if (lanes.length < 2) return null;
  return (
    <div className="lanes" role="group" aria-label="Category">
      <button type="button" aria-pressed={lane === null} onClick={() => onLane(null)}>
        All categories
      </button>
      {lanes.map((l) => (
        <button key={l.game} type="button" aria-pressed={lane === l.game} onClick={() => onLane(lane === l.game ? null : l.game)}>
          {l.game} <span className="num">{l.channels}</span>
        </button>
      ))}
    </div>
  );
}

function Collect({ listings, followed }: { listings: Listing[]; followed: readonly string[] }) {
  const c = collection(listings, followed);
  if (c.total < 6) return null;
  return (
    <section className="collect" aria-labelledby="h-collect">
      <div className="collect__head">
        <h2 className="label" id="h-collect">
          Collect today's channels
        </h2>
        <span className="small">
          <span className="num">{c.followed}</span> of <span className="num">{c.total}</span> followed
        </span>
      </div>
      <div className="collect__bar" role="progressbar" aria-valuemin={0} aria-valuemax={c.total} aria-valuenow={c.followed} aria-label="Channels followed">
        <span style={{ width: `${Math.round((c.followed / c.total) * 100)}%` }} />
      </div>
      <ul className="collect__badges">
        {c.badges.map((b) => (
          <li key={b.key} className={b.earned ? "badge badge--on" : "badge"}>
            <strong>{b.label}</strong>
            <span className="small">{b.earned ? "Collected" : b.text}</span>
          </li>
        ))}
      </ul>
      <p className="small fine">{c.next ?? "Every badge collected."} Badges are just for fun and add no points.</p>
    </section>
  );
}
