import { API_BASE, HubApiError } from "./api";

export type TaskId = "twitch_link" | "wallet_link" | "chat";
export interface IcelanTasksView {
  accountId: string;
  earned: string;
  pool: string;
  poolCap: string;
  claim: "unavailable" | "season_end" | "task_book";
  /** The wallet the station's claim signatures are bound to, or null before any co-sign. */
  claimWallet: string | null;
  /** The largest cumulative amount the station co-signed for that wallet. Issued, not broadcast or paid. */
  issuedCumulative: string | null;
  chatEnabled: boolean;
  today: number;
  dailyCap: number;
  tasks: Array<{ id: TaskId; amount: string; done: boolean; count?: number }>;
}
const ids: TaskId[] = ["twitch_link", "wallet_link", "chat"];
const amount = (value: unknown): value is string => typeof value === "string" && /^[0-9]+$/.test(value);

export function parseIcelanTasks(body: unknown, accountId: string): IcelanTasksView {
  if (!body || typeof body !== "object") throw new Error("Task records couldn't be read.");
  const v = body as Record<string, unknown>;
  if (v.accountId !== accountId) throw new Error("Your account changed. Sign in again on Profile.");
  if (!amount(v.earned) || !amount(v.pool) || !amount(v.poolCap) || !["unavailable", "season_end", "task_book"].includes(String(v.claim))
    || typeof v.chatEnabled !== "boolean" || !Number.isSafeInteger(v.today) || !Number.isSafeInteger(v.dailyCap)
    || Number(v.today) < 0 || Number(v.dailyCap) < 1 || Number(v.today) > Number(v.dailyCap)
    || !Array.isArray(v.tasks) || v.tasks.length !== ids.length) throw new Error("Task records couldn't be read.");
  if (BigInt(v.earned) > BigInt(v.pool) || BigInt(v.pool) > BigInt(v.poolCap)) throw new Error("Task records couldn't be read.");
  const claimWallet = v.claimWallet == null ? null : v.claimWallet;
  const issuedCumulative = v.issuedCumulative == null ? null : v.issuedCumulative;
  if ((claimWallet !== null && (typeof claimWallet !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(claimWallet)))
    || (issuedCumulative !== null && !amount(issuedCumulative)) || (claimWallet === null) !== (issuedCumulative === null)
    || (issuedCumulative !== null && BigInt(issuedCumulative) > BigInt(v.earned))) throw new Error("Task records couldn't be read.");
  const tasks = ids.map((id) => {
    const rows = (v.tasks as Array<Record<string, unknown>>).filter((row) => row && row.id === id);
    const row = rows[0];
    if (rows.length !== 1 || !row || !amount(row.amount) || typeof row.done !== "boolean"
      || (id === "chat" && (!Number.isSafeInteger(row.count) || Number(row.count) < 0))) throw new Error("Task records couldn't be read.");
    return { id, amount: row.amount, done: row.done, ...(id === "chat" ? { count: Number(row.count) } : {}) };
  });
  return { accountId, earned: v.earned, pool: v.pool, poolCap: v.poolCap, claim: v.claim as IcelanTasksView["claim"],
    claimWallet, issuedCumulative, chatEnabled: v.chatEnabled, today: Number(v.today), dailyCap: Number(v.dailyCap), tasks };
}

export async function fetchIcelanTasks(accountId: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${API_BASE}/icelan-tasks`, { credentials: "same-origin", cache: "no-store", signal });
  if (response.status === 401) throw new HubApiError(401, "sign_in_required");
  if (!response.ok) throw new Error("Task records couldn't be read. Try again.");
  return parseIcelanTasks(await response.json(), accountId);
}
