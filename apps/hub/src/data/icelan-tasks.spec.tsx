import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fetchIcelanTasks, parseIcelanTasks, type IcelanTasksView } from "./icelan-tasks";
import { TaskRecord } from "../ui/IcelanTasks";
import { SupportStatus } from "../ui/SupportStatus";
import { RLAN_MINT } from "../chain/config";
import type { Market } from "./market";
import { buildSample } from "./sample";
import { Play } from "../screens/Play";

const accountId = "a".repeat(64);
const now = Date.parse("2026-10-07T17:00:00Z");
const view: IcelanTasksView = {
  accountId, earned: "210000000", pool: "210000000", poolCap: "100000000000", claim: "unavailable",
  claimWallet: null, issuedCumulative: null, chatEnabled: true, today: 1, dailyCap: 10,
  tasks: [{ id: "twitch_link", amount: "100000000", done: true }, { id: "wallet_link", amount: "100000000", done: true }, { id: "chat", amount: "10000000", done: true, count: 1 }],
};
const market: Market = { network: "mainnet", observedAt: new Date(now).toISOString(), slot: 454_000_000, stale: false, generatedAt: now / 1000, listings: [{
  slug: "radiolanlive", name: "Radio LAN", kind: "featured", demo: false, blurb: null, twitch: "radiolanlive", keys: null, backingOpen: true, performance: null,
  arena: { address: "5PXzDwSwVu9xYMRT9QS6c5m6dapb4oGVGQc99azS2XVq", streamer: "streamer", mint: RLAN_MINT, decimals: 6, closed: false, seasonStart: "0", seasonSeconds: "604800", season: "1", total: "85527609857", backers: "1", requested: 0, netFlow: null },
}] };
const text = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("recorded account rewards", () => {
  it("shows the task total and UTC cap without promising funded claims or a wallet balance", () => {
    const html = text(<TaskRecord view={view} />);
    expect(html).toContain("210 ICELAN recorded");
    expect(html).toContain("1 of 10 today");
    expect(html).toContain("Recorded now. Check Collect for claim availability.");
    expect(html).toContain("The mainnet vault was funded with 100,000 ICELAN on October 7, 2026.");
    expect(html).toContain("Data: Twitch");
    expect(html).toContain("Twitch account link");
    expect(html).toContain("observed on the channel");
    expect(html).not.toMatch(/wallet balance/i);
    expect(html).not.toMatch(/can be claimed/);
    const unavailableLink = text(<TaskRecord view={{ ...view, tasks: view.tasks.map((task) => task.id === "twitch_link" ? { ...task, done: false } : task) }} />);
    expect(unavailableLink).toContain("One-time task · check Profile for availability");
    expect(text(<TaskRecord view={{ ...view, claim: "task_book" }} />)).toContain("Recorded now. Check Collect for claim availability");
    expect(text(<TaskRecord view={{ ...view, claim: "task_book" }} />)).not.toContain("Claims are open at Collect");
    expect(text(<TaskRecord view={{ ...view, claim: "task_book" }} claims={{ claimFlag: true }} />)).not.toContain("Claims are open at Collect");
    expect(text(<TaskRecord view={{ ...view, claim: "task_book" }} claims={{ dayZero: true, claimFlag: true }} />)).toContain("Claims are open at Collect when your wallet passes the on-chain checks");
    expect(text(<TaskRecord view={{ ...view, chatEnabled: false }} />)).toContain("Chat recording is paused");
  });
  it("refuses malformed amounts, duplicate task rows, and records for another account", () => {
    expect(parseIcelanTasks(view, accountId)).toEqual(view);
    for (const body of [{ ...view, earned: "-1" }, { ...view, earned: "Infinity" }, { ...view, earned: "210000001" }, { ...view, pool: "100000000001" }, { ...view, today: 11 }, { ...view, tasks: [view.tasks[0], view.tasks[0], view.tasks[2]] }]) {
      expect(() => parseIcelanTasks(body, accountId)).toThrow();
    }
    expect(() => parseIcelanTasks(view, "b".repeat(64))).toThrow("account changed");
  });
  it("reads the bound claim wallet and the co-signed cumulative together, and shows them as issued, not paid", () => {
    const wallet = "7VeGFMgoAkY9DwkxhY84GksMPNugJNWwSvdXn5yyZuAH";
    const bound = { ...view, claimWallet: wallet, issuedCumulative: "200000000" };
    expect(parseIcelanTasks(bound, accountId)).toEqual(bound);
    expect(parseIcelanTasks({ ...view, claimWallet: undefined, issuedCumulative: undefined }, accountId)).toEqual(view);
    for (const body of [{ ...bound, issuedCumulative: null }, { ...bound, claimWallet: null }, { ...bound, claimWallet: "not-base58-0OIl" }, { ...bound, issuedCumulative: "210000001" }, { ...bound, issuedCumulative: "-1" }]) {
      expect(() => parseIcelanTasks(body, accountId)).toThrow();
    }
    const html = text(<TaskRecord view={bound} />);
    expect(html).toContain(wallet);
    expect(html).toContain("co-signed up to 200 ICELAN");
    expect(html).toContain("on-chain claim record to show confirmed paid amounts");
    expect(html).not.toMatch(/\bpaid out\b|\bsent to your wallet\b/i);
    expect(text(<TaskRecord view={view} />)).not.toContain("Claim wallet");
  });
  it("propagates expiry and a changed account without returning another user's recorded amount", async () => {
    await expect(fetchIcelanTasks(accountId, undefined, async () => new Response("{}", { status: 401 }))).rejects.toMatchObject({ status: 401 });
    await expect(fetchIcelanTasks("b".repeat(64), undefined, async () => new Response(JSON.stringify(view)))).rejects.toThrow("account changed");
  });
  it("shows mainnet deposits separately and hides the support action on stale, wrong-network, or closed reads", () => {
    const html = renderToStaticMarkup(<SupportStatus market={market} now={now} />);
    expect(text(<SupportStatus market={market} now={now} />)).toContain("85,527.609857 RLAN");
    expect(html).toContain('href="#/back/radiolanlive"');
    expect(html).not.toContain("cluster=devnet");
    expect(renderToStaticMarkup(<SupportStatus market={{ ...market, observedAt: new Date(now - 299000).toISOString() }} now={now} />)).toContain('href="#/back/radiolanlive"');
    for (const data of [{ ...market, stale: true }, { ...market, network: "devnet" }, { ...market, observedAt: new Date(now - 601000).toISOString() }]) {
      const closed = renderToStaticMarkup(<SupportStatus market={data} now={now} />);
      expect(closed).not.toContain('href="#/back/radiolanlive"');
      expect(closed).not.toContain("85,527");
    }
    const closed = { ...market, listings: [{ ...market.listings[0]!, backingOpen: false, arena: { ...market.listings[0]!.arena!, closed: true } }] };
    expect(renderToStaticMarkup(<SupportStatus market={closed} now={now} />)).not.toContain('href="#/back/radiolanlive"');
  });
  it("shows boosted Play values only within the remaining daily and season caps", () => {
    const snap = buildSample(now);
    snap.season!.me!.supportBoost = 2;
    snap.season!.me!.today = snap.season!.policy.dailyCap - 3;
    const html = text(<Play snapshot={snap} load="ready" now={now} joined submit={async () => {}} toast={() => {}} onJoin={() => {}} onRetry={() => {}} />);
    expect(html).toContain("Your 2× Play boost is active");
    expect(html).toContain("+3");
    expect(html).not.toMatch(/\+40|\+80/);
  });
});
