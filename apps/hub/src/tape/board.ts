import { MAX_EVENTS, MAX_SPARK_POINTS, MAX_TICKER } from "./policy";
import type { ChannelRef, TapeEvent } from "./events";

export interface TapeChannel {
  slug: string;
  name: string;
  arena: string | null;
  events: number;
  participants: number | null;
  lastSlot: number | null;
  spark: number[];
}

export interface TickerItem {
  id: string;
  text: string;
}

export interface TapeBoard {
  channels: TapeChannel[];
  ticker: TickerItem[];
  feed: TapeEvent[];
}

export function capHistory<T>(items: T[], max: number): T[] {
  return items.length <= max ? items : items.slice(items.length - max);
}

/** Sparkline of activity counts (events per slot). Never totals, never a quote. */
export function activitySparkline(values: number[], width = 200, height = 48): string | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((value - min) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
}

export function reduceTape(channels: ChannelRef[], events: TapeEvent[]): TapeBoard {
  const feed = capHistory(
    [...events].sort((a, b) => (a.slot === b.slot ? a.at - b.at : a.slot - b.slot)),
    MAX_EVENTS,
  )
    .slice()
    .reverse();

  const rows = channels.map((channel) => {
    const mine = events.filter((event) => event.slug === channel.slug || (channel.arena && event.account === channel.arena));
    const last = mine[mine.length - 1];
    const bySlot = new Map<number, number>();
    for (const event of mine) bySlot.set(event.slot, (bySlot.get(event.slot) ?? 0) + 1);
    const spark = [...bySlot.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, count]) => count);
    const lastSlot = mine.reduce<number | null>((slot, event) => (slot === null || event.slot > slot ? event.slot : slot), null);
    return {
      slug: channel.slug,
      name: channel.name,
      arena: channel.arena,
      events: mine.length,
      participants: last?.participants ?? null,
      lastSlot,
      spark: capHistory(spark, MAX_SPARK_POINTS),
    };
  });

  const ticker = feed.slice(0, MAX_TICKER).map((event) => ({
    id: event.id,
    text: `${event.channel} · slot ${event.slot.toLocaleString("en-US")} · ${event.summary}`,
  }));

  return { channels: rows, ticker, feed };
}
