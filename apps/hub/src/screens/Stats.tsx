// Stats: today's biggest Twitch channels and categories, from the station's own collection. Display only. This page
// says where its numbers come from.
import { useEffect, useState } from "react";

import { fetchAnalyticsPreview, type AnalyticsPreview } from "../data/analytics";
import { fmt, utc } from "../lib/format";
import { EmptyBlock, ErrorBlock, Icon, PageHead, Skeleton } from "../ui/atoms";

export function StatsView({ preview, load, onRetry }: { preview: AnalyticsPreview | null; load: "loading" | "error" | "ready"; onRetry: () => void }) {
  const head = <PageHead eyebrow="Stats" title="Twitch right now" lede="The biggest channels and categories over the last day, collected by the station from Twitch's public data." />;
  if (load === "loading") return <>{head}<Skeleton kinds={["block", "block"]} /></>;
  if (load === "error") return <>{head}<ErrorBlock text="The stats didn't load." onRetry={onRetry} /></>;
  if (!preview || preview.data.channels.length === 0) {
    return <>{head}<EmptyBlock icon="board" title="No stats yet" text="The station hasn't collected a reading yet. They appear after its first few polls." /></>;
  }
  const { channels, categories } = preview.data;
  return (
    <>
      {head}
      <section className="section" aria-labelledby="h-stats-channels">
        <div className="section__head">
          <h2 className="h2" id="h-stats-channels">Top channels · last 24 hours</h2>
          <span className="label">Data: Twitch</span>
        </div>
        <div className="table-wrap">
          <table className="stats-table">
            <thead><tr><th scope="col">#</th><th scope="col">Channel</th><th scope="col">Category</th><th scope="col" className="num">Peak</th><th scope="col" className="num">Hours watched</th></tr></thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.login}>
                  <td className="num">{c.rank}</td>
                  <th scope="row"><a href={`#/s/${c.login.replace(/_+$/, "") || c.login}`}>{c.name}</a></th>
                  <td>{c.game ?? "—"}</td>
                  <td className="num">{fmt(c.peakViewers)}</td>
                  <td className="num">{fmt(Math.round(c.hoursWatched))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="section" aria-labelledby="h-stats-cats">
        <div className="section__head">
          <h2 className="h2" id="h-stats-cats">Top categories · last 24 hours</h2>
          <span className="label">Data: Twitch</span>
        </div>
        <div className="table-wrap">
          <table className="stats-table">
            <thead><tr><th scope="col">#</th><th scope="col">Category</th><th scope="col" className="num">Peak</th><th scope="col" className="num">Channels seen</th><th scope="col" className="num">Hours watched</th></tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.game}>
                  <td className="num">{c.rank}</td>
                  <th scope="row">{c.game}</th>
                  <td className="num">{fmt(c.peakViewers)}</td>
                  <td className="num">{fmt(c.channels)}</td>
                  <td className="num">{fmt(Math.round(c.hoursWatched))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="small fine">
        {preview.source} {preview.coverage.lastSampleAt ? `Last reading ${utc(preview.coverage.lastSampleAt * 1000)}.` : ""} Seen per reading: about {fmt(preview.coverage.avgChannelsPerPoll)} channels.
      </p>
    </>
  );
}

export function Stats() {
  const [state, setState] = useState<{ load: "loading" | "error" | "ready"; preview: AnalyticsPreview | null }>({ load: "loading", preview: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ load: "loading", preview: null });
    fetchAnalyticsPreview().then((preview) => live && setState({ load: "ready", preview }), () => live && setState({ load: "error", preview: null }));
    return () => { live = false; };
  }, [attempt]);
  return <StatsView preview={state.preview} load={state.load} onRetry={() => setAttempt((n) => n + 1)} />;
}
