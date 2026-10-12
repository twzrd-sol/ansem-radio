import { decodeArena } from "../chain/arena";
import { ARENA_PROGRAM } from "../chain/config";
import { seasonIndex } from "../chain/season";
import { short } from "../lib/format";

export type ActivityKind = "deposit" | "withdraw" | "season" | "closed";

export interface ChannelRef {
  slug: string;
  name: string;
  arena: string | null;
}

/** One classified arena activity row. Amounts stay off this object so the tape cannot show a quote. */
export interface TapeEvent {
  id: string;
  kind: ActivityKind;
  slot: number;
  at: number;
  account?: string;
  channel: string;
  slug?: string;
  participants?: number;
  season?: number;
  summary: string;
}

/** Last decoded arena, including total only so the next diff can tell deposit from withdraw. Never shown. */
export interface ArenaSnapshot {
  account: string;
  closed: boolean;
  positions: bigint;
  total: bigint;
  seasonStart: bigint;
  seasonSeconds: bigint;
  atSeconds: bigint;
}

export function channelFor(account: string | undefined, channels: ChannelRef[]): ChannelRef | null {
  if (!account) return null;
  return channels.find((row) => row.arena === account) ?? null;
}

export function labelFor(account: string | undefined, channels: ChannelRef[]): string {
  return channelFor(account, channels)?.name ?? (account ? short(account) : "Arena");
}

export function people(n: number): string {
  return `${n} ${n === 1 ? "participant" : "participants"}`;
}

export interface ArenaActivity {
  kind: ActivityKind;
  participants: number;
  season?: number;
  summary: string;
}

export function classifyArenaChange(prev: ArenaSnapshot | null, next: ArenaSnapshot): ArenaActivity[] {
  if (!prev) return [];
  const out: ArenaActivity[] = [];
  if (!prev.closed && next.closed) {
    out.push({ kind: "closed", participants: Number(next.positions), summary: `Arena closed · ${people(Number(next.positions))}` });
  }
  const before = Number(seasonIndex(prev.seasonStart, prev.seasonSeconds, prev.atSeconds));
  const after = Number(seasonIndex(next.seasonStart, next.seasonSeconds, next.atSeconds));
  if (after > before) {
    out.push({ kind: "season", season: after, participants: Number(next.positions), summary: `Season ${after} opened` });
  }
  if (next.total > prev.total) {
    out.push({
      kind: "deposit",
      participants: Number(next.positions),
      summary: `Deposit · comes back 1:1 · ${people(Number(next.positions))}`,
    });
  } else if (next.total < prev.total) {
    out.push({ kind: "withdraw", participants: Number(next.positions), summary: `Withdrawal · ${people(Number(next.positions))}` });
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function notificationPayload(message: unknown, method: string): { slot: number; subscription: number; value: unknown } | null {
  const root = asRecord(message);
  if (root?.method !== method) return null;
  const params = asRecord(root.params);
  const result = asRecord(params?.result);
  const context = asRecord(result?.context);
  const slot = context?.slot;
  const subscription = params?.subscription;
  if (typeof slot !== "number" || !Number.isFinite(slot) || typeof subscription !== "number") return null;
  return { slot, subscription, value: result?.value };
}

export function accountBytes(data: unknown): Uint8Array | null {
  const text = Array.isArray(data) && typeof data[0] === "string" ? data[0] : typeof data === "string" ? data : null;
  if (!text) return null;
  try {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function snapshotFromArena(account: string, data: Uint8Array, atSeconds: bigint): ArenaSnapshot | null {
  try {
    const decoded = decodeArena(data);
    return {
      account,
      closed: decoded.closed,
      positions: decoded.positions,
      total: decoded.total,
      seasonStart: decoded.seasonStart,
      seasonSeconds: decoded.seasonSeconds,
      atSeconds,
    };
  } catch {
    return null;
  }
}

/** Generic program logs are not activity. The ticker only uses classified account diffs. */
export function parseLogsNotification(message: unknown): null {
  const payload = notificationPayload(message, "logsNotification");
  if (!payload) return null;
  return null;
}

export function eventsFromAccountNotification(
  message: unknown,
  channels: ChannelRef[],
  now: number,
  accountForSub: (subscription: number) => string | undefined,
  previous: Map<string, ArenaSnapshot>,
): TapeEvent[] {
  const payload = notificationPayload(message, "accountNotification");
  if (!payload) return [];
  const value = asRecord(payload.value);
  if (!value) return [];
  const owner = typeof value.owner === "string" ? value.owner : "";
  if (owner && owner !== ARENA_PROGRAM) return [];
  const account = accountForSub(payload.subscription);
  if (!account) return [];
  const bytes = accountBytes(value.data);
  if (!bytes) return [];
  const next = snapshotFromArena(account, bytes, BigInt(Math.floor(now / 1000)));
  if (!next) return [];
  const named = channelFor(account, channels);
  const classified = classifyArenaChange(previous.get(account) ?? null, next).map((event, i) => ({
    ...event,
    id: `${event.kind}:${account}:${payload.slot}:${i}`,
    slot: payload.slot,
    at: now,
    account,
    channel: named?.name ?? short(account),
    slug: named?.slug,
  }));
  previous.set(account, next);
  return classified;
}

export interface TapeListing {
  slug: string;
  name: string;
  kind?: string;
  backingOpen?: boolean;
  arena: { address: string } | null;
}

/** Mainnet subscribes only to the open featured arena. Devnet keeps every listed arena. */
export function tapeListings(listings: TapeListing[], mainnet: boolean): TapeListing[] {
  if (!mainnet) return listings.filter((listing) => listing.arena);
  return listings.filter((listing) => listing.kind === "featured" && listing.backingOpen !== false && listing.arena);
}

export function channelsFromListings(listings: TapeListing[]): ChannelRef[] {
  return listings.filter((listing) => listing.arena).map((listing) => ({ slug: listing.slug, name: listing.name, arena: listing.arena!.address }));
}

/** Stable identity for hook deps so a fresh `[]` each render does not tear the socket down. */
export function listingKey(listings: TapeListing[]): string {
  return listings.map((row) => `${row.slug}:${row.name}:${row.kind ?? ""}:${row.backingOpen === false ? "0" : "1"}:${row.arena?.address ?? ""}`).join("|");
}
