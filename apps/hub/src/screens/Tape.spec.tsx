import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { reduceTape } from "../tape/board";
import { DEMO_CHANNELS, demoEvents } from "../tape/demo";
import { TapeBoardView } from "./Tape";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (el: ReactElement) => html(el).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

const demoBoard = reduceTape(DEMO_CHANNELS, demoEvents());

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|css)$/.test(name) && !/\.spec\./.test(name) ? [path] : [];
  });
}

describe("activity tape screen", () => {
  it("labels Solana devnet, says unpriced, and keeps deposits 1:1 rather than a reward", () => {
    const page = text(<TapeBoardView board={demoBoard} status="live" mode="demo" />);
    expect(page).toMatch(/Solana devnet/);
    expect(page).toMatch(/unpriced/);
    expect(page).toMatch(/Deposited RLAN stays until you request a withdrawal; a request is released when its on-chain season ends\. It is not a reward/);
    expect(page).toMatch(/Deposit · comes back 1:1/);
    expect(page).toMatch(/Withdrawal/);
    expect(page).toMatch(/Season 2 opened/);
    expect(page).toMatch(/Demo tape/);
    expect(page).not.toMatch(/Raydium|price chart|token price|APY|yield|buy|sell|claim|back the/i);
    expect(html(<TapeBoardView board={demoBoard} status="live" mode="demo" />)).not.toMatch(/<button[^>]*>\s*(Buy|Sell|Back|Claim)/i);
  });

  it("stops the ticker animation when reduced motion is on", () => {
    const moving = html(<TapeBoardView board={demoBoard} status="live" mode="demo" />);
    const still = html(<TapeBoardView board={demoBoard} status="live" mode="demo" reducedMotion />);
    expect(moving).toContain("tape__marquee");
    expect(still).not.toContain("tape__marquee");
    expect(still).toContain("tape__ticker--static");
  });

  it("is honest when the socket is down or the tape is empty", () => {
    const empty = { channels: [], ticker: [], feed: [] };
    expect(text(<TapeBoardView board={empty} status="offline" mode="live" />)).toMatch(/The socket dropped/);
    expect(text(<TapeBoardView board={empty} status="live" mode="live" />)).toMatch(/No deposits, withdrawals, or season events yet/);
    expect(html(<TapeBoardView board={empty} status="connecting" mode="live" />)).toContain("skel");
  });

  it("keeps price, Raydium, and reward-source wording out of the tape sources", () => {
    const banned = [/\bRaydium\b/i, /\bprice chart\b/i, /\btoken price\b/i, /\breward source\b/i, /\byield\b/i, /\bAPY\b/i];
    for (const file of [...walk("src/tape"), "src/screens/Tape.tsx", "src/styles/tape.css"]) {
      const body = readFileSync(file, "utf8");
      for (const rule of banned) expect(rule.test(body), `${file} ${rule}`).toBe(false);
    }
  });
});
