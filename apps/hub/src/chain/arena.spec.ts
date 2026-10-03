// Byte compatibility with the repo's arena client (plan section 6): same instruction data, same accounts in the
// same order with the same signer and writable flags, same derived addresses and bumps, same decoded accounts.
import { AccountRole, address, getAddressDecoder, type Address, type Instruction } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { encodeBase58 } from "../../../../src/core/base58.js";
import * as ref from "../../../../src/sinks/arena.js";
import {
  ARENA_ERRORS,
  arenaAddress,
  arenaPda,
  closeArenaInstruction,
  decodeArena,
  decodePosition,
  depositInstruction,
  initArenaInstruction,
  positionAddress,
  requestWithdrawInstruction,
  supportAddress,
  withdrawInstruction,
} from "./arena";
import { ARENA_PROGRAM, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM } from "./config";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const streamer = address("EatwUpB2eCRcCEJgvQvzNb1hiPKqasjzXQ7NtVVFuLYX");
const mint = address("9ocVrg8z6wva3Z7A3rLYU4fWXFXWWf6sC4aGV7fgSJuN");
const fan = key(7);
const source = key(8);
const destination = key(9);

type RefIx = { programId: Uint8Array; keys: Array<{ pubkey: Uint8Array; isSigner: boolean; isWritable: boolean }>; data: Uint8Array };
const flags = (role: AccountRole) => ({ isSigner: role === AccountRole.READONLY_SIGNER || role === AccountRole.WRITABLE_SIGNER, isWritable: role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER });

function same(mine: Instruction, theirs: RefIx) {
  expect(mine.programAddress).toBe(encodeBase58(theirs.programId));
  expect([...(mine.data ?? [])]).toEqual([...theirs.data]);
  expect((mine.accounts ?? []).map((a) => ({ address: a.address, ...flags(a.role) }))).toEqual(theirs.keys.map((k) => ({ address: encodeBase58(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })));
}

describe("arena builders match src/sinks/arena.js", () => {
  it("derives the same arena, position and support addresses and bumps", async () => {
    for (const s of [streamer, key(1), key(2)]) {
      const [arena, bump] = await arenaPda(s, mint);
      const theirs = ref.arenaAddress(s, mint);
      expect(arena).toBe(encodeBase58(theirs.address));
      expect(bump).toBe(theirs.bump);
      expect(await arenaAddress(s, mint)).toBe(arena);
      expect(await positionAddress(arena, fan)).toBe(encodeBase58(ref.positionAddress(arena, fan).address));
      expect(await supportAddress(arena, fan)).toBe(encodeBase58(ref.supportAddress(arena, fan).address));
    }
  });

  it("builds identical init_arena, including the season bounds and start window", async () => {
    for (const seasonSeconds of [60n, 604_800n, 2_419_200n]) {
      same(await initArenaInstruction({ streamer, mint, seasonStart: 1_790_985_600n, seasonSeconds }), ref.initArenaInstruction({ streamer, mint, seasonStart: 1_790_985_600n, seasonSeconds, now: undefined }));
    }
    for (const seasonSeconds of [59n, 2_419_201n]) {
      await expect(initArenaInstruction({ streamer, mint, seasonStart: 0n, seasonSeconds })).rejects.toThrow(RangeError);
      expect(() => ref.initArenaInstruction({ streamer, mint, seasonStart: 0n, seasonSeconds, now: undefined })).toThrow(RangeError);
    }
    const now = 1_790_985_600n;
    await expect(initArenaInstruction({ streamer, mint, seasonStart: now + 61n, seasonSeconds: 60n, now })).rejects.toThrow(RangeError);
    await expect(initArenaInstruction({ streamer, mint, seasonStart: now - 366n * 86_400n, seasonSeconds: 60n, now })).rejects.toThrow(RangeError);
  });

  it("builds identical deposit, request, withdraw and close", async () => {
    for (const amount of [1n, 250_000_000n, (1n << 64n) - 1n]) {
      same(await depositInstruction({ fan, streamer, mint, source, amount }), ref.depositInstruction({ fan, streamer, mint, source, amount }));
      same(await withdrawInstruction({ fan, streamer, mint, destination, amount }), ref.withdrawInstruction({ fan, streamer, mint, destination, amount }));
    }
    same(await requestWithdrawInstruction({ fan, streamer, mint }), ref.requestWithdrawInstruction({ fan, streamer, mint }));
    same(await closeArenaInstruction({ streamer, mint }), ref.closeArenaInstruction({ streamer, mint }));
  });

  it("refuses the amounts the JS client refuses, for deposit and withdraw", async () => {
    for (const amount of [0n, -1n, 1n << 64n]) {
      await expect(depositInstruction({ fan, streamer, mint, source, amount })).rejects.toThrow(RangeError);
      expect(() => ref.depositInstruction({ fan, streamer, mint, source, amount })).toThrow(RangeError);
      await expect(withdrawInstruction({ fan, streamer, mint, destination, amount })).rejects.toThrow(RangeError);
      expect(() => ref.withdrawInstruction({ fan, streamer, mint, destination, amount })).toThrow(RangeError);
    }
  });

  it("decodes arena and position accounts the same way", () => {
    const arena = new Uint8Array(112);
    arena.set(new TextEncoder().encode("RLARENA1"), 0);
    arena[9] = 6;
    arena.set(new Uint8Array(32).fill(3), 16);
    arena.set(new Uint8Array(32).fill(4), 48);
    const dv = new DataView(arena.buffer);
    dv.setBigInt64(80, 1_790_985_600n, true);
    dv.setBigUint64(88, 604_800n, true);
    dv.setBigUint64(96, 5n, true);
    dv.setBigUint64(104, 1_250_000_000n, true);
    expect(decodeArena(arena)).toEqual({ ...ref.decodeArena(arena) });

    const position = new Uint8Array(104);
    position.set(new TextEncoder().encode("RLPOSIT1"), 0);
    position[10] = 1;
    position.set(new Uint8Array(32).fill(5), 16);
    position.set(new Uint8Array(32).fill(6), 48);
    const pv = new DataView(position.buffer);
    pv.setBigUint64(80, 250_000_000n, true);
    pv.setBigUint64(88, 12n, true);
    pv.setBigInt64(96, 1_790_000_000n, true);
    expect(decodePosition(position)).toEqual({ ...ref.decodePosition(position) });
    expect(() => decodeArena(position)).toThrow();
    expect(() => decodePosition(arena)).toThrow();
  });

  it("names every program error the docs list", () => {
    expect(Object.keys(ARENA_ERRORS).map(Number)).toEqual([6300, 6301, 6302, 6303, 6304, 6305, 6306, 6307, 6308, 6309]);
    expect(ARENA_ERRORS[6305]).toMatch(/Locked until/);
  });

  it("pins the same program ids as the JS client", () => {
    expect(ARENA_PROGRAM).toBe(ref.ARENA_PROGRAM_ID);
    expect(TOKEN_2022_PROGRAM).toBe(ref.TOKEN_2022_PROGRAM_ID);
    expect(SYSTEM_PROGRAM).toBe(ref.SYSTEM_PROGRAM);
  });
});

export type { Address };
