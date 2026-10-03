import { describe, expect, it } from "vitest";
import { checkPublicContract } from "../../scripts/check-public-contract.mjs";
import pin from "./fixtures/public-program-contract.json";

describe("latest public arena contract pinned for release", () => {
  it("checks the program and reference builder code independently of the frontend builders", async () => {
    expect(pin.repository).toBe("https://github.com/twzrd-sol/ansem-radio");
    expect(pin.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(Object.keys(pin.files)).toEqual(["programs/radiolan-arena/src/lib.rs", "src/sinks/arena.js"]);
    await expect(checkPublicContract()).resolves.toEqual({ pinnedCommit: pin.commit });
  });
});
