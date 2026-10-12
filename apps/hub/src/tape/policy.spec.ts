import { describe, expect, it } from "vitest";

import { ARENA_PROGRAM } from "../chain/config";
import { accountSubscribeCall, logsSubscribeCall, subscribeProblem, TAPE_PROGRAMS } from "./policy";

const REWARDS = "5wAVbHfZCBrYPymk1FNeV4D69iZioUmZaiE4ki4qrqWD";

describe("tape subscribe allowlist", () => {
  it("subscribes only to the arena program already on the relay allowlist", () => {
    expect(TAPE_PROGRAMS).toEqual([ARENA_PROGRAM]);
    expect(subscribeProblem("logsSubscribe", logsSubscribeCall(1).params)).toBeNull();
    expect(subscribeProblem("logsSubscribe", [{ mentions: [REWARDS] }])).toMatch(/program the hub does not use/);
    expect(subscribeProblem("logsSubscribe", [{ mentions: [ARENA_PROGRAM, REWARDS] }])).toMatch(/program the hub does not use/);
    expect(subscribeProblem("accountSubscribe", accountSubscribeCall(1, ARENA_PROGRAM).params)).toBeNull();
    expect(subscribeProblem("accountSubscribe", ["nope"])).toMatch(/account/);
    expect(subscribeProblem("slotSubscribe", [])).toBe("method not relayed");
    expect(subscribeProblem("getAccountInfo", [])).toBe("method not relayed");
  });
});
