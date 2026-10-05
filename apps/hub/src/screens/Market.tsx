// The Board: every listed creator, with backing (on chain, the only owned metric) and Twitch figures (display only)
// side by side and never merged. The station's own channel is one listing among them.
import { useState } from "react";

import { NETWORK_LABEL, TOKEN_DECIMALS } from "../chain/config";
import { followingListings, sortListings, type Listing, type Market as MarketData } from "../data/market";
import { useFollowing } from "../data/following";
import { categoryLanes, collection } from "../data/lanes";
import type { Station } from "../data/station";
import { fmt, units, utc } from "../lib/format";
import { EmptyBlock, ErrorBlock, Icon, LanMark, SampleTag, Skeleton, StationPill, Tag } from "../ui/atoms";
import { FollowButton } from "../ui/FollowButton";
import { HowLink } from "../ui/HowItWorks";

type Filter = "all" | "live" | "following";

export const rlan = (baseUnits: string) => `${units(BigInt(baseUnits), TOKEN_DECIMALS)} RLAN`;
const flow = (netFlow: string | null) => {
  if (netFlow === null) return null;
  const n = BigInt(netFlow);
  return { text: `${n > 0n ? "+" : n < 0n ? "−" : ""}${units(n < 0n ? -n : n, TOKEN_DECIMALS)} this season`, dir: n > 0n ? "up" : n < 0n ? "down" : "flat" };
};

/** "just now", "6 min ago", "3 h ago", "2 days ago": how old a read is, in a fan's words. */
export function ago(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** Where and when the numbers were true, relative first; the exact time and slot are in the tooltip. */
export function ObservedLine({ data, sample, now, onRefresh }: { data: { network: string; observedAt: string | null; slot: number | null; stale: boolean }; sample?: boolean; now?: number; onRefresh?: () => void }) {
  const at = data.observedAt ? Date.parse(data.observedAt) : null;
  const exact = at === null ? undefined : `${utc(at)}${data.slot ? ` · slot ${fmt(data.slot)}` : ""} · Solana ${data.network}`;
  return (
    <p className={data.stale ? "meta-line meta-line--stale" : "meta-line"} role={data.stale ? "status" : undefined}>
      <Icon name={data.stale ? "clock" : "info"} size="sm" />
      <span title={exact}>{at === null ? `Solana ${data.network}: no read yet.` : `Read from Solana ${data.network} ${ago((now ?? Date.now()) - at)}.`}</span>
      {data.stale && " The station has not refreshed it since."}
      {onRefresh && (data.stale || at === null) && (
        <button className="link-btn" type="button" onClick={onRefresh}>
          Refresh
        </button>
      )}
      {sample && <SampleTag />}
    </p>
  );
}

function BackingCell({ l }: { l: Listing }) {
  if (!l.arena) return <span className="mkt__none">{l.kind === "featured" ? "Arena not open yet" : "Not open yet"}</span>;
  const f = flow(l.arena.netFlow);
  return (
    <>
      <span className="mkt__num num">{rlan(l.arena.total)}</span>
      <span className="mkt__sub">
        {fmt(Number(l.arena.backers))} {Number(l.arena.backers) === 1 ? "backer" : "backers"}
        {l.arena.requested > 0 && ` · ${l.arena.requested} leaving`}
        {l.arena.closed && " · closed"}
      </span>
      {f && <span className={`mkt__flow mkt__flow--${f.dir}`}>{f.text}</span>}
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

function Row({ l, rank, sample }: { l: Listing; rank: number | null; sample?: boolean }) {
  return (
    <li className={l.backingOpen ? "mkt__row mkt__row--open" : "mkt__row"}>
      {/* A number only over the backable group: it ranks backing, never Twitch viewers. */}
      {rank === null ? <span className="mkt__rank" aria-hidden="true" /> : <span className="mkt__rank num" aria-label={`Backing rank ${rank}`}>{rank}</span>}
      <a className="mkt__main" href={`#/s/${l.slug}`}>
        <span className="mkt__name">
          {l.name}
          {l.demo && <Tag kind="sample">Demo</Tag>}
          {sample && <SampleTag />}
        </span>
        <span className={l.twitch ? "mkt__cells" : "mkt__cells mkt__cells--one"}>
          <span className="mkt__cell mkt__cell--backing">
            <span className="label">Backing</span>
            <BackingCell l={l} />
          </span>
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

export function Market({ market, load, onRetry, station, now }: { market: MarketData | null; load: "loading" | "error" | "ready"; onRetry: () => void; station: Station; now: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState<string | null>(null);
  const { slugs: followed } = useFollowing();

  const head = (
    <section className="hero hero--tight">
      <p className="eyebrow">The Board · {NETWORK_LABEL}</p>
      <h1 className="h1" tabIndex={-1}>
        Find the streamers you watch
      </h1>
      <p className="lede">Today's biggest channels, by category. Follow the ones you like, and back a creator with RLAN when you choose.</p>
    </section>
  );
  if (load === "loading") return <>{head}<Skeleton kinds={["block", "line", "line", "line"]} /></>;
  if (load === "error" || !market) return <>{head}<ErrorBlock text="The board didn't load. Nothing on chain changed." onRetry={onRetry} /></>;

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
  const open = visible.filter((l) => l.backingOpen);
  const twitchOnly = visible.filter((l) => !l.backingOpen);
  const liveCount = twitchOnly.filter((l) => l.performance?.live).length;

  return (
    <>
      {head}
      <ObservedLine data={market} sample={market.sample} now={now} onRefresh={onRetry} />
      {featured && showFeatured && (
        <div className="featured-wrap">
        <a className="feature" href={`#/s/${featured.slug}`} aria-label={`${featured.name}, the featured listing`}>
          <LanMark className="feature__mark" />
          <span className="feature__body">
            <span className="feature__row">
              <span className="feature__name">{featured.name}</span>
              <Tag kind="soon">Featured</Tag>
              <StationPill station={station} />
            </span>
            <span className="small">{featured.blurb ?? ""}</span>
            <span className="feature__meta">{featured.arena ? <BackingCell l={featured} /> : <span className="mkt__none">Arena not open yet</span>}</span>
          </span>
          <Icon name="next" />
        </a>
        <FollowButton slug={featured.slug} name={featured.name} />
        </div>
      )}
      <Collect listings={market.listings} followed={followed} />
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
      {filter === "following" ? (
        visible.length === 0 ? <EmptyBlock icon="star" title="Your watchlist" text="Follow creators to keep them here. Following is saved in this browser and adds no points." /> :
        <ul className="mkt" aria-label="Following">{visible.map((l) => <Row key={l.slug} l={l} rank={null} sample={market.sample} />)}</ul>
      ) : <><section aria-labelledby="h-open">
        <h2 className="label mkt__group" id="h-open">
          Backing open · {open.length}
        </h2>
        {open.length === 0 ? (
          <p className="small mkt__empty">{narrowed ? "No backable creator matches." : "No creator has an arena open for backing yet. Creators list themselves by creating one."}</p>
        ) : (
          <ol className="mkt" aria-labelledby="h-open">
            {open.map((l, i) => (
              <Row key={l.slug} l={l} rank={i + 1} sample={market.sample} />
            ))}
          </ol>
        )}
      </section>
      {twitchOnly.length > 0 && (
        <details className="mkt__more" open={narrowed || undefined}>
          <summary>
            On Twitch, not listed yet · {twitchOnly.length} {twitchOnly.length === 1 ? "channel" : "channels"}
            {liveCount > 0 && `, ${liveCount} live`}
          </summary>
          <ul className="mkt">
            {twitchOnly.map((l) => (
              <Row key={l.slug} l={l} rank={null} sample={market.sample} />
            ))}
          </ul>
        </details>
      )}
      {open.length === 0 && twitchOnly.length === 0 && narrowed && <EmptyBlock icon="board" title="Nothing matches" text="Try another filter or search." />}
      </>}
      <p className="small fine">Following lives in this browser. Backing adds no points. <HowLink /></p>
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
