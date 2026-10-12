import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseHash } from "./route";

describe("hub destinations", () => {
  it("names the three starting points and groups the personal pages under Profile", () => {
    expect(parseHash("#/")).toMatchObject({ title: "Discover", tab: "market" });
    expect(parseHash("#/play")).toMatchObject({ title: "Play", tab: "play" });
    expect(parseHash("#/lan")).toMatchObject({ title: "Radio LAN", tab: "lan" });
    for (const hash of ["#/me", "#/positions", "#/claim"]) expect(parseHash(hash).tab, hash).toBe("me");
    expect(parseHash("#/circle")).toMatchObject({ title: "Superfans", tab: "play" });
    expect(parseHash("#/circle/crate-breed")).toMatchObject({ key: "circle", arg: "crate-breed", title: "Superfans" });
    expect(parseHash("#/communities")).toMatchObject({ title: "Communities", tab: "play", onchain: false });
    expect(parseHash("#/s/ninja").tab).toBe("market");
    expect(parseHash("#/leaderboard")).toMatchObject({ title: "Streamer board", tab: "market", onchain: false });
  });
  it("sends an unknown route to Discover", () => {
    expect(parseHash("#/nope")).toMatchObject({ title: "Discover", tab: "market" });
  });
  it("names the flagged market board on its own on-chain route", () => {
    expect(parseHash("#/tape")).toMatchObject({ title: "Market board", tab: "market", onchain: true, key: "tape" });
  });
});

describe("the page shell", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  it("no longer links to the retired /stream page from anywhere in the hub", () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|html)$/.test(name) && !/\.spec\./.test(name) ? [path] : [];
    });
    const offenders = walk(fileURLToPath(new URL("..", import.meta.url))).filter((file) => /href=\{?["`']\/stream/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
    expect(app).not.toContain('href="/stream"');
  });
  it("links to the sample season from the footer of the live hub, and back to the live hub from the sample", () => {
    expect(app).toContain('href="?preview=sample#/play"');
    expect(app).toContain("<SampleBanner />");
  });
  it("does not link Stats, Streamer board, or Communities from the footer while they are empty or off", () => {
    expect(app).not.toContain('href="#/stats"');
    expect(app).not.toContain('href="#/leaderboard"');
    expect(app).not.toContain('href="#/communities"');
  });
  it("describes itself for a shared link but stays out of search results until that is decided", () => {
    expect(page).toMatch(/<meta name="description" content="Follow the streamers you watch/);
    expect(page).toContain('<meta name="robots" content="noindex" />');
    expect(page).toContain('href="/hub/favicon.svg"');
    expect(page).toContain('href="/hub/favicon.ico"');
  });

  it("pads phone content by the tab bar plus the safe-area inset", () => {
    const chrome = readFileSync(new URL("../styles/chrome.css", import.meta.url), "utf8");
    const hub = readFileSync(new URL("../styles/hub.css", import.meta.url), "utf8");
    expect(chrome).toContain("--hub-bottom-clearance: calc(var(--tabbar) + var(--hub-safe-bottom))");
    expect(chrome).toContain(".app > .view { padding-bottom: calc(var(--hub-bottom-clearance) + 24px); }");
    expect(chrome).toContain(".app { padding-bottom: var(--hub-bottom-clearance); }");
    expect(chrome).toContain("height: var(--hub-bottom-clearance);");
    expect(chrome).toContain("padding-bottom: var(--hub-safe-bottom);");
    expect(hub).not.toMatch(/@media \(max-width: 899px\) \{[^}]*\.view \{ padding-bottom: 40px; \}/);
  });
});
