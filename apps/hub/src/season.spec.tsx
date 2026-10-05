import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildSample } from "./data/sample";
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

  it("turns into live activity cards at the exact start", () => {
    const html = play(opensAt);
    expect(html).toContain("<textarea");
    expect(html).toContain("Lock in answer");
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

  it("labels a placeholder-poll season as a sample without inventing players", () => {
    const html = renderToStaticMarkup(<SeasonCard season={{ ...season, poll: { id: "placeholder-1", question: "Which sound opens the show?", options: ["Boom bap", "Drill"], placeholder: true }, players: 0, board: [] }} now={opensAt} onJoin={noop} />);
    expect(html).toContain("Sample season.");
    expect(html).toContain("placeholder and does not count for points.");
    expect(html).toContain("tag--sample");
    expect(html).not.toContain("$RLAN");
    expect(html).not.toContain("mainnet");
  });
});
