/** Local operational context. No RPC calls, secrets, raw events, or financial actions. */
import { readFile } from "node:fs/promises";
import { decodeBase58 } from "../core/base58.js";
import { LOG_ID } from "../attribution/claim.js";
import { headFromJSON } from "../attribution/head.js";

export const GAP_ALERT_SECONDS = 60;
const ANCHOR_FILE = new URL("../../docs/examples/attribution-devnet/anchor.json", import.meta.url);

/** Only the committed example is read. A recorded transaction is not a live chain verification. */
export async function readRecordedAnchor() {
  try { return recordedAnchor(JSON.parse(await readFile(ANCHOR_FILE, "utf8"))); }
  catch { return null; }
}

export function recordedAnchor(record) {
  try {
    const head = headFromJSON(record.head);
    if (record.network !== "devnet" || record.log_id !== LOG_ID || head.logId !== LOG_ID) return null;
    for (const field of ["ledger", "root_account", "trusted_signer"]) {
      if (decodeBase58(record[field]).length !== 32) return null;
    }
    if (decodeBase58(record.signature).length !== 64 || !Number.isSafeInteger(record.published_slot) || record.published_slot < 0) return null;
    return {
      network: "devnet", log_id: LOG_ID, transaction: record.signature,
      ledger: record.ledger, root_account: record.root_account, published_slot: record.published_slot,
      tree_size: head.treeSize, root: record.head.root,
      timestamp: new Date(head.timestamp * 1000).toISOString(),
      status: "recorded", chain_check: "not_checked_by_dashboard", entries_are_fixtures: true,
      session_id: null,
    };
  } catch { return null; }
}

export function operationalContext({ gaps, from, now, stationStale, board = null, anchor = null }) {
  const updated = Date.parse(board?.updated_at);
  const hasRows = Array.isArray(board?.board?.rows);
  const boardState = !hasRows ? "unavailable" : !Number.isFinite(updated) || updated > now || now - updated > 120_000 || board.last_error || board.board.errors?.length ? "stale" : "available";
  const alerts = [];
  const seen = new Set();
  for (const gap of gaps) {
    const start = Math.max(from, Date.parse(gap.start));
    const end = Math.min(now, Date.parse(gap.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < GAP_ALERT_SECONDS * 1000) continue;
    const id = `gap:${start}:${end}`;
    if (seen.has(id)) continue;
    seen.add(id);
    alerts.push({ id, severity: "warning", type: "coverage_gap", created_at: new Date(end).toISOString(),
      message: `Ingest disconnected for ${Math.floor((end - start) / 1000)} seconds in this window.`,
      start: new Date(start).toISOString(), end: new Date(end).toISOString() });
  }
  if (stationStale) alerts.push({ id: "timeline:stale", severity: "warning", type: "timeline_stale", created_at: new Date(now).toISOString(), message: "No timeline sample in the last five minutes." });
  if (boardState !== "available") alerts.push({ id: "board:stale", severity: "warning", type: "board_stale", created_at: new Date(now).toISOString(), message: "Live board unavailable, stale, or reporting an error. Current live counts are unknown." });
  return {
    board_status: boardState,
    alerts: alerts.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)).slice(0, 20),
    gap_alert_min_seconds: GAP_ALERT_SECONDS,
    anchors: anchor ? [anchor] : [],
    readiness: {
      attribution: anchor ? "Recorded devnet fixture; no Twitch session links or live chain check." : "No valid local anchor record available.",
      rewards: "Unknown — reward configuration and eligibility are not read by this dashboard.",
      distribution: "Unknown — no distribution readiness source is configured.",
    },
  };
}

/** RFC 4180 quoting plus spreadsheet formula neutralization, including whitespace prefixes. */
function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function macroCsv(snapshot) {
  const rows = [["record_type", "timestamp", "streamer", "metric", "value", "unit", "detail"]];
  const add = (...cells) => rows.push(cells);
  add("snapshot", snapshot.generated_at, "", "window_hours", snapshot.hours, "hours", snapshot.notice);
  for (const r of snapshot.streamers) {
    add("streamer", snapshot.window.to, r.login, "attention_share", r.attention_share * 100, "percent_of_window_tracked_viewer_minutes", "");
    add("streamer", snapshot.window.to, r.login, "live_minutes", r.minutes_live, "minutes", r.top_category);
  }
  for (const r of snapshot.live_now) add("live", snapshot.board_updated_at, r.login, "viewers", r.viewer_count, "viewers", r.game_name);
  for (const p of snapshot.series) {
    add("timeline", p.t, "", "tracked_viewers", p.tracked_viewers, "viewers", "sample mean");
    add("timeline", p.t, "", "coverage", p.coverage === null ? null : p.coverage * 100, "percent", "worst coverage in sample");
  }
  for (const a of snapshot.alerts) add("alert", a.created_at, "", a.type, a.severity, "", a.message);
  for (const a of snapshot.anchors) add("anchor", a.timestamp, "", "recorded_transaction", a.transaction, "devnet", "Fixture; no session link; not checked by dashboard");
  for (const [name, value] of Object.entries(snapshot.readiness)) add("readiness", snapshot.generated_at, "", name, "unknown", "", value);
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
