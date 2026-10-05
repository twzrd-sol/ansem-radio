/**
 * The arena index behind the hub's backing board. Every few minutes it reads every arena and position account of the
 * radiolan-arena program from the station's own RPC upstream (RADIOLAN_RPC_URL; getProgramAccounts is heavy and is
 * not on the relay's allowlist on purpose), decodes them with the JS client, and keeps one snapshot per tick in
 * memory and on disk. The board joins those snapshots to the registry: an arena surfaces only through a listing whose
 * (streamer, mint) derives it; anything else on chain stays invisible.
 *
 * Backing is the only metric here, and it is read, never computed from anything off chain. Every aggregate carries
 * the network, the mint, the observation time and slot, and a stale flag, so no screen can show a number without
 * saying when and where it was true. A withdrawal request names no amount, so requests are counted, never summed.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { encodeBase58 } from "../core/base58.js";
import { BANNED_ARENAS } from "./registry.js";
import { DEVNET_GENESIS_HASH } from "../core/solana.js";

/** Genesis hashes the index accepts, by the network the station is configured for (RADIOLAN_HUB_NETWORK). */
export const GENESIS = Object.freeze({ devnet: DEVNET_GENESIS_HASH, mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" });
import { ARENA_PROGRAM_ID, ARENA_LEN, POSITION_LEN, arenaAddress, decodeArena, decodePosition, seasonIndex } from "../sinks/arena.js";

export const DEFAULT_INTERVAL_MS = 5 * 60_000;
/** Served history: this many days of ticks, downsampled to at most MAX_POINTS per listing. */
export const HISTORY_DAYS = 7;
export const MAX_POINTS = 400;

const fromBase64 = (text) => new Uint8Array(Buffer.from(text, "base64"));
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** One JSON-RPC call to the upstream; the URL may carry a provider key and is never logged. */
async function rpc(upstream, fetchImpl, method, params, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    const json = await response.json();
    if (json.error) throw new Error(`rpc ${json.error.code ?? ""} ${json.error.message ?? ""}`.trim());
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Read and decode every arena and position; the caller checked the network. */
export async function readArenas({ upstream, fetchImpl, program = ARENA_PROGRAM_ID, timeoutMs = 20_000 }) {
  const accounts = (size) => rpc(upstream, fetchImpl, "getProgramAccounts", [program, { encoding: "base64", commitment: "confirmed", filters: [{ dataSize: size }] }], timeoutMs);
  const [arenaRows, positionRows] = await Promise.all([accounts(ARENA_LEN), accounts(POSITION_LEN)]);
  const arenas = new Map();
  for (const row of arenaRows ?? []) {
    try {
      arenas.set(row.pubkey, { address: row.pubkey, ...decodeArena(fromBase64(row.account.data[0])), positionsSeen: 0, requested: 0 });
    } catch {
      /* not an arena: the size filter is not a tag check */
    }
  }
  const positions = [];
  for (const row of positionRows ?? []) {
    try {
      const position = { address: row.pubkey, ...decodePosition(fromBase64(row.account.data[0])) };
      positions.push(position);
      const arena = arenas.get(position.arena);
      if (arena) {
        arena.positionsSeen += 1;
        if (position.state === "requested") arena.requested += 1;
      }
    } catch {
      /* not a position */
    }
  }
  return { arenas, positions };
}

/** A snapshot row as stored and served: BigInts as decimal strings, nothing a JSON reader has to guess at. */
function snapshotRow(arena, observedAt, slot) {
  return {
    at: observedAt,
    slot,
    arena: arena.address,
    streamer: arena.streamer,
    mint: arena.mint,
    decimals: arena.decimals,
    closed: arena.closed,
    seasonStart: arena.seasonStart.toString(),
    seasonSeconds: arena.seasonSeconds.toString(),
    positions: arena.positions.toString(),
    total: arena.total.toString(),
    requested: arena.requested,
  };
}

/** Downsample to at most `max` points, keeping the first and the last. */
export function downsample(points, max = MAX_POINTS) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  return out;
}

export function createArenaIndex({
  upstream,
  fetchImpl = globalThis.fetch,
  dir,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = Date.now,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => clearTimeout(timer),
  log = console,
  program = ARENA_PROGRAM_ID,
  expectNetwork = "devnet",
}) {
  if (!Object.hasOwn(GENESIS, expectNetwork)) throw new TypeError("RADIOLAN_HUB_NETWORK must be devnet or mainnet");
  if (typeof upstream !== "string" || !/^https?:\/\//.test(upstream)) throw new TypeError("RADIOLAN_RPC_URL is required for the arena index");
  if (typeof dir !== "string" || dir === "") throw new TypeError("a snapshot directory is required");
  const marketDir = join(dir, "market");
  mkdirSync(marketDir, { recursive: true, mode: 0o700 });

  // History in memory: arena address -> rows, oldest first, loaded from the last HISTORY_DAYS day files.
  const history = new Map();
  const horizon = () => now() - HISTORY_DAYS * 86_400_000;
  const remember = (row) => {
    const rows = history.get(row.arena) ?? [];
    rows.push(row);
    history.set(row.arena, rows);
  };
  /** Drop rows older than the served window; runs every tick, not only at load. Day files on disk are kept. */
  const prune = () => {
    const cutoff = horizon();
    for (const [arena, rows] of history) {
      const kept = rows.filter((r) => Date.parse(r.at) >= cutoff);
      if (kept.length === 0) history.delete(arena);
      else if (kept.length !== rows.length) history.set(arena, kept);
    }
  };
  const cutoff = now() - HISTORY_DAYS * 86_400_000;
  if (existsSync(marketDir)) {
    for (const name of readdirSync(marketDir).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort()) {
      if (Date.parse(name.slice(0, 10)) < cutoff - 86_400_000) continue;
      for (const line of readFileSync(join(marketDir, name), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (Date.parse(row.at) >= cutoff) remember(row);
        } catch {
          /* a torn line at the end of a file */
        }
      }
    }
  }

  let latest = null; // { network, observedAt, slot, arenas: Map, positions: [] }
  let network = null; // the configured network's genesis, checked once per process
  let lastError = null;
  let timer = null;
  let failures = 0;
  let active = false;

  const tick = async () => {
    try {
      if (!network) {
        const genesis = await rpc(upstream, fetchImpl, "getGenesisHash", [], 10_000);
        if (genesis !== GENESIS[expectNetwork]) throw new Error(`upstream is not Solana ${expectNetwork}; the index reads the configured network only`);
        network = expectNetwork;
      }
      const slot = await rpc(upstream, fetchImpl, "getSlot", [{ commitment: "confirmed" }], 10_000);
      const { arenas, positions } = await readArenas({ upstream, fetchImpl, program });
      const observedAt = new Date(now()).toISOString();
      for (const arena of arenas.values()) {
        const row = snapshotRow(arena, observedAt, slot);
        appendFileSync(join(marketDir, `${day(now())}.jsonl`), `${JSON.stringify(row)}\n`, { mode: 0o600 });
        remember(row);
      }
      latest = { network, observedAt, slot, arenas, positions };
      lastError = null;
      failures = 0;
      prune();
    } catch (error) {
      failures += 1;
      lastError = error?.message ?? String(error);
      log.warn?.(`arena index: tick failed (${failures}): ${lastError}`);
    }
    if (active) timer = schedule(tick, Math.min(intervalMs * 2 ** Math.min(failures, 4), 60 * 60_000));
  };

  const stale = () => latest === null || now() - Date.parse(latest.observedAt) > 2 * intervalMs;
  /**
   * The first snapshot of the current season, for net flow. Null when there is none, or when the first one came
   * more than two intervals after the season opened (the index was down at the rollover), since a late baseline
   * would silently undercount the flow. `since` says which read the flow is measured from.
   */
  const seasonOpen = (arena) => {
    const rows = history.get(arena.address) ?? [];
    const start = Number(arena.seasonStart) * 1000;
    const season = seasonIndex(arena.seasonStart, arena.seasonSeconds, BigInt(Math.floor(now() / 1000)));
    const seasonStartMs = season === 0n ? start : start + Number(season - 1n) * Number(arena.seasonSeconds) * 1000;
    const first = rows.find((r) => Date.parse(r.at) >= seasonStartMs);
    if (!first || Date.parse(first.at) - seasonStartMs > 2 * intervalMs) return null;
    return { total: BigInt(first.total), since: first.at };
  };

  /** The arena a listing derives, if it is on chain; null means "not backable yet", never an error. */
  const listingArena = (entry) => {
    if (!entry.streamer || !entry.mint || !latest) return null;
    const address = encodeBase58(arenaAddress(entry.streamer, entry.mint).address);
    // F-8: the internal test arena and the superseded candidate never surface, whatever derives them.
    if (BANNED_ARENAS.includes(address)) return null;
    const arena = latest.arenas.get(address);
    if (!arena) return null;
    const nowSeconds = BigInt(Math.floor(now() / 1000));
    const open = seasonOpen(arena);
    return {
      address,
      streamer: arena.streamer,
      mint: arena.mint,
      decimals: arena.decimals,
      closed: arena.closed,
      seasonStart: arena.seasonStart.toString(),
      seasonSeconds: arena.seasonSeconds.toString(),
      season: seasonIndex(arena.seasonStart, arena.seasonSeconds, nowSeconds).toString(),
      total: arena.total.toString(),
      backers: arena.positions.toString(),
      requested: arena.requested,
      netFlow: open === null ? null : (arena.total - open.total).toString(),
      flowSince: open === null ? null : open.since,
    };
  };

  return {
    start() {
      active = true;
      void tick();
    },
    stop() {
      active = false;
      if (timer) cancel(timer);
      timer = null;
    },
    /** Once, for tests and for the first request: resolves after one read attempt. */
    refresh: () => tick(),
    status: () => ({ network, observedAt: latest?.observedAt ?? null, slot: latest?.slot ?? null, stale: stale(), lastError, arenas: latest ? latest.arenas.size : 0, positions: latest ? latest.positions.length : 0 }),
    listingArena,
    /** Served history for one arena: last HISTORY_DAYS, downsampled. */
    history: (address) => downsample((history.get(address) ?? []).filter((r) => Date.parse(r.at) >= now() - HISTORY_DAYS * 86_400_000).map((r) => ({ at: r.at, slot: r.slot, total: r.total, backers: r.positions, requested: r.requested }))),
    /**
     * A fan's positions across every arena in the index, with the arena's schedule for release dates. The caller
     * maps arenas to listings; a position in an arena no listing derives comes back too (slug null on the route),
     * so a fan always sees what their wallet holds, labelled as not listed here.
     */
    positionsOf: (fan) => (latest ? latest.positions.filter((p) => p.fan === fan) : []).map((p) => {
      const arena = latest.arenas.get(p.arena);
      return {
        arena: p.arena,
        address: p.address,
        state: p.state,
        amount: p.amount.toString(),
        requestedSeason: p.requestedSeason.toString(),
        openedAt: p.openedAt.toString(),
        schedule: arena ? { seasonStart: arena.seasonStart.toString(), seasonSeconds: arena.seasonSeconds.toString(), closed: arena.closed } : null,
      };
    }),
  };
}
