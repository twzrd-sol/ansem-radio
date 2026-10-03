/** Free arena scoring and settlement plans. No RPC, custody, Twitch input or transfers. */
import { createPublicKey, verify } from "node:crypto";
import { decodePublicKey } from "../core/base58.js";
import { keccak256 } from "../core/keccak.js";
import { leafHash, nodeHash, verifyInclusion } from "../attribution/tree.js";

export const EVENT_DOMAIN = "RADIOLAN:ARENA_EVENT_V1";
export const PAYOUT_DOMAIN = "RADIOLAN:ARENA_PAYOUT_V1";
export const MANIFEST_DOMAIN = "RADIOLAN:ARENA_MANIFEST_V1";
const U64_MAX = (1n << 64n) - 1n;
const ACTIONS = ["question", "poll_response", "accepted_work"];
const CONFIG_FIELDS = ["network", "arena", "creator", "season", "arenaSeasonStart", "arenaSeasonSeconds", "startsAt", "endsAt", "claimDeadline", "asset", "budgetBaseUnits", "policy"];
const utf8 = (s) => new TextEncoder().encode(s);
const hex = (b) => Buffer.from(b).toString("hex");
const hash = (domain, data) => hex(keccak256(utf8(domain), utf8(JSON.stringify(data))));
const bytes32 = (s) => Buffer.from(hex32(s), "hex");

function fields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((k) => !expected.includes(k))
    || expected.some((k) => !Object.hasOwn(value, k))) throw new TypeError(`${label}: unexpected or missing fields`);
}
function hex32(s) {
  if (typeof s !== "string" || !/^[0-9a-f]{64}$/.test(s)) throw new TypeError("expected a 32-byte lowercase hex identifier");
  return s;
}
function uint(value, max = U64_MAX) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new RangeError("unsafe integer");
  if (!((typeof value === "number" && value >= 0) || typeof value === "bigint"
    || (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)))) throw new TypeError("expected an unsigned integer");
  const n = BigInt(value);
  if (n < 0n || n > max) throw new RangeError("unsigned integer outside range");
  return n;
}
function timestamp(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("timestamp must be nonnegative integer seconds");
  return n;
}
function key(s) { decodePublicKey(s); return s; }
function deepFreeze(x) {
  if (x && typeof x === "object") { Object.values(x).forEach(deepFreeze); Object.freeze(x); }
  return x;
}

export function normalizeConfig(c) {
  fields(c, CONFIG_FIELDS, "config");
  if (c.network !== "devnet") throw new TypeError("v0 settlement plans are devnet only");
  if (!["SOL", "USDC"].includes(c.asset)) throw new TypeError("v0 pool asset must be SOL or USDC");
  const startsAt = timestamp(c.startsAt), endsAt = timestamp(c.endsAt), claimDeadline = timestamp(c.claimDeadline);
  const arenaSeasonStart = timestamp(c.arenaSeasonStart);
  const arenaSeasonSeconds = Number(uint(c.arenaSeasonSeconds, 2419200n));
  const season = uint(c.season);
  if (arenaSeasonSeconds < 60 || season === 0n) throw new RangeError("invalid arena season schedule");
  const expectedStart = BigInt(arenaSeasonStart) + (season - 1n) * BigInt(arenaSeasonSeconds);
  const expectedEnd = expectedStart + BigInt(arenaSeasonSeconds);
  if (expectedStart > BigInt(Number.MAX_SAFE_INTEGER) || expectedEnd > BigInt(Number.MAX_SAFE_INTEGER)
    || startsAt !== Number(expectedStart) || endsAt !== Number(expectedEnd) || claimDeadline <= endsAt) {
    throw new RangeError("season window does not match the arena schedule");
  }
  fields(c.policy, ["dailyCap", "weeklyCap", "weights"], "policy");
  fields(c.policy.weights, ACTIONS, "weights");
  const weights = Object.fromEntries(ACTIONS.map((k) => [k, Number(uint(c.policy.weights[k], 0xffffffffn))]));
  if (Object.values(weights).some((n) => n === 0)) throw new RangeError("weights must be positive");
  const dailyCap = Number(uint(c.policy.dailyCap, 0xffffffffn)), weeklyCap = Number(uint(c.policy.weeklyCap, 0xffffffffn));
  if (!dailyCap || !weeklyCap) throw new RangeError("caps must be positive");
  return deepFreeze({ network: c.network, arena: key(c.arena), creator: key(c.creator), season: season.toString(),
    arenaSeasonStart, arenaSeasonSeconds, startsAt, endsAt, claimDeadline, asset: c.asset, budgetBaseUnits: uint(c.budgetBaseUnits).toString(),
    policy: { dailyCap, weeklyCap, weights } });
}

/** Account IDs are opaque digests, not wallet ownership or proof of a unique human. */
export function eventPreimage(input) {
  if (input?.type === "credit") {
    fields(input, ["type", "source", "network", "arena", "season", "accountId", "actionId", "action", "occurredAt"], "credit");
    if (!ACTIONS.includes(input.action)) throw new TypeError("unknown native arena action");
  } else if (input?.type === "revoke") {
    fields(input, ["type", "source", "network", "arena", "season", "creditId", "occurredAt"], "revocation");
  } else throw new TypeError("unknown event type");
  if (input.source !== "arena_native" || input.network !== "devnet") throw new TypeError("native devnet events only");
  const base = { type: input.type, source: input.source, network: input.network,
    arena: key(input.arena), season: uint(input.season).toString() };
  const body = input.type === "credit"
    ? { ...base, accountId: hex32(input.accountId), actionId: hex32(input.actionId), action: input.action, occurredAt: timestamp(input.occurredAt) }
    : { ...base, creditId: hex32(input.creditId), occurredAt: timestamp(input.occurredAt) };
  return utf8(`${EVENT_DOMAIN}\n${JSON.stringify(body)}`);
}
export function eventId(event) { return hex(keccak256(eventPreimage(event))); }
function verifiedEvent(signed, c) {
  fields(signed, ["event", "signature"], "signed event");
  const message = eventPreimage(signed.event);
  if (typeof signed.signature !== "string" || !/^[0-9a-f]{128}$/.test(signed.signature)) throw new TypeError("invalid event signature encoding");
  const pub = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(decodePublicKey(c.creator))]), format: "der", type: "spki" });
  if (!verify(null, message, pub, Buffer.from(signed.signature, "hex"))) throw new TypeError("creator signature does not verify");
  const event = JSON.parse(Buffer.from(message).toString().slice(EVENT_DOMAIN.length + 1));
  if (event.arena !== c.arena || event.season !== c.season || event.network !== c.network) throw new TypeError("event belongs to another arena or season");
  if (event.occurredAt < c.startsAt || event.occurredAt >= c.endsAt) throw new RangeError("event outside season");
  return { ...event, id: eventId(event) };
}

function merkle(entries) {
  if (!entries.length) return { root: hex(keccak256(new Uint8Array())), path: () => [] };
  function build(start, end) {
    if (end - start === 1) return { start, end, hash: leafHash(entries[start]) };
    let k = 1; while (k * 2 < end - start) k *= 2;
    const left = build(start, start + k), right = build(start + k, end);
    return { start, end, left, right, hash: nodeHash(left.hash, right.hash) };
  }
  const root = build(0, entries.length);
  function path(index) {
    const out = [];
    function visit(node) {
      if (!node.left) return;
      if (index < node.right.start) { visit(node.left); out.push(hex(node.right.hash)); }
      else { visit(node.right); out.push(hex(node.left.hash)); }
    }
    visit(root); return out;
  }
  return { root: hex(root.hash), path };
}

function payoutCommitment(c, policyHash, row) {
  return hash(PAYOUT_DOMAIN, { network: c.network, arena: c.arena, season: c.season, asset: c.asset,
    policyHash, accountId: row.accountId, points: row.points, amountBaseUnits: row.amountBaseUnits });
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("not JSON data");
}

function rejectionCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("signature")) return "invalid-signature";
  if (message.includes("another arena") || message.includes("another season")) return "wrong-arena-season";
  if (message.includes("outside season")) return "outside-season";
  return "malformed-event";
}

function eventIdOfRaw(raw) { return eventId(raw?.event); }

/**
 * Pure deterministic plan from creator-signed, accepted native actions. The declared budget
 * is NOT evidence of funding. Wallet binding, confirmed funding and on-chain claims are separate.
 * Membership/deposits never enter the API. Unbound accounts retain their allocation.
 */
export function settleSeason(config, signedEvents, { now = Math.floor(Date.now() / 1000) } = {}) {
  const c = normalizeConfig(config);
  if (timestamp(now) < c.endsAt) throw new RangeError("season is still open");
  if (!Array.isArray(signedEvents) || signedEvents.length > 100000) throw new RangeError("invalid event batch size");
  const verified = [], rejected = [], seen = new Set();
  for (const raw of signedEvents) {
    let inputHash;
    try { inputHash = hash("RADIOLAN:ARENA_INPUT_V1", canonicalJson(raw)); }
    catch { inputHash = hash("RADIOLAN:ARENA_INPUT_V1", { unserializable: Object.prototype.toString.call(raw) }); }
    try {
      const e = verifiedEvent(raw, c);
      if (seen.has(e.id)) continue; // at-least-once transport is idempotent
      seen.add(e.id);
      verified.push({ ...e, inputHash });
    } catch (error) {
      let id = null;
      try { id = eventIdOfRaw(raw); } catch { /* malformed rows have only the input digest */ }
      rejected.push({ eventId: id, inputHash, reason: rejectionCode(error) });
    }
  }
  const creditsByLogicalId = new Map(), credits = new Map(), revoked = new Set();
  for (const e of verified.filter((e) => e.type === "credit")) {
    const logicalId = `${e.accountId}:${e.actionId}`;
    const group = creditsByLogicalId.get(logicalId) ?? [];
    group.push(e); creditsByLogicalId.set(logicalId, group);
  }
  for (const group of creditsByLogicalId.values()) {
    if (group.length > 1) {
      for (const e of group) rejected.push({ eventId: e.id, inputHash: e.inputHash, reason: "duplicate-logical-credit" });
    } else credits.set(group[0].id, group[0]);
  }
  for (const e of verified.filter((e) => e.type === "revoke")) {
    const credit = credits.get(e.creditId);
    if (!credit || e.occurredAt < credit.occurredAt) {
      rejected.push({ eventId: e.id, inputHash: e.inputHash, reason: "invalid-revocation" });
      continue;
    }
    revoked.add(e.creditId);
  }
  const scores = new Map(), daily = new Map();
  const sorted = [...credits.values()].sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
  for (const e of sorted) {
    if (revoked.has(e.id)) continue;
    const day = `${e.accountId}:${Math.floor(e.occurredAt / 86400)}`;
    const have = scores.get(e.accountId) ?? 0n, today = daily.get(day) ?? 0n;
    const candidates = [BigInt(c.policy.weights[e.action]), BigInt(c.policy.dailyCap) - today, BigInt(c.policy.weeklyCap) - have];
    const award = candidates.reduce((a, b) => a < b ? a : b);
    scores.set(e.accountId, have + award); daily.set(day, today + award);
  }
  const total = [...scores.values()].reduce((s, p) => s + p, 0n);
  if (total > U64_MAX) throw new RangeError("total points exceed u64");
  const budget = BigInt(c.budgetBaseUnits), policyHash = hash("RADIOLAN:ARENA_POLICY_V1", c.policy);
  const allocations = [...scores].filter(([, p]) => p > 0n).sort(([a], [b]) => a.localeCompare(b)).map(([accountId, points]) => ({
    accountId, points: points.toString(), amountBaseUnits: (budget * points / total).toString(),
  }));
  const allocated = allocations.reduce((s, r) => s + BigInt(r.amountBaseUnits), 0n);
  const commitments = allocations.map((r) => payoutCommitment(c, policyHash, r));
  const tree = merkle(commitments.map(bytes32));
  const rejectedEvents = [...new Map(rejected.map((row) => [`${row.eventId ?? ""}:${row.inputHash}:${row.reason}`, row])).values()]
    .sort((a, b) => (a.eventId ?? "").localeCompare(b.eventId ?? "") || a.inputHash.localeCompare(b.inputHash) || a.reason.localeCompare(b.reason));
  const eventSetHash = hash("RADIOLAN:ARENA_EVENT_SET_V1", { accepted: [...credits.keys(), ...verified.filter((e) => e.type === "revoke" && revoked.has(e.creditId)).map((e) => e.id)].sort(), rejected: rejectedEvents });
  const manifest = { v: 1, planOnly: true, ...c, policyHash, eventSetHash, rejectedEventCount: rejectedEvents.length,
    rejectedEventsHash: hash("RADIOLAN:ARENA_REJECTED_V1", rejectedEvents), totalPoints: total.toString(), fanCount: allocations.length,
    allocatedBaseUnits: allocated.toString(), dustBaseUnits: (budget - allocated).toString(), root: tree.root };
  return deepFreeze({ manifest, rejectedEvents, anchorCommitment: hash(MANIFEST_DOMAIN, manifest),
    receipts: allocations.map((r, index) => ({ ...r, index, treeSize: allocations.length, commitment: commitments[index], path: tree.path(index) })) });
}

function checkedManifest(m) {
  fields(m, ["v", "planOnly", ...CONFIG_FIELDS, "policyHash", "eventSetHash", "rejectedEventCount", "rejectedEventsHash", "totalPoints", "fanCount", "allocatedBaseUnits", "dustBaseUnits", "root"], "manifest");
  const c = normalizeConfig(Object.fromEntries(CONFIG_FIELDS.map((k) => [k, m[k]])));
  if (m.v !== 1 || m.planOnly !== true || m.policyHash !== hash("RADIOLAN:ARENA_POLICY_V1", c.policy)
    || !Number.isSafeInteger(m.fanCount) || m.fanCount < 0 || m.fanCount > 100000) throw new TypeError("invalid manifest");
  hex32(m.root); hex32(m.eventSetHash); hex32(m.rejectedEventsHash);
  if (!Number.isSafeInteger(m.rejectedEventCount) || m.rejectedEventCount < 0 || m.rejectedEventCount > 100000) throw new TypeError("invalid rejected event count");
  const total = uint(m.totalPoints), allocated = uint(m.allocatedBaseUnits), dust = uint(m.dustBaseUnits);
  if (allocated + dust !== BigInt(c.budgetBaseUnits) || (total === 0n) !== (m.fanCount === 0)
    || (m.fanCount === 0 && (allocated !== 0n || m.root !== hex(keccak256(new Uint8Array()))))) throw new TypeError("invalid manifest accounting");
  return c;
}

export function verifySeasonReceipt(manifest, receipt) {
  try {
    const c = checkedManifest(manifest);
    fields(receipt, ["accountId", "points", "amountBaseUnits", "index", "treeSize", "commitment", "path"], "receipt");
    const points = uint(receipt.points), amount = uint(receipt.amountBaseUnits), total = uint(manifest.totalPoints);
    if (points === 0n || total === 0n || points > total || amount !== BigInt(c.budgetBaseUnits) * points / total
      || receipt.treeSize !== manifest.fanCount || !Array.isArray(receipt.path) || receipt.path.length > 32) return false;
    const commitment = payoutCommitment(c, manifest.policyHash, { accountId: hex32(receipt.accountId), points: points.toString(), amountBaseUnits: amount.toString() });
    return commitment === receipt.commitment && verifyInclusion(bytes32(commitment), receipt.index, receipt.treeSize,
      receipt.path.map(bytes32), bytes32(manifest.root));
  } catch { return false; }
}

/** Reserve unpaid entitlements; only mathematical dust is immediately available as carry. */
export function settlementBalances(snapshot, reportedPaidAccounts = [], { now = 0 } = {}) {
  if (!Array.isArray(reportedPaidAccounts) || new Set(reportedPaidAccounts).size !== reportedPaidAccounts.length) throw new TypeError("duplicate or invalid reported claim list");
  fields(snapshot, ["manifest", "anchorCommitment", "rejectedEvents", "receipts"], "snapshot");
  const { manifest: m, receipts, rejectedEvents } = snapshot;
  checkedManifest(m);
  if (snapshot.anchorCommitment !== hash(MANIFEST_DOMAIN, m) || !Array.isArray(receipts) || receipts.length !== m.fanCount
    || !Array.isArray(rejectedEvents) || rejectedEvents.length !== m.rejectedEventCount
    || hash("RADIOLAN:ARENA_REJECTED_V1", rejectedEvents) !== m.rejectedEventsHash) throw new TypeError("snapshot manifest mismatch");
  for (const row of rejectedEvents) {
    fields(row, ["eventId", "inputHash", "reason"], "rejected event");
    if (row.eventId !== null) hex32(row.eventId);
    hex32(row.inputHash);
    if (!["duplicate-logical-credit", "invalid-revocation", "invalid-signature", "wrong-arena-season", "outside-season", "malformed-event"].includes(row.reason)) throw new TypeError("invalid rejected event reason");
  }
  const paidIds = new Set(reportedPaidAccounts), ids = new Set(); let allocated = 0n, paid = 0n, points = 0n;
  for (const r of receipts) {
    if (!verifySeasonReceipt(m, r) || ids.has(r.accountId)) throw new TypeError("invalid or duplicate payout receipt");
    ids.add(r.accountId); allocated += BigInt(r.amountBaseUnits); points += BigInt(r.points);
    if (paidIds.has(r.accountId)) paid += BigInt(r.amountBaseUnits);
  }
  if (reportedPaidAccounts.some((id) => !ids.has(id)) || allocated !== uint(m.allocatedBaseUnits) || points !== uint(m.totalPoints)
    || allocated + uint(m.dustBaseUnits) !== uint(m.budgetBaseUnits)) throw new TypeError("invalid settlement accounting");
  const unpaid = allocated - paid, expired = timestamp(now) >= m.claimDeadline;
  return Object.freeze({ accountingOnly: true, reportedPaidBaseUnits: paid.toString(),
    reservedBaseUnits: (expired ? 0n : unpaid).toString(),
    carryBaseUnits: (uint(m.dustBaseUnits) + (expired ? unpaid : 0n)).toString() });
}
