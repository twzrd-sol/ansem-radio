import { NETWORK_LABEL } from "../chain/config";
import { fmt } from "../lib/format";
import { activitySparkline, type TapeBoard } from "../tape/board";
import { MARKET_BOARD_ENABLED } from "../tape/flag";
import { useReducedMotion } from "../tape/motion";
import { useTape, type TapeMode } from "../tape/use-tape";
import type { TapeStatus } from "../tape/socket";
import { EmptyBlock, ErrorBlock, PageHead, SampleTag, Skeleton } from "../ui/atoms";

export function TapeBoardView({
  board,
  status,
  mode,
  reducedMotion = false,
  onRetry,
}: {
  board: TapeBoard;
  status: TapeStatus;
  mode: TapeMode;
  reducedMotion?: boolean;
  onRetry?: () => void;
}) {
  const head = (
    <PageHead
      eyebrow={`Market board · ${NETWORK_LABEL}`}
      title="Activity tape"
      lede={`Arena deposits, withdrawals, and season events on ${NETWORK_LABEL}. unpriced. Activity counts and participation only — not a quote, and not a chart of value.`}
    />
  );

  return (
    <div className="tape">
      {head}
      <p className="small tape__rule">Deposited RLAN stays until you request a withdrawal; a request is released when its on-chain season ends. It is not a reward.</p>
      <div className="tape__bar">
        <span className="tape__net">{NETWORK_LABEL}</span>
        {mode === "demo" && <SampleTag />}
        <span className={`tape__live${status === "live" ? " tape__live--on" : ""}`}>
          {mode === "demo" ? "Demo tape" : status === "live" ? "Socket live" : status === "connecting" ? "Connecting" : "Socket offline"}
        </span>
      </div>
      {mode === "demo" && (
        <p className="network-note network-note--sample" role="note">
          <span className="network-note__chip">Demo tape</span>
          <span>These events are fixtures, not a live socket.</span>
        </p>
      )}
      {status === "offline" && mode !== "demo" && (
        <ErrorBlock text="The socket dropped. Nothing here is live until it reconnects. The HTTP relay does not invent events." onRetry={onRetry} />
      )}
      <Ticker items={board.ticker} reduced={reducedMotion} />
      {status === "connecting" && mode !== "demo" && board.feed.length === 0 ? (
        <Skeleton kinds={["block", "line", "line", "line"]} />
      ) : board.channels.length === 0 && board.feed.length === 0 ? (
        <EmptyBlock icon="board" title="No arena activity" text="No deposits, withdrawals, or season events yet. The tape waits for the next subscribed slot." />
      ) : (
        <>
          <section className="section" aria-labelledby="h-tape-channels">
            <div className="section__head">
              <h2 className="h2" id="h-tape-channels">Channels</h2>
              <span className="label">Activity counts</span>
            </div>
            <div className="table-wrap">
              <table className="tape__table">
                <thead>
                  <tr>
                    <th scope="col">Channel</th>
                    <th scope="col" className="num">Events</th>
                    <th scope="col" className="num">Participants</th>
                    <th scope="col" className="num">Last slot</th>
                    <th scope="col">Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {board.channels.map((row) => (
                    <tr key={row.slug}>
                      <th scope="row">{row.name}</th>
                      <td className="num">{fmt(row.events)}</td>
                      <td className="num">{row.participants === null ? "—" : fmt(row.participants)}</td>
                      <td className="num">{row.lastSlot === null ? "—" : fmt(row.lastSlot)}</td>
                      <td>
                        <Spark values={row.spark} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="section" aria-labelledby="h-tape-feed">
            <div className="section__head">
              <h2 className="h2" id="h-tape-feed">Recent activity</h2>
              <span className="label">{NETWORK_LABEL}</span>
            </div>
            {board.feed.length === 0 ? (
              <EmptyBlock icon="clock" title="Waiting on the next slot" text="Subscribed to the open arena. No classified deposit, withdrawal, or season event has arrived yet." />
            ) : (
              <ol className="tape__feed">
                {board.feed.map((event) => (
                  <li key={event.id}>
                    <span className="tape__kind">{event.kind}</span>
                    <span className="num">slot {fmt(event.slot)}</span>
                    <span>{event.channel}</span>
                    <span>{event.summary}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  const points = activitySparkline(values);
  if (!points) return <span className="tape__spark tape__spark--empty">No series yet</span>;
  return (
    <svg className="tape__spark" viewBox="0 0 200 48" role="img" aria-label={`Activity counts, ${values.length} slots`}>
      <polyline fill="none" points={points} />
    </svg>
  );
}

function Ticker({ items, reduced }: { items: Array<{ id: string; text: string }>; reduced: boolean }) {
  if (items.length === 0) {
    return (
      <div className="tape__ticker tape__ticker--empty" role="status">
        No arena deposits, withdrawals, or season events on the tape yet.
      </div>
    );
  }
  const row = items.map((item) => (
    <span key={item.id} className="tape__tick">
      {item.text}
    </span>
  ));
  if (reduced) {
    return (
      <div className="tape__ticker tape__ticker--static" role="status">
        {row}
      </div>
    );
  }
  return (
    <div className="tape__ticker" role="region" aria-label="Arena activity tape">
      <div className="tape__marquee">
        <div>{row}</div>
        <div aria-hidden="true">{row}</div>
      </div>
    </div>
  );
}

export function TapeView({
  listings,
  search = "",
  reducedMotion = false,
}: {
  listings: Array<{ slug: string; name: string; arena: { address: string } | null }>;
  search?: string;
  reducedMotion?: boolean;
}) {
  const tape = useTape(listings, search);
  return <TapeBoardView board={tape.board} status={tape.status} mode={tape.mode} reducedMotion={reducedMotion} onRetry={tape.retry} />;
}

export function Tape({ listings, search }: { listings: Array<{ slug: string; name: string; arena: { address: string } | null }>; search?: string }) {
  const reduced = useReducedMotion();
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  if (!MARKET_BOARD_ENABLED) return null;
  return <TapeView listings={listings} search={query} reducedMotion={reduced} />;
}
