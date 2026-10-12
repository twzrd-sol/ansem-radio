import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildSample } from "./data/sample";
import { nextSeasonAction, pointsSeasonEyebrow, seasonStandingLabel } from "./data/season";
import { Play } from "./screens/Play";
import { SeasonCard } from "./ui/SeasonCard";

const opensAt = Date.UTC(2026, 9, 4, 19);
const sample = buildSample(opensAt);
const season = { ...sample.season!, opensAt, freezesAt: opensAt + 604_800_000, me: { ...sample.season!.me!, submissions: [] } };
const snapshot = { ...sample, season };
const noop = () => {};
const play = (now: number, joined = true) => renderToStaticMarkup(<Play snapshot={snapshot} load="ready" now={now} joined={joined} onJoin={noop} onRetry={noop} toast={noop} />);

describe("a published season opens at its actual start", () => {
  it("keeps activities locked before start even for an already joined fan", () => {
    const html = play(opensAt - 1);
    expect(html).toContain("Opens");
    expect(html).toContain("UTC");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Lock in answer");
    expect(html).toContain("Add to calendar");
  });

  it("shows the opening date before the join step", () => {
    const html = play(opensAt - 1, false);
    expect(html).toContain("Opens");
    expect(html).not.toContain(">Join free<");
  });

  it("keeps ICELAN task rewards on Profile when the season opens", () => {
    const html = play(opensAt);
    expect(html).toContain("separate ICELAN task rewards on Profile");
    expect(html).not.toContain("Link Twitch");
    expect(html).toContain("Answer the prompt");
    expect(html).not.toContain("Add to calendar");
  });

  it("freezes activities at the exact end", () => {
    const html = play(season.freezesAt);
    expect(html).not.toContain("<textarea");
    expect(html).toContain("points are frozen");
    expect(html).not.toContain("Starts when the next season opens");
  });

  it("uses the same upcoming state on the listing's season card", () => {
    const html = renderToStaticMarkup(<SeasonCard season={season} now={opensAt - 1} onJoin={noop} />);
    expect(html).toContain("Opens");
    expect(html).not.toContain(">Open<");
    expect(html).not.toContain(">Join free<");
  });

  it("names the next free action from the published season, never from backing", () => {
    expect(nextSeasonAction({ ...season, me: null }, opensAt)).toBe("Join this season. Play is free.");
    expect(nextSeasonAction(season, opensAt - 1)).toBe("Wait for the published opening.");
    expect(nextSeasonAction(season, season.freezesAt)).toBe("Read your season record.");
    expect(nextSeasonAction({ ...season, me: { ...season.me!, today: season.policy.dailyCap } }, opensAt)).toBe("Your daily points cap is reached. Come back after 00:00 UTC.");
  });

  it("labels only the placeholder poll as non-scoring without inventing players", () => {
    const html = renderToStaticMarkup(<SeasonCard season={{ ...season, poll: { id: "placeholder-1", question: "Which sound opens the show?", options: ["Boom bap", "Drill"], placeholder: true }, players: 0, board: [] }} now={opensAt} onJoin={noop} />);
    expect(html).not.toContain("tag--sample");
    expect(html).toContain("placeholder and does not count for points.");
    expect(html).not.toContain("tag--sample");
    expect(html).not.toContain("$RLAN");
    expect(html).not.toContain("mainnet");
  });

  it("names joined accounts and board rows separately, without treating credited activities as people", () => {
    expect(seasonStandingLabel({ players: 6, board: [["a", 20], ["b", 20], ["c", 10], ["d", 10]] })).toBe("6 joined · 4 on the board");
    expect(seasonStandingLabel({ players: 6, board: [["a", 20], ["b", 20], ["c", 10], ["d", 10]] })).not.toMatch(/credited/);
    expect(seasonStandingLabel({ players: 2, board: [["a", 10], ["b", 5]] })).toBe("2 joined · 2 on the board");
  });

  it("takes the points-season cluster from the API network field", () => {
    expect(pointsSeasonEyebrow({ number: 2, network: "devnet" })).toBe("Season 2 · Radio LAN");
    expect(pointsSeasonEyebrow({ number: 2, network: "mainnet" })).toBe("Season 2 · Radio LAN");
    expect(pointsSeasonEyebrow({ number: 2 })).toBe("Season 2 · Radio LAN");
    expect(pointsSeasonEyebrow({ number: 4, network: "devnet" })).toBe("Season 4 · Radio LAN");
  });
});
