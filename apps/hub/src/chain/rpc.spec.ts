import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { ARENA_LEN, POSITION_LEN } from "./arena";
import { decodeAccountData, HUB_ACCOUNT_SLICE, kitRpc } from "./rpc";

const SYSTEM = address("11111111111111111111111111111111");

describe("kitRpc account reads", () => {
  it("asks the relay for a confirmed slice, preserves owner metadata, and stays inside the relay cap", async () => {
    expect(HUB_ACCOUNT_SLICE).toBeGreaterThanOrEqual(Math.max(ARENA_LEN, POSITION_LEN, 165));
    expect(HUB_ACCOUNT_SLICE).toBeLessThanOrEqual(256);
    const bodies: Array<{ method?: string; params?: unknown[] }> = [];
    const data = Buffer.alloc(ARENA_LEN, 7).toString("base64");
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: unknown; method?: string; params?: unknown[] };
        bodies.push(payload);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            context: { slot: 1 },
            value: { lamports: 1, data: [data, "base64"], owner: SYSTEM, executable: false, rentEpoch: 0, space: ARENA_LEN },
          },
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const read = await kitRpc(`http://127.0.0.1:${port}`).account(SYSTEM);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]?.method).toBe("getAccountInfo");
      expect(bodies[0]?.params?.[1]).toMatchObject({
        encoding: "base64",
        commitment: "confirmed",
        dataSlice: { offset: 0, length: HUB_ACCOUNT_SLICE },
      });
      expect(read).toMatchObject({ data: new Uint8Array(Buffer.alloc(ARENA_LEN, 7)), lamports: 1n, owner: String(SYSTEM), executable: false });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

describe("Solana account RPC encoding", () => {
  it("accepts canonical base64 account data with its encoding tag", () => {
    expect([...decodeAccountData(["AQID", "base64"])]).toEqual([1, 2, 3]);
  });

  it("rejects an absent or unexpected encoding tag", () => {
    expect(() => decodeAccountData(["AQID", "base58"])).toThrow(/unexpected encoding/);
    expect(() => decodeAccountData(["AQID"])).toThrow(/unexpected encoding/);
  });

  it("rejects malformed and non-canonical base64", () => {
    expect(() => decodeAccountData(["AQI", "base64"])).toThrow(/base64/);
    expect(() => decodeAccountData(["AR==", "base64"])).toThrow(/non-canonical/);
  });
});
