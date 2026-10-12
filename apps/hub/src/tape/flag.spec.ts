import { afterEach, describe, expect, it, vi } from "vitest";

import { marketBoardEnabled } from "./flag";

describe("market board flag", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stays off on devnet unless the flag is set, and is on for a mainnet build", () => {
    expect(marketBoardEnabled({}, false)).toBe(false);
    expect(marketBoardEnabled({ VITE_HUB_MARKET_BOARD: "0" }, false)).toBe(false);
    expect(marketBoardEnabled({}, true)).toBe(true);
    expect(marketBoardEnabled({ VITE_HUB_MARKET_BOARD: "0" }, true)).toBe(true);
  });

  it("turns on for a devnet build when VITE_HUB_MARKET_BOARD=1", () => {
    expect(marketBoardEnabled({ VITE_HUB_MARKET_BOARD: "1" }, false)).toBe(true);
  });
});
