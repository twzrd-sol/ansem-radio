import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The hosted hub is a mainnet build. While no listing has an open arena, no screen may say or imply that backing works.
const mainnet = async () => {
  vi.resetModules();
  vi.stubEnv("VITE_HUB_NETWORK", "mainnet");
  const [app, how, season, config, brand] = await Promise.all([import("./App"), import("../ui/HowItWorks"), import("../ui/SeasonCard"), import("../chain/config"), import("../brand")]);
  expect(config.IS_MAINNET).toBe(true);
  return { app, how, season, brand };
};
const text = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("mainnet build copy while no arena is open", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("the ribbon says the board is mainnet data and that backing is not available", async () => {
    const { app } = await mainnet();
    const closed = text(<app.Ribbon />);
    expect(closed).toMatch(/Mainnet board/);
    expect(closed).toMatch(/No mainnet arena is open, so backing is not available here/);
    expect(closed).not.toMatch(/Real \$RLAN|support account|optional/);
    expect(text(<app.Ribbon backingOpen />)).toMatch(/Backing is open for listed creators/);
  });

  it("the guide, the tagline and the season card do not offer backing", async () => {
    const { how, season, brand } = await mainnet();
    const guide = text(<how.HowItWorks />);
    expect(guide).toMatch(/No mainnet arena is open on this hub\. Backing is not available yet/);
    expect(guide).not.toMatch(/Back them with RLAN|Backing uses|You can commit RLAN/);
    expect(brand.BRAND.tagline).not.toMatch(/back the ones|believe in/i);
    expect(text(<season.SeasonNotOpen />)).toMatch(/Backing Not open No mainnet arena is open/);
    expect(text(<season.SeasonNotOpen backingOpen />)).toMatch(/Backing Open/);
  });

  it("no arena setup is offered on a mainnet build", async () => {
    const { app } = await mainnet();
    expect(app.canSetUp({ kind: "featured" } as never, "radiolanlive")).toBe(false);
    expect(app.canSetUp(null, "radiolanlive")).toBe(false);
  });
});
