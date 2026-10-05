// The Board's accessible, playful layer: category lanes to narrow by, and a collection meter
// that fills as a visitor follows channels across categories. Everything here is derived in the browser from the
// listings and the visitor's own follows. Badges are for fun: they add no points, and a Twitch figure is never an
// input to anything but the order of the list.
import type { Listing } from "./market";

export interface Lane { game: string; channels: number; live: number }

/** The categories present among channels with a Twitch read, biggest first. */
export function categoryLanes(listings: Listing[], max = 8): Lane[] {
  const by = new Map<string, Lane>();
  for (const l of listings) {
    const game = l.performance?.game;
    if (!game) continue;
    const lane = by.get(game) ?? { game, channels: 0, live: 0 };
    lane.channels += 1;
    if (l.performance?.live) lane.live += 1;
    by.set(game, lane);
  }
  return [...by.values()].sort((a, b) => b.channels - a.channels || b.live - a.live || a.game.localeCompare(b.game)).slice(0, max);
}

export interface Badge { key: "scout" | "explorer" | "lane"; label: string; text: string; earned: boolean }
export interface Collection { followed: number; total: number; categories: number; badges: Badge[]; next: string | null }

const SCOUT = 3;
const EXPLORER = 3;

/** Progress over the channels currently on the board with a category. A "lane" is every channel of one category. */
export function collection(listings: Listing[], followed: readonly string[]): Collection {
  const pool = listings.filter((l) => l.twitch && l.performance?.game);
  const mine = new Set(followed);
  const got = pool.filter((l) => mine.has(l.slug));
  const categories = new Set(got.map((l) => l.performance!.game as string));
  const lanes = categoryLanes(pool, 50);
  const fullLane = lanes.some((lane) => lane.channels >= 3 && pool.filter((l) => l.performance!.game === lane.game).every((l) => mine.has(l.slug)));
  const badges: Badge[] = [
    { key: "scout", label: "Scout", text: `Follow ${SCOUT} channels`, earned: got.length >= SCOUT },
    { key: "explorer", label: "Explorer", text: `Follow channels from ${EXPLORER} categories`, earned: categories.size >= EXPLORER },
    { key: "lane", label: "Full lane", text: "Follow every channel in a category of 3 or more", earned: fullLane },
  ];
  const open = badges.find((b) => !b.earned);
  const next = !open ? null
    : open.key === "scout" ? `${SCOUT - got.length} more to be a Scout`
    : open.key === "explorer" ? `${EXPLORER - categories.size} more ${EXPLORER - categories.size === 1 ? "category" : "categories"} to be an Explorer`
    : "Follow a whole category to finish";
  return { followed: got.length, total: pool.length, categories: categories.size, badges, next };
}
