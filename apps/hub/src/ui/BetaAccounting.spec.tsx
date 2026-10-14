import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BetaAccounting } from "./BetaAccounting";

const market = { network: "mainnet" as const, stale: false, observedAt: "2026-10-13T23:00:00Z" };
describe("beta accounting at arrival", () => {
  it("identifies separate resources when the season and backing networks differ", () => {
    const html = renderToStaticMarkup(<BetaAccounting season={{ network: "devnet" }} market={market} />);
    expect(html).toContain("Season record: Solana devnet");
    expect(html).toContain("Backing records: Solana mainnet");
    expect(html).toContain("Back a channel with $RLAN");
    expect(html).toContain("Radio LAN is a controlled beta for discovery, sign-in, free seasons, and points.");
    expect(html).toContain("Tokens can go to zero. Mint and freeze authorities are revoked. One operator key can upgrade the programs.");
    expect(html).not.toContain("Deposits are not part of this beta");
    expect(html).toContain("Recorded ICELAN is an account-task ledger amount");
    expect(html).toContain("does not multiply ICELAN task amounts");
    expect(html).toContain("Play free");
    expect(html).not.toMatch(/\/go\/buy|#\/back|#\/claim|100,000/);
  });
  it("does not infer a network from frontend configuration or an unavailable read", () => {
    const html = renderToStaticMarkup(<BetaAccounting market={{ ...market, stale: true }} />);
    expect(html).toContain("Season network is not available yet");
    expect(html).toContain("Backing network awaits a fresh read");
    expect(html).not.toContain("Solana mainnet");
  });
});
