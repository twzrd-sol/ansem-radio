import { describe, expect, it } from "vitest";

import { ago, formatTwitchProvenance, tokenAmount, units } from "./format";

const NOW = Date.parse("2026-10-07T15:49:48.355Z");

describe("Twitch provenance timestamps", () => {
  it("replaces a trailing ISO instant with relative time and keeps the exact UTC for a title", () => {
    const line = "Data: Twitch. Recorded by radiolanlive at 2026-10-07T15:49:48.355Z.";
    expect(formatTwitchProvenance(line, NOW)).toEqual({
      label: "Data: Twitch. Recorded by radiolanlive at just now.",
      exact: "Wed 7 Oct 2026, 15:49 UTC",
    });
    expect(formatTwitchProvenance(line, NOW + 6 * 60_000).label).toBe("Data: Twitch. Recorded by radiolanlive at 6 min ago.");
    expect(formatTwitchProvenance("Data: Twitch. Recorded by Radio LAN.", NOW)).toEqual({ label: "Data: Twitch. Recorded by Radio LAN." });
  });

  it("shows compact token amounts and keeps full precision in the title", () => {
    const deposited = 85_527_609_857n;
    expect(units(deposited, 6)).toBe("85,527.609857");
    expect(tokenAmount(deposited, 6)).toEqual({ label: "85.5K", title: "85,527.609857" });
    expect(tokenAmount(12_400_000_000n, 6)).toEqual({ label: "12.4K", title: "12,400" });
    expect(tokenAmount(4_210_000_000n, 6)).toEqual({ label: "4,210", title: "4,210" });
    expect(tokenAmount(850_000_000n, 6)).toEqual({ label: "850", title: "850" });
    expect(tokenAmount(0n, 6)).toEqual({ label: "0", title: "0" });
  });

  it("names short ages the way ObservedLine already does", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(59_000)).toBe("just now");
    expect(ago(60_000)).toBe("1 min ago");
    expect(ago(3 * 3_600_000)).toBe("3 h ago");
  });
});
