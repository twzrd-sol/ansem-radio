import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Station } from "./data/station";
import { sampleMarket } from "./data/sample";
import { StationBrief } from "./ui/StationBrief";

const NOW = Date.parse("2026-10-03T14:00:00Z");
const station: Station = { status: "ready", live: false, observedAt: NOW - 60_000, pulse: { generatedAt: NOW, trackedTotal: 12, board: { at: NOW - 10_000, live: [] }, history: { hours: 6, from: NOW - 6 * 3_600_000, to: NOW, coverage: 1, recordedMinutes: 359, leader: { login: "xqc", minutesLive: 4 } } } };
const page = (s = station, now = NOW, sample = false) => renderToStaticMarkup(<StationBrief station={s} market={sampleMarket(NOW)} now={now} sample={sample} />);

describe("LAN station brief", () => {
  it("makes an offline room useful with current status, historical context and source timestamps", () => {
    const html = page();
    expect(html).toContain("None of the 12 tracked creators are live");
    expect(html).toContain("Across recorded minutes in the last 6 hours");
    expect(html).toContain("led viewer-minutes");
    expect(html).toContain("Data: Twitch");
    expect(html).toContain("13:59 UTC");
    expect(html).toContain("History through");
    expect(html).toContain('href="/stream?hours=6"');
    expect(html).toContain('href="#/play"');
    expect(html).not.toContain("points");
  });
  it("links registered creators back to the hub and unregistered creators to their official channel", () => {
    const pulse = station.pulse!;
    const html = page({ ...station, pulse: { ...pulse, board: { at: NOW, live: [{ login: "radiolanlive", viewers: 23 }] }, history: { ...pulse.history!, leader: { login: "somecreator", minutesLive: 2 } } } });
    expect(html).toContain('href="#/s/radiolanlive"');
    expect(html).toContain('href="https://www.twitch.tv/somecreator"');
    expect(html).toContain("23 viewers");
    expect(html).toContain("1 tracked creator is live");
  });
  it("drops current and historical assertions when the read expires without another response", () => {
    const html = page(station, NOW + 120_001);
    expect(html).toContain("waiting for a fresh read");
    expect(html).not.toContain("None of the 12");
    expect(html).not.toContain("led viewer-minutes");
  });
  it("does not present missing current data as no live creators and labels gaps in the recorded history", () => {
    const html = page({ ...station, pulse: { ...station.pulse!, board: null, history: { ...station.pulse!.history!, coverage: 0.4 } } });
    expect(html).toContain("waiting for a fresh read");
    expect(html).toContain("history has gaps");
    expect(html).toContain("led viewer-minutes");
    expect(html).not.toContain("None of the");
  });
  it("keeps production observations out of explicit sample previews", () => {
    const html = page(station, NOW, true);
    expect(html).toContain("outside this preview");
    expect(html).not.toContain("led viewer-minutes");
    expect(html).not.toContain("None of the 12");
  });
});
