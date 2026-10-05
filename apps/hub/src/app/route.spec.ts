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
    expect(parseHash("#/s/ninja").tab).toBe("market");
  });
  it("sends an unknown route to Discover", () => {
    expect(parseHash("#/nope")).toMatchObject({ title: "Discover", tab: "market" });
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
  it("describes itself for a shared link but stays out of search results until that is decided", () => {
    expect(page).toMatch(/<meta name="description" content="Discover Twitch streamers/);
    expect(page).toContain('<meta name="robots" content="noindex" />');
  });
});
