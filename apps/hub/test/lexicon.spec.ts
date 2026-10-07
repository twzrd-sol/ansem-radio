import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const banned = [
  /\byield\b/i,
  /\binvest\b/i,
  /\bstak(e|ed|es|ing)\b/i,
  /\bairdrop\b/i,
  /\bgasless\b/i,
  /no dev buy/i,
  /\$ICELAN\b[^.\n]{0,80}\b(price|chart|worth|apy)\b/i,
  /\b(price|chart|worth|apy)\b[^.\n]{0,80}\$ICELAN\b/i,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.spec\.tsx$/.test(name) ? [path] : [];
  });
}

describe("public lexicon", () => {
  it("keeps prohibited financial copy out of user-visible screens", () => {
    const found = files(fileURLToPath(new URL("../src", import.meta.url)));
    assert.ok(found.length > 10);
    for (const file of found) {
      const body = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const rule of banned) assert.equal(rule.test(body), false, `${file} ${rule}`);
    }
  });

  it("keeps the ICELAN rewards vault visibly closed", () => {
    const story = readFileSync(fileURLToPath(new URL("../src/ui/RevenueStory.tsx", import.meta.url)), "utf8");
    assert.match(story, /vault has not been created/i);
    assert.match(story, /Collect stays disabled/i);
    assert.doesNotMatch(story, /vault (?:is )?(?:open|ready|claimable)/i);
  });
});
