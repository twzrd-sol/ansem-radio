import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mainnet copy keeps the devnet points season and live locker status clearly separate.
const mainnet = async () => {
  vi.resetModules();
  vi.stubEnv("VITE_HUB_NETWORK", "mainnet");
  const [app, how, season, config, brand] = await Promise.all([import("./App"), import("../ui/HowItWorks"), import("../ui/SeasonCard"), import("../chain/config"), import("../brand")]);
  expect(config.IS_MAINNET).toBe(true);
  return { app, how, season, brand };
};
const text = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("mainnet build copy and staged rewards", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("the ribbon says the board is mainnet data and that backing is not available", async () => {
    const { app } = await mainnet();
    const closed = text(<app.Ribbon />);
    expect(closed).toMatch(/Mainnet board/);
    expect(closed).toMatch(/No mainnet arena is open, so backing is not available here/);
    expect(closed).not.toMatch(/Real \$RLAN|support account|optional/);
    expect(text(<app.Ribbon backingOpen />)).toMatch(/Backing is open for listed creators/);
    expect(text(<app.Ribbon backingOpen openFor={["Radio LAN"]} />)).toMatch(/Backing is open for Radio LAN\./);
    expect(text(<app.Ribbon backingOpen openFor={["Radio LAN", "Crate Breed"]} />)).toMatch(/open for Radio LAN and Crate Breed\./);
    expect(app.openForLabel(["a", "b", "c"])).toBe("3 listed creators");
    expect(app.openForLabel([])).toBe("listed creators");
  });

  it("the guide states the current points network, funded vault and gated claim status", async () => {
    const { how, season, brand } = await mainnet();
    const guide = text(<how.HowItWorks />);
    expect(guide).toMatch(/current points season is on devnet/);
    expect(guide).toMatch(/No mainnet points season is open/);
    expect(guide).toMatch(/The mainnet vault was funded with 100,000 ICELAN on October 7, 2026/);
    expect(guide).toMatch(/Recorded now\. Check Collect for claim availability/);
    expect(guide).toContain("Profile shows whether chat recording is on today and your count, labelled Data: Twitch.");
    expect(guide).not.toContain("Chat recording is off today.");
    expect(guide).toMatch(/Current board status: no open locker confirmed/);
    expect(guide).toMatch(/RLAN backing is live when a fresh board read shows an open locker/);
    expect(guide).not.toMatch(/Backing is not available yet/);
    expect(text(<how.HowItWorks backingOpen />)).toMatch(/Current board status: open for listed creators/);
    expect(text(<how.HowItWorks backingOpen openFor={["Radio LAN"]} />)).toMatch(/Current board status: open for Radio LAN\./);
    expect(brand.BRAND.tagline).not.toMatch(/back the ones|believe in/i);
    expect(text(<season.SeasonNotOpen />)).toContain("Support isn't open yet. Playing is free.");
    expect(text(<season.SeasonNotOpen backingOpen />)).toMatch(/Support Open/);
  });

  it("no arena setup is offered on a mainnet build", async () => {
    const { app } = await mainnet();
    expect(app.canSetUp({ kind: "featured" } as never, "radiolanlive")).toBe(false);
    expect(app.canSetUp(null, "radiolanlive")).toBe(false);
  });
  it("a joined streamer's page offers no arena creation on a mainnet build", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_HUB_NETWORK", "mainnet");
    const { YourPageView } = await import("../ui/YourPage");
    const listing = { slug: "ninja", name: "ninja", kind: "tracked", demo: false, blurb: "", twitch: "ninja", claimed: true, claimDerived: true, keys: { streamer: "S", mint: "M" }, backingOpen: false, arena: null, performance: null } as never;
    for (const claim of [{ slug: "ninja", wallet: null, ready: false, reason: "wallet_link_required" }, { slug: "ninja", wallet: "W", ready: true }] as never[]) {
      const page = text(<YourPageView claim={claim} listing={listing} />);
      expect(page).toContain("Arena creation is not available on this mainnet hub. Check this listing's locker for backing status.");
      expect(page).toContain("Backing does not add season points by itself.");
      expect(page).not.toMatch(/Create the arena|Create your arena|Two steps open it for backing/);
    }
  });
});
