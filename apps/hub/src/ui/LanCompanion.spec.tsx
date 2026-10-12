import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sampleMarket } from "../data/sample";
import type { Station } from "../data/station";
import { LanCompanion } from "./LanCompanion";

const NOW = Date.parse("2026-10-08T00:00:00Z");
const render = (station: Station, sample = false) => renderToStaticMarkup(
  <LanCompanion market={sample ? sampleMarket(NOW) : null} snapshot={null} now={NOW} ready={sample} station={station} />,
);
const decode = (s: string) => s.replace(/&#x27;/g, "'");

describe("station guide disclosure", () => {
  it("starts collapsed with a neutral summary and keeps actions inside the guide", () => {
    const markup = render({ status: "ready", live: false, observedAt: NOW });
    const summary = markup.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)![1]!;
    expect(markup).toMatch(/<details class="lan-guide__details">/);
    expect(summary).toContain("Guide");
    expect(summary).not.toContain("Station guide");
    expect(summary).toContain("Play is free");
    expect(summary).not.toMatch(/live|Support|Backing|href=/);
    expect(markup).toContain('href="#/lan"');
    expect(markup).toContain('href="#/play"');
    expect(markup).not.toContain('href="#/communities"');
    expect(markup).not.toContain('href="#/leaderboard"');
    expect(markup).not.toContain('href="#/stats"');
    const src = readFileSync(new URL("./LanCompanion.tsx", import.meta.url), "utf8");
    expect(src).toContain("RLAN_TOKEN_URL");
    expect(src).not.toMatch(/href="https:\/\/clawpump\.tech"/);
    expect(markup).not.toContain("lan-guide__play");
    expect(decode(markup)).toContain("Support isn't open yet");
  });

  it("preserves observed station status and source inside the disclosure", () => {
    const offline = render({ status: "ready", live: false, observedAt: NOW });
    const live = render({ status: "ready", live: true, observedAt: NOW });
    expect(offline).toContain("Twitch lists this channel as offline.");
    expect(offline).toContain("Data: Twitch");
    expect(live).toContain("Twitch lists this channel as live.");
    for (const status of ["loading", "unknown"] as const) {
      expect(render({ status })).toContain("The channel status is not available right now.");
    }
  });

  it("marks sample content and does not turn sample reads into a station observation", () => {
    const markup = render({ status: "unknown" }, true);
    expect(markup).toContain("tag--sample");
    expect(markup).toContain("The channel brief uses current reads outside this preview.");
    expect(markup).not.toContain("Twitch lists this channel as live.");
  });
});
