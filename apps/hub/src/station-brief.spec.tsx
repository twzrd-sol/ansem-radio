import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Station } from "./data/station";
import { sampleMarket } from "./data/sample";
import { StationBrief } from "./ui/StationBrief";

const NOW = Date.parse("2026-10-03T14:00:00Z");
const page = (station: Station, sample = false) => renderToStaticMarkup(<StationBrief station={station} market={sampleMarket(NOW)} now={NOW} sample={sample} />);

describe("LAN station brief", () => {
  it("shows only current station status with Twitch attribution", () => {
    const html = page({ status: "ready", live: false, observedAt: NOW - 60_000 });
    expect(html).toContain("The station is offline.");
    expect(html).toContain("Data: Twitch");
    expect(html).not.toContain("viewer");
    expect(html).not.toContain("history");
    expect(html).toContain('href="#/play"');
  });
  it("does not turn a missing observation into an offline claim", () => {
    expect(page({ status: "unknown" })).toContain("The station status is not available right now.");
  });
  it("keeps production observations out of explicit sample previews", () => {
    const html = page({ status: "ready", live: true, observedAt: NOW }, true);
    expect(html).toContain("outside this preview");
    expect(html).not.toContain("The station is live");
  });
});
