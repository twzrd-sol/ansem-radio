import { describe, expect, it } from "vitest";
import { checkPublicContract } from "../../scripts/check-public-contract.mjs";
import pin from "./fixtures/public-program-contract.json";

describe("latest public arena contract pinned for release", () => {
  it("checks the program and reference builder code independently of the frontend builders", async () => {
    expect(pin.repository).toBe("https://github.com/twzrd-sol/ansem-radio");
    expect(pin.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(Object.keys(pin.files)).toEqual(["programs/radiolan-arena/src/lib.rs", "src/sinks/arena.js"]);
    await expect(checkPublicContract()).resolves.toEqual({ pinnedCommit: pin.commit });
    // A pending (unreleased) source is allowed on the arena program and its sink only, and must differ from the public one.
    for (const [path, file] of Object.entries(pin.files) as [string, { codeSha256: string; pendingCodeSha256?: string }][]) {
      if (file.pendingCodeSha256 === undefined) continue;
      expect(["programs/radiolan-arena/src/lib.rs", "src/sinks/arena.js"]).toContain(path);
      expect(file.pendingCodeSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(file.pendingCodeSha256).not.toBe(file.codeSha256);
    }
  });
});
