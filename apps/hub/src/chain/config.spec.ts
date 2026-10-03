// The official arena pin (F-7, plan section 6) and the keys the hub must never present as Radio LAN's.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { encodeBase58 } from "../../../../src/core/base58.js";
import { arenaAddress as refArenaAddress } from "../../../../src/sinks/arena.js";
import { duration } from "../lib/format";
import { arenaPda } from "./arena";
import { ARENA_STREAMER, OFFICIAL_ARENA_BUMP, OFFICIAL_ARENA_MAINNET, OFFICIAL_STREAMER, RLAN_MINT } from "./config";

// Keys and arenas the hub must never present as Radio LAN's (#53, #55, F-8 in #56). Named here only to prove it.
const UPGRADE_AUTHORITY = "EatwUpB2eCRcCEJgvQvzNb1hiPKqasjzXQ7NtVVFuLYX";
const OPS_TEST_FAN = "FmpHGDih183cr7TmHgFMTJ2QgVEfUPKC2YAUG1W8K8A5";
const SUPERSEDED_TEST_ARENA = "9tUxpgaNp2PWdczS2v1AmDKTjtGvaTLCLzu4TLNCp2KU";
const TEST_ARENA_STREAMER = "GbscvafBJEkWutxm3Bi6AYfXztfojW6Jj7Yaw1TM3PhT";
const TEST_ARENA = "GwYjjFYcc4DV8hLE6bCAQiM3rjstGWNZ6p3icjR7ZnxU";

const appSources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? appSources(path) : /\.(tsx?|css)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });

describe("official arena pin", () => {
  it("derives the pinned official arena and bump from the official streamer and the RLAN mint", async () => {
    const [arena, bump] = await arenaPda(address(OFFICIAL_STREAMER), address(RLAN_MINT));
    expect(arena).toBe(OFFICIAL_ARENA_MAINNET);
    expect(bump).toBe(OFFICIAL_ARENA_BUMP);
    const theirs = refArenaAddress(OFFICIAL_STREAMER, RLAN_MINT);
    expect(encodeBase58(theirs.address)).toBe(OFFICIAL_ARENA_MAINNET);
    expect(theirs.bump).toBe(255);
  });

  it("knows the live internal test arena (F-8) is a different account, and never shows it", async () => {
    const [arena, bump] = await arenaPda(address(TEST_ARENA_STREAMER), address(RLAN_MINT));
    expect(arena).toBe(TEST_ARENA);
    expect(bump).toBe(254);
    expect(arena).not.toBe(OFFICIAL_ARENA_MAINNET);
    expect(ARENA_STREAMER).toBe(OFFICIAL_STREAMER);
  });

  it("keeps the upgrade-authority key, the test keys and the test arenas out of the app, and the streamer unconfigurable", () => {
    const files = appSources("src");
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      for (const banned of [UPGRADE_AUTHORITY, OPS_TEST_FAN, SUPERSEDED_TEST_ARENA, TEST_ARENA_STREAMER, TEST_ARENA, "VITE_ARENA_STREAMER"]) expect(body.includes(banned), `${file} contains ${banned}`).toBe(false);
    }
  });
});

describe("durations", () => {
  it("states a season length exactly", () => {
    expect(duration(60)).toBe("60 seconds");
    expect(duration(90)).toBe("90 seconds");
    expect(duration(604_800)).toBe("7 days");
    expect(duration(2_419_200)).toBe("28 days");
    expect(duration(3_660)).toBe("1 hour 1 minute");
    expect(duration(150)).toBe("2 minutes 30 seconds");
  });
});
