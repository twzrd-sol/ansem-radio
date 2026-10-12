import { describe, expect, it } from "vitest";

import { activitySparkline, capHistory, reduceTape } from "./board";
import { demoEvents, DEMO_CHANNELS } from "./demo";
import type { TapeEvent } from "./events";

describe("activity tape reduction", () => {
  it("sparklines activity counts, not totals", () => {
    expect(activitySparkline([1])).toBeNull();
    expect(activitySparkline([1, 3, 2])).toMatch(/^\d/);
  });

  it("caps history and builds a ticker of classified arena activity only", () => {
    expect(capHistory([1, 2, 3, 4], 2)).toEqual([3, 4]);
    const board = reduceTape(DEMO_CHANNELS, demoEvents());
    expect(board.ticker[0]?.text).toMatch(/LAN West · slot 512,406 · Deposit · comes back 1:1/);
    expect(board.channels[0]?.events).toBeGreaterThan(0);
    expect(board.channels[0]?.spark.length).toBeGreaterThan(0);
    expect(JSON.stringify(board)).not.toMatch(/Raydium|price|APY|yield|reward source/i);
  });

  it("does not put a generic log on the ticker", () => {
    const stray = { id: "x", kind: "deposit", slot: 1, at: 1, channel: "Radio LAN", slug: "radiolanlive", summary: "Deposit · comes back 1:1 · 1 participant" } as TapeEvent;
    const board = reduceTape(DEMO_CHANNELS, [stray]);
    expect(board.ticker).toHaveLength(1);
    expect(board.ticker[0]?.text).toContain("Deposit");
  });
});
