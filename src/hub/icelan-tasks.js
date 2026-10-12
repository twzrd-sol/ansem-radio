// SPDX-License-Identifier: MIT
// Recorded ICELAN from account tasks, in base units (6 decimals). No token transfer or claim is issued here.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN = 1_000_000n;
export const TASK_AMOUNTS = Object.freeze({ twitch_link: 100n * TOKEN, wallet_link: 100n * TOKEN, chat: 10n * TOKEN });
export const CHAT_DAILY_CAP = 10;
/** Recording limit only. It is not proof that a rewards vault is funded. */
export const ICELAN_POOL = 100_000n * TOKEN;
export const SOURCE_MAX_AGE_SECONDS = 300;
export const SOURCE_FUTURE_SKEW_SECONDS = 60;
const ACCOUNT = /^[0-9a-f]{64}$/;
const EVENT = /^[0-9a-f]{64}$/;
const dayOf = (now) => new Date(now * 1000).toISOString().slice(0, 10);
const validTime = (now) => Number.isSafeInteger(now) && now >= 0 && now <= 8_640_000_000_000;

export function emptyIcelanBook() {
  return { v: 2, seen: {}, earned: {}, pool: "0", chats: {}, tasks: {}, issued: {} };
}

function migrate(book) {
  if (book?.v === 1) {
    const oldKeys = Array.isArray(book.seen)
      ? book.seen
      : book.seen && typeof book.seen === "object" && !Array.isArray(book.seen)
        ? [...(Array.isArray(book.seen.links) ? book.seen.links : []), ...(Array.isArray(book.seen.chats) ? book.seen.chats : [])]
        : null;
    if (!oldKeys) throw new TypeError("unknown icelan task store");
    book.seen = Object.fromEntries(oldKeys.map((key) => [key, true]));
    book.v = 2;
  }
  for (const field of ["seen", "earned", "chats", "tasks"]) {
    if (!book?.[field] || typeof book[field] !== "object" || Array.isArray(book[field])) throw new TypeError("unknown icelan task store");
  }
  if (book.issued == null) book.issued = {};
  else if (typeof book.issued !== "object" || Array.isArray(book.issued)) throw new TypeError("unknown icelan task store");
  for (const [accountId, issued] of Object.entries(book.issued)) {
    if (!ACCOUNT.test(accountId) || typeof issued?.wallet !== "string" || issued.wallet.length < 32 || issued.wallet.length > 44 || !/^[0-9]+$/.test(issued.amount ?? "")) throw new TypeError("unknown icelan task store");
  }
  if (book.v !== 2 || !/^[0-9]+$/.test(book.pool ?? "") || BigInt(book.pool) > ICELAN_POOL) throw new TypeError("unknown icelan task store");
  return book;
}

const IDENTITY_KEY = /^[0-9A-Za-z._-]{1,64}$/;

export function creditIcelanTask(book, { accountId, task, eventId, now, sourceTime, identityKey }) {
  const result = (reason, awarded = "0") => ({ awarded, reason, earned: book.earned?.[accountId] ?? "0" });
  if (typeof accountId !== "string" || !ACCOUNT.test(accountId)) return { awarded: "0", reason: "account_required", earned: "0" };
  if (!Object.hasOwn(TASK_AMOUNTS, task)) return result("task_required");
  if (!validTime(now)) return result("time_required");
  migrate(book);
  const chat = task === "chat";
  if (identityKey !== undefined && (typeof identityKey !== "string" || !IDENTITY_KEY.test(identityKey))) return result("identity_required");
  if (chat && !validTime(sourceTime)) return result("source_time_required");
  if (chat && sourceTime < now - SOURCE_MAX_AGE_SECONDS) return result("stale");
  if (chat && sourceTime > now + SOURCE_FUTURE_SKEW_SECONDS) return result("future");
  if (chat && (typeof eventId !== "string" || !EVENT.test(eventId))) return result("event_required");
  const accountKey = `${accountId}:${task}`;
  const identitySeen = !chat && identityKey ? `${task}:${identityKey}` : null;
  const key = chat ? eventId : (identitySeen ?? accountKey);
  // One-time links survive old replay-id eviction as well as unlink/relink, including a recycled identity.
  if (Object.hasOwn(book.seen, key) || Object.hasOwn(book.seen, accountKey) || (identitySeen && Object.hasOwn(book.seen, identitySeen)) || (!chat && book.tasks[accountId]?.[task] === true)) return result("duplicate");
  const day = dayOf(chat ? sourceTime : now);
  const dayKey = `${accountId}:${day}`;
  const subjectDay = chat && identityKey ? `twitch:${identityKey}:${day}` : null;
  const chats = book.chats[dayKey] ?? 0;
  const subjectChats = subjectDay ? book.chats[subjectDay] ?? 0 : 0;
  if (chat && (chats >= CHAT_DAILY_CAP || subjectChats >= CHAT_DAILY_CAP)) return result("cap");
  const amount = TASK_AMOUNTS[task];
  const earned = BigInt(book.earned[accountId] ?? "0");
  const pool = BigInt(book.pool);
  if (pool + amount > ICELAN_POOL) return result("pool");
  book.seen[key] = true; // Awarded events remain deduplicated for the lifetime of the book.
  if (!chat) book.seen[accountKey] = true;
  if (identitySeen) book.seen[identitySeen] = true;
  if (chat) {
    book.chats[dayKey] = chats + 1;
    if (subjectDay) book.chats[subjectDay] = subjectChats + 1;
  }
  book.earned[accountId] = (earned + amount).toString();
  book.pool = (pool + amount).toString();
  book.tasks[accountId] ??= { twitch_link: false, wallet_link: false, chat: 0 };
  if (chat) book.tasks[accountId].chat += 1;
  else book.tasks[accountId][task] = true;
  return result("credited", amount.toString());
}

export function createIcelanTaskStore({ dir }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "icelan-tasks.json");
  let book = existsSync(path) ? migrate(JSON.parse(readFileSync(path, "utf8"))) : emptyIcelanBook();
  return {
    credit(input) {
      const next = structuredClone(book);
      const result = creditIcelanTask(next, input);
      if (result.reason === "credited") {
        writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
        renameSync(`${path}.tmp`, path);
        book = next; // A failed write must not create an in-memory reward.
      }
      return result;
    },
    view(accountId, now = Math.floor(Date.now() / 1000)) {
      const tasks = book.tasks[accountId] ?? { twitch_link: false, wallet_link: false, chat: 0 };
      const today = validTime(now) ? book.chats[`${accountId}:${dayOf(now)}`] ?? 0 : 0;
      const issued = book.issued?.[accountId] ?? null;
      return {
        earned: book.earned[accountId] ?? "0", pool: book.pool, poolCap: ICELAN_POOL.toString(),
        claim: "unavailable", today, dailyCap: CHAT_DAILY_CAP,
        // The wallet the station's claim signatures are bound to, and the largest cumulative amount it signed.
        // Issued means co-signed by the station, not broadcast, confirmed, or paid.
        claimWallet: issued?.wallet ?? null, issuedCumulative: issued?.amount ?? null,
        tasks: [
          { id: "twitch_link", amount: TASK_AMOUNTS.twitch_link.toString(), done: tasks.twitch_link === true },
          { id: "wallet_link", amount: TASK_AMOUNTS.wallet_link.toString(), done: tasks.wallet_link === true },
          { id: "chat", amount: TASK_AMOUNTS.chat.toString(), done: tasks.chat > 0, count: tasks.chat },
        ],
      };
    },
    claimIssued(accountId) {
      return book.issued?.[accountId] ? { ...book.issued[accountId] } : null;
    },
    /**
     * Bind the account's claims to one wallet at the first co-sign and record the largest cumulative amount signed.
     * Returns null for a different wallet, false for a cumulative amount below the one already signed (earned only
     * grows, so that is a changed book, not a claim), and the issued record otherwise.
     */
    lockClaim(accountId, wallet, amount) {
      if (typeof accountId !== "string" || !ACCOUNT.test(accountId)) throw new TypeError("hub account id required");
      if (typeof wallet !== "string" || wallet.length < 32 || wallet.length > 44) throw new TypeError("claim wallet required");
      if ((typeof amount !== "string" && typeof amount !== "bigint") || !/^[0-9]+$/.test(String(amount))) throw new TypeError("claim amount required");
      const cumulative = BigInt(amount);
      migrate(book);
      const prior = book.issued[accountId];
      if (prior && prior.wallet !== wallet) return null;
      if (prior && cumulative < BigInt(prior.amount)) return false;
      const next = structuredClone(book);
      next.issued[accountId] = { wallet, amount: cumulative.toString() };
      writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      book = next;
      return next.issued[accountId];
    },
    /** All booked balances. Used to plan a season-end payout. Does not transfer. */
    snapshot() {
      return { earned: { ...book.earned }, pool: book.pool ?? "0", poolCap: ICELAN_POOL.toString(), claim: "season_end" };
    },
  };
}
