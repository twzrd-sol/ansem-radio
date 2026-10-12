import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ICELAN_DAY_ZERO_BASE_UNITS } from "../../../../src/hub/day-zero.js";
import { TASK_AMOUNTS } from "../../../../src/hub/icelan-tasks.js";
import { Claim } from "../screens/Claim";
import { buildSample } from "../data/sample";
import { RevenueStory } from "./RevenueStory";

const NOW = Date.parse("2026-10-07T16:00:00Z");
const sample = buildSample(NOW);
const claimWallet = "7VeGFMgoAkY9DwkxhY84GksMPNugJNWwSvdXn5yyZuAH";
const accountId = "a".repeat(64);
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => html(el).replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ");

describe("ICELAN vault display", () => {
  it("keeps the default lane funded and collect closed", () => {
    const page = text(<RevenueStory />);
    expect(page).toContain("The mainnet vault was funded with 100,000 ICELAN on October 7, 2026.");
    expect(page).toContain("Recorded now. Check Collect for claim availability.");
    expect(page).toMatch(/collect not open/i);
    expect(page).not.toMatch(/isn't created|isn't funded|not funded|not created/i);
    expect(page).not.toMatch(/can be claimed/);
  });

  it("reads a funded vault without calling it open, ready, or claimable", () => {
    const page = text(<RevenueStory vault={{ status: "funded", fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS }} />);
    expect(page).toContain("100,000");
    expect(page).toContain("Recorded now. Check Collect for claim availability.");
    expect(page).toMatch(/collect not open/i);
    expect(page).not.toMatch(/vault (?:is )?(?:open|ready|claimable)/i);
  });

  it("previews the task-book amount, not season points, when day-zero is shown", () => {
    expect(text(<Claim snapshot={sample} load="ready" onRetry={() => {}} />)).toMatch(/Recorded now\. ICELAN claims are not open on this page yet/);
    expect(text(<Claim snapshot={sample} load="ready" onRetry={() => {}} />)).not.toMatch(/Check Collect/);
    const shown = text(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan book={{ accountId, earned: TASK_AMOUNTS.twitch_link, pool: TASK_AMOUNTS.twitch_link, poolCap: ICELAN_DAY_ZERO_BASE_UNITS, claimWallet: null, issuedCumulative: null }} vault={{ status: "funded", fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS }} />);
    expect(shown).toMatch(/Recorded now\. ICELAN claims are not open on this page yet/);
    expect(shown).toContain("100");
    expect(shown).toContain("100,000");
    expect(shown).toMatch(/Season points are not converted again/);
    expect(shown).not.toMatch(/vault (?:is )?(?:open|ready|claimable)/i);
    expect(html(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim book={{ accountId, earned: 0n, pool: 0n, poolCap: ICELAN_DAY_ZERO_BASE_UNITS, claimWallet: null, issuedCumulative: null }} />)).not.toMatch(/Claim ICELAN/);
    const needsWallet = html(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim book={{ accountId, earned: TASK_AMOUNTS.twitch_link, pool: TASK_AMOUNTS.twitch_link, poolCap: ICELAN_DAY_ZERO_BASE_UNITS, claimWallet: null, issuedCumulative: null }} vault={{ status: "funded", fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS }} />);
    expect(needsWallet).toMatch(/Connect linked wallet/);
    expect(needsWallet).toMatch(/href="#\/me"/);
    expect(needsWallet).not.toMatch(/href="#\/profile"/);
    expect(needsWallet).not.toMatch(/Claim ICELAN/);
    const open = html(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim walletReady wallet={claimWallet} alreadyClaimed={0n} book={{ accountId, earned: TASK_AMOUNTS.twitch_link, pool: TASK_AMOUNTS.twitch_link, poolCap: ICELAN_DAY_ZERO_BASE_UNITS, claimWallet: null, issuedCumulative: null }} vault={{ status: "funded", fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS }} />);
    expect(open).toMatch(/<button class="btn" type="button">Claim ICELAN/);
    expect(open).not.toMatch(/<button[^>]*disabled[^>]*>Claim ICELAN/);
    expect(text(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim book={{ accountId, earned: TASK_AMOUNTS.twitch_link, pool: TASK_AMOUNTS.twitch_link, poolCap: ICELAN_DAY_ZERO_BASE_UNITS, claimWallet: null, issuedCumulative: null }} vault={{ status: "funded", fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS }} />)).not.toMatch(/Claims open at season end/);
  });

  it("shows newly collectable after subtracting on-chain claimed, and says when nothing is new", () => {
    const booked = TASK_AMOUNTS.twitch_link + TASK_AMOUNTS.wallet_link + TASK_AMOUNTS.chat;
    const funded = { status: "funded" as const, fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS };
    const book = { accountId, earned: booked, pool: booked, poolCap: ICELAN_DAY_ZERO_BASE_UNITS, claimWallet, issuedCumulative: 200_000_000n };
    const leftover = text(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim walletReady wallet={claimWallet} book={book} vault={funded} alreadyClaimed={200_000_000n} />);
    expect(leftover).toMatch(/Newly collectable: 10 ICELAN/);
    expect(leftover).toMatch(/Recorded from account tasks: 210 ICELAN/);
    expect(leftover).toMatch(/Station co-signed 200 ICELAN/);
    expect(leftover).toMatch(/Confirmed paid on chain: 200 ICELAN/);
    expect(html(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim walletReady wallet={claimWallet} book={book} vault={funded} alreadyClaimed={200_000_000n} />)).toMatch(/<button class="btn" type="button">Claim ICELAN/);
    const done = html(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim walletReady wallet={claimWallet} book={book} vault={funded} alreadyClaimed={booked} />);
    expect(text(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim walletReady wallet={claimWallet} book={book} vault={funded} alreadyClaimed={booked} />)).toMatch(/Nothing new to collect/);
    expect(done).toMatch(/<button[^>]*disabled=""[^>]*>Nothing new to collect/);
    expect(done).not.toMatch(/>Claim ICELAN</);
  });

  it("does not treat a failed claimed read as zero remaining", () => {
    const booked = TASK_AMOUNTS.twitch_link + TASK_AMOUNTS.wallet_link + TASK_AMOUNTS.chat;
    const funded = { status: "funded" as const, fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS };
    const book = { accountId, earned: booked, pool: booked, poolCap: ICELAN_DAY_ZERO_BASE_UNITS, claimWallet, issuedCumulative: 100_000_000n };
    const unread = html(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim walletReady wallet={claimWallet} book={book} vault={funded} claimedRead="error" />);
    expect(text(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim walletReady wallet={claimWallet} book={book} vault={funded} claimedRead="error" />)).toMatch(/Confirmed paid amount: unknown/);
    expect(unread).toMatch(/<button[^>]*disabled=""[^>]*>Unable to read claimed amount/);
    expect(unread).not.toMatch(/Newly collectable:/);
    expect(unread).not.toMatch(/>Claim ICELAN</);
  });

  it("keeps a co-sign distinct from paid chain state and hides that state for a different wallet", () => {
    const booked = TASK_AMOUNTS.twitch_link + TASK_AMOUNTS.wallet_link;
    const book = { accountId, earned: booked, pool: booked, poolCap: ICELAN_DAY_ZERO_BASE_UNITS, claimWallet, issuedCumulative: booked };
    const funded = { status: "funded" as const, fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS };
    const pending = text(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim walletReady wallet={claimWallet} book={book} vault={funded} alreadyClaimed={0n} />);
    expect(pending).toMatch(/Station co-signed 200 ICELAN/);
    expect(pending).toMatch(/Confirmed paid on chain: 0 ICELAN/);
    expect(pending).toMatch(/Newly collectable: 200 ICELAN/);
    const otherWallet = text(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim walletReady wallet="11111111111111111111111111111111" book={book} vault={funded} alreadyClaimed={0n} />);
    expect(otherWallet).toMatch(/does not match the bound claim wallet/);
    expect(otherWallet).not.toMatch(/Confirmed paid on chain: 0 ICELAN/);
    expect(html(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim walletReady wallet="11111111111111111111111111111111" book={book} vault={funded} alreadyClaimed={0n} />)).toMatch(/disabled/);
    // App may still pass its givenWallet fallback after session.wallet is cleared.
    // A stale fallback address must not identify the paid read or enable a claim.
    const disconnected = html(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim wallet={claimWallet} book={book} vault={funded} alreadyClaimed={0n} />);
    expect(text(<Claim snapshot={sample} load="ready" onRetry={() => {}} showIcelan showIcelanClaim wallet={claimWallet} book={book} vault={funded} alreadyClaimed={0n} />)).toMatch(/unknown until a linked wallet is connected/);
    expect(disconnected).not.toMatch(/Confirmed paid on chain: 0 ICELAN/);
    expect(disconnected).not.toMatch(/Refresh on-chain paid status/);
    expect(disconnected).not.toMatch(/>Claim ICELAN</);
    expect(disconnected).toMatch(/Connect linked wallet/);
    const previousAccount = text(<Claim snapshot={sample} load="ready" onRetry={() => {}} accountId={"b".repeat(64)} showIcelan showIcelanClaim walletReady wallet={claimWallet} book={book} vault={funded} alreadyClaimed={0n} />);
    expect(previousAccount).toContain("Recorded task total is unavailable");
    expect(previousAccount).not.toContain("Station co-signed 200 ICELAN");
  });

  it("keeps the first funded claim available before the station creates its wallet binding", () => {
    const html = renderToStaticMarkup(<Claim snapshot={sample} load="ready" onRetry={() => {}} accountId={accountId} showIcelan showIcelanClaim walletReady wallet={claimWallet}
      book={{ accountId, earned: TASK_AMOUNTS.wallet_link, pool: TASK_AMOUNTS.wallet_link, poolCap: ICELAN_DAY_ZERO_BASE_UNITS, claimWallet: null, issuedCumulative: null }}
      vault={{ status: "funded", fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS }} />);
    expect(html).toMatch(/<button class="btn" type="button">Claim ICELAN/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Claim ICELAN/);
    expect(text(<Claim snapshot={sample} load="ready" onRetry={() => {}} accountId={accountId} showIcelan showIcelanClaim walletReady wallet={claimWallet}
      book={{ accountId, earned: TASK_AMOUNTS.wallet_link, pool: TASK_AMOUNTS.wallet_link, poolCap: ICELAN_DAY_ZERO_BASE_UNITS, claimWallet: null, issuedCumulative: null }}
      vault={{ status: "funded", fundedBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS }} />)).toMatch(/Confirmed paid amount is unknown until the station co-signs/);
  });
});
