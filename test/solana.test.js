import assert from "node:assert/strict";
import test from "node:test";

import { decodeBase58, encodeBase58 } from "../src/core/base58.js";
import { signerFromSeed, verifyEd25519 } from "../src/core/ed25519.js";
import { compactU16, compileLegacyMessage, createRpc, findProgramAddress, isOnCurve, signTransaction } from "../src/core/solana.js";
import { keccak256 } from "../src/core/keccak.js";
import {
  PROGRAM_ID,
  anchorHeadInstructions,
  computeUnitLimitInstruction,
  decodeLedger,
  decodeRootEntry,
  ed25519VerifyInstruction,
  initLedgerInstruction,
  ledgerAddress,
  rootAddress,
  verifyInclusionInstruction,
} from "../src/sinks/evidence-ledger.js";
import { treeHeadPreimage } from "../src/attribution/head.js";

const h = (text) => new Uint8Array(Buffer.from(text, "hex"));
const b64 = (text) => new Uint8Array(Buffer.from(text, "base64"));

// Devnet, read 2026-10-01 (slot 506121191): TWZRD's evidence-ledger log
// intel.twzrd.xyz/v6 and its anchor of the size-7 head, transaction
// 2qopAn6pT1skdipDVEhxirQCevqW5KLE7aSQUNycPkWvpRrZtqgnGGMyZQsCYS52DyVRb1Ybst7CJ8S4LNFuJdVt
// (slot 506097254). Built by TWZRD's own client; used here only as test data.
const DEVNET = {
  ledger: "8EpPmDkQQ9uqMQH166kx7nu4wT415bobWcWfyiZDvgv3",
  ledgerData: "KykV1bSwXyAB/wI24xZOJnJMjudT2kRreXq/T9B8duCP22u6E0jvG3AZx1JjsNRYlB7ijAXQSyoRSD/y4MxuvguZE1ACJgrl72jQkMIs5Fq7w8NTLZNBM4tx3bb6jimGecbs1uaW6nK6jd8HAAAAAAAAAAUAAAAAAAAAAAAAAAA=",
  otherLedger: "AEmPZkca5jS5VmrJgFiP3bUysUcN9hw7JxF82S2Mek2V",
  otherLogIdHash: "637a4e6713d4d56fef40515cb4ffcaa7eb9d788dd7b19f689df5cebbe195f634",
  root7: "BW8e59xvcd9vUihroF7yjU6MMGGsg1ArvyxqWtXYPLAK",
  root7Data: "6VOsANZ1aZgB/QcAAAAAAAAAHBpfeUA1dJu7R6clGVXtEvAZqcADSnvAQ6MesMuPGfMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAf6W9agAAAABmbioeAAAAAKKxvWoAAAAANuMWTiZyTI7nU9pEa3l6v0/QfHbgj9truhNI7xtwGccAAAAAAAA=",
  authority: "4hFrTSfugb8cHJ5EXmciAECG2EKo6FzKUzoHczQbrNqC",
  trustedSigner: "Ak5SQwHpuQAqU7ty7ZWX7qgF39A9yi72c22KNn8sHzvS",
  blockhash: "2c44a9c5ee48271527192e6e0e05fe61e5a13604fa6711f311f51830a15f8d22",
  head: {
    logId: "intel.twzrd.xyz/v6",
    treeSize: 7,
    timestamp: 1790813567,
    root: h("1c1a5f794035749bbb47a7251955ed12f019a9c0034a7bc043a31eb0cb8f19f3"),
    signature: decodeBase58("5yyfo1NgsVZUhtmdc6zj9knrSnt2JpHHBsaVVHs7AhuSS2EkWLBZqDafU9ZTTYeZEGvv232Bg8mpaQGS8ASrV5tK"),
  },
  message: "AQAEBzbjFk4mckyO51PaRGt5er9P0Hx24I/ba7oTSO8bcBnHa4vyIW0gYg4nsUR1J4K0rDr8zzWbvaqXCWbJqMGIH8icC1mxJUbgemWn2S3IDM96HCI/MjYsNld3GVpXhDpmKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA31G1nyT+74S+UKPg41A/wVwdEkn9Ipk/MpwRIAAAAAGp9UXGHvRZjXa1ARV/cLAwSTGjyFWdaXbustfCAAAAKM6d+i1XvCq/rtIbSYuFkKfo7NDId9jhj7xkBYmAS+XLESpxe5IJxUnGS5uDgX+YeWhNgT6ZxHzEfUYMKFfjSICBADMAQEAMAD//xAA//9wAFwA//+QwizkWrvDw1Mtk0Ezi3HdtvqOKYZ5xuzW5pbqcrqN3/kz7S9Qp936TLFwAmnTE7snGAkWrQOQUTNw8AP4QeHbBGK7dhYXKp+VbRjzfqNHneZC/3E+OsHi/sicvgpGbgBUV1pSRDpSRUNFSVBUX0xPR19TVEhfVjESAGludGVsLnR3enJkLnh5ei92NgcAAAAAAAAAf6W9agAAAAAcGl95QDV0m7tHpyUZVe0S8BmpwANKe8BDox6wy48Z8wYGAAABAgMFS22rID3FmOtxBwAAAAAAAAB/pb1qAAAAABwaX3lANXSbu0enJRlV7RLwGanAA0p7wEOjHrDLjxnzEmludGVsLnR3enJkLnh5ei92Ng==",
  txSignature: "5c1b3db53e755347b96383b9cdb038e88357baa0ff699ef8e21738c3c21d7f496a56a0b53c8b047b2e8cec7f82759e445ccab18ebc2deb4f000658bce95c7e03",
};

test("compact-u16 matches Solana's short-vec encoding", () => {
  const cases = [[0, [0]], [5, [5]], [127, [0x7f]], [128, [0x80, 0x01]], [16383, [0xff, 0x7f]], [16384, [0x80, 0x80, 0x01]], [65535, [0xff, 0xff, 0x03]]];
  for (const [value, bytes] of cases) assert.deepEqual([...compactU16(value)], bytes, String(value));
  assert.throws(() => compactU16(65536), RangeError);
  assert.throws(() => compactU16(-1), RangeError);
});

test("every Ed25519 public key is on the curve; program addresses are not", () => {
  for (let i = 0; i < 50; i += 1) assert.equal(isOnCurve(signerFromSeed(new Uint8Array(32).fill(i)).publicKey), true);
  for (const address of [DEVNET.ledger, DEVNET.otherLedger, DEVNET.root7]) assert.equal(isOnCurve(decodeBase58(address)), false);
});

test("program addresses and bumps match accounts that exist on devnet", () => {
  const ledger = ledgerAddress("intel.twzrd.xyz/v6");
  assert.equal(encodeBase58(ledger.address), DEVNET.ledger);
  assert.equal(ledger.bump, 255);
  const other = findProgramAddress([new TextEncoder().encode("ledger"), h(DEVNET.otherLogIdHash)], PROGRAM_ID);
  assert.equal(encodeBase58(other.address), DEVNET.otherLedger);
  assert.equal(other.bump, 251); // so bumps 255..252 hashed onto the curve, and were skipped
  const root = rootAddress(ledger.address, 7);
  assert.equal(encodeBase58(root.address), DEVNET.root7);
  assert.equal(root.bump, 253);
});

test("account decoders read devnet's ledger and root accounts", () => {
  const ledger = decodeLedger(b64(DEVNET.ledgerData));
  assert.equal(ledger.scheme, 2);
  assert.equal(ledger.bump, 255);
  assert.equal(ledger.authority, DEVNET.authority);
  assert.equal(ledger.trustedSigner, DEVNET.trustedSigner);
  assert.equal(Buffer.from(ledger.logIdHash).toString("hex"), Buffer.from(keccak256("intel.twzrd.xyz/v6")).toString("hex"));
  assert.equal(ledger.lastSeq, 7);
  assert.equal(ledger.count, 5);
  const root = decodeRootEntry(b64(DEVNET.root7Data));
  assert.equal(root.seq, 7);
  assert.equal(root.leafCount, 7);
  assert.equal(root.signedTimestamp, DEVNET.head.timestamp);
  assert.equal(Buffer.from(root.root).toString("hex"), Buffer.from(DEVNET.head.root).toString("hex"));
  assert.equal(root.publishedSlot, 506097254);
  assert.equal(root.publisher, DEVNET.authority);
  assert.throws(() => decodeLedger(b64(DEVNET.root7Data)), /discriminator/);
  assert.throws(() => decodeRootEntry(b64(DEVNET.ledgerData)), /wrong size|discriminator/);
});

test("an anchor transaction is byte-identical to the one TWZRD's client sent", () => {
  const message = compileLegacyMessage({
    feePayer: DEVNET.authority,
    recentBlockhash: h(DEVNET.blockhash),
    instructions: anchorHeadInstructions({
      authority: DEVNET.authority,
      payer: DEVNET.authority,
      trustedSigner: DEVNET.trustedSigner,
      head: DEVNET.head,
    }),
  });
  assert.equal(Buffer.from(message.bytes).toString("base64"), DEVNET.message);
  // The transaction's real signature verifies over the bytes built here.
  assert.equal(verifyEd25519(decodeBase58(DEVNET.authority), message.bytes, h(DEVNET.txSignature)), true);
  assert.equal(message.signerCount, 1);
});

test("an init_ledger transaction is byte-identical to the one TWZRD's client sent", () => {
  // Devnet transaction fF4dw1zH...JhSyZ (slot 502191498) created TWZRD's scheme-1
  // ledger for reader.fetch.v1, with no trusted signer. Read 2026-10-01; test data only.
  const message = compileLegacyMessage({
    feePayer: DEVNET.authority,
    recentBlockhash: "12axEp17EqSgU7xR68Lcmo9yPwQCbCUNjBxPgjQucW7x",
    instructions: [
      initLedgerInstruction({
        payer: DEVNET.authority,
        authority: DEVNET.authority,
        trustedSigner: new Uint8Array(32),
        logId: "reader.fetch.v1",
        scheme: 1,
      }),
    ],
  });
  assert.equal(
    Buffer.from(message.bytes).toString("base64"),
    "AQACBDbjFk4mckyO51PaRGt5er9P0Hx24I/ba7oTSO8bcBnHiT/seEAe9mrvw6lDPKGdS53DAHMSrmu/K+Ld0CWRlcoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKM6d+i1XvCq/rtIbSYuFkKfo7NDId9jhj7xkBYmAS+XAGf4jCywjvanMPTZpDVtUAUYaiEN1fgTeWwhZ6AK3r8BAwMAAQJZW8IgU1zONkM24xZOJnJMjudT2kRreXq/T9B8duCP22u6E0jvG3AZxwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ9yZWFkZXIuZmV0Y2gudjE=",
  );
  const signature = h("20fa95aa1518f23b5242792065cf8e90e3e5f94f0cf887d6e1408a26d40941b6c85c7940121c1beb66f907605db7bb7cbe640b72403b94a873133a136abef104");
  assert.equal(verifyEd25519(decodeBase58(DEVNET.authority), message.bytes, signature), true);
  assert.throws(() => initLedgerInstruction({ payer: DEVNET.authority, authority: DEVNET.authority, trustedSigner: new Uint8Array(32), logId: "x", scheme: 3 }), /scheme/);
});

test("the Ed25519 instruction carries the head key, signature and preimage at the expected offsets", () => {
  const ix = ed25519VerifyInstruction(decodeBase58(DEVNET.trustedSigner), DEVNET.head.signature, treeHeadPreimage(DEVNET.head));
  assert.equal(Buffer.from(ix.data.subarray(0, 16)).toString("hex"), "01003000ffff1000ffff70005c00ffff");
  assert.equal(encodeBase58(ix.data.subarray(16, 48)), DEVNET.trustedSigner);
  assert.equal(verifyEd25519(ix.data.subarray(16, 48), ix.data.subarray(112), ix.data.subarray(48, 112)), true);
  assert.equal(ix.keys.length, 0);
});

test("init_ledger and verify_inclusion use the program's layouts", () => {
  const payer = signerFromSeed(new Uint8Array(32).fill(1)).publicKey;
  const head = signerFromSeed(new Uint8Array(32).fill(2)).publicKey;
  const init = initLedgerInstruction({ payer, authority: payer, trustedSigner: head, logId: "radiolan.attribution.v1" });
  assert.equal(Buffer.from(init.data.subarray(0, 8)).toString("hex"), "5bc220535cce3643");
  assert.deepEqual(init.data.subarray(8, 40), payer);
  assert.deepEqual(init.data.subarray(40, 72), head);
  assert.deepEqual([...init.data.subarray(72, 74)], [2, 23]);
  assert.equal(Buffer.from(init.data.subarray(74)).toString(), "radiolan.attribution.v1");
  assert.deepEqual(init.keys.map((k) => [k.isSigner, k.isWritable]), [[true, true], [false, true], [false, false]]);
  assert.equal(encodeBase58(init.keys[1].pubkey), encodeBase58(ledgerAddress("radiolan.attribution.v1").address));

  const path = [new Uint8Array(32).fill(7), new Uint8Array(32).fill(8)];
  const verify = verifyInclusionInstruction({ logId: "radiolan.attribution.v1", treeSize: 3, entry: new Uint8Array(32).fill(5), index: 1, path });
  assert.equal(Buffer.from(verify.data.subarray(0, 8)).toString("hex"), "38da8cf25b056adc");
  assert.equal(verify.data.length, 8 + 8 + 32 + 8 + 64);
  assert.deepEqual(verify.keys.map((k) => [k.isSigner, k.isWritable]), [[false, false], [false, false]]);
});

test("the header counts read-only signers and read-only accounts; anchor flags are exact", () => {
  const payer = signerFromSeed(new Uint8Array(32).fill(1)).publicKey;
  const watcher = signerFromSeed(new Uint8Array(32).fill(2)).publicKey;
  const message = compileLegacyMessage({
    feePayer: payer,
    recentBlockhash: new Uint8Array(32),
    instructions: [{ programId: decodeBase58(PROGRAM_ID), keys: [{ pubkey: watcher, isSigner: true, isWritable: false }], data: new Uint8Array() }],
  });
  assert.deepEqual([...message.bytes.subarray(0, 3)], [2, 1, 1]);
  const [, anchorIx] = anchorHeadInstructions({ authority: watcher, payer, trustedSigner: payer, head: DEVNET.head });
  assert.deepEqual(anchorIx.keys.map((k) => [k.isSigner, k.isWritable]), [[true, false], [true, true], [false, true], [false, true], [false, false], [false, false]]);
  assert.equal(encodeBase58(anchorIx.keys[0].pubkey), encodeBase58(watcher));
});

test("the compute budget instruction is SetComputeUnitLimit", () => {
  const ix = computeUnitLimitInstruction();
  assert.equal(encodeBase58(ix.programId), "ComputeBudget111111111111111111111111111111");
  assert.equal(Buffer.from(ix.data).toString("hex"), "02c05c1500"); // 2, then 1_400_000 as u32le
  assert.deepEqual(ix.keys, []);
});

test("transactions need every required signer and stay under the size limit", () => {
  const payer = signerFromSeed(new Uint8Array(32).fill(1));
  const other = signerFromSeed(new Uint8Array(32).fill(2));
  const message = compileLegacyMessage({
    feePayer: payer.publicKey,
    recentBlockhash: new Uint8Array(32),
    instructions: [{ programId: decodeBase58(PROGRAM_ID), keys: [{ pubkey: other.publicKey, isSigner: true, isWritable: false }], data: new Uint8Array() }],
  });
  assert.equal(message.signerCount, 2);
  assert.throws(() => signTransaction(message, [payer]), /missing signer/);
  const { wire, signature } = signTransaction(message, [other, payer]);
  assert.equal(wire[0], 2);
  assert.equal(signature, encodeBase58(wire.subarray(1, 65)));
  assert.equal(verifyEd25519(payer.publicKey, message.bytes, wire.subarray(1, 65)), true);
  assert.equal(verifyEd25519(other.publicKey, message.bytes, wire.subarray(65, 129)), true);
  const big = compileLegacyMessage({
    feePayer: payer.publicKey,
    recentBlockhash: new Uint8Array(32),
    instructions: [{ programId: decodeBase58(PROGRAM_ID), keys: [], data: new Uint8Array(1200) }],
  });
  assert.throws(() => signTransaction(big, [payer]), /1232/);
});

test("the RPC client reports errors and waits for confirmation", async () => {
  const calls = [];
  const replies = {
    sendTransaction: () => "SIG",
    getSignatureStatuses: (n) => ({ value: [n < 2 ? null : { confirmationStatus: "confirmed", err: null }] }),
    getGenesisHash: () => "G",
  };
  const fetchImpl = async (_url, init) => {
    const { method } = JSON.parse(init.body);
    calls.push(method);
    if (method === "getBalance") return { ok: true, json: async () => ({ error: { message: "boom" } }) };
    if (method === "getAccountInfo") return { ok: false, status: 503 };
    const count = calls.filter((m) => m === method).length - 1;
    return { ok: true, json: async () => ({ result: replies[method](count) }) };
  };
  const rpc = createRpc("http://rpc.invalid", { fetchImpl });
  assert.equal(await rpc.genesisHash(), "G");
  assert.equal(await rpc.sendAndConfirm(new Uint8Array([1]), { sleep: async () => {} }), "SIG");
  assert.equal(calls.filter((m) => m === "getSignatureStatuses").length, 3);
  await assert.rejects(rpc.getBalance(new Uint8Array(32)), /getBalance: boom/);
  await assert.rejects(rpc.getAccount(new Uint8Array(32)), /HTTP 503/);
  const failing = createRpc("http://rpc.invalid", {
    fetchImpl: async (_url, init) => {
      const { method } = JSON.parse(init.body);
      const result = method === "sendTransaction" ? "BAD" : { value: [{ confirmationStatus: "processed", err: { InstructionError: [1, 6] } }] };
      return { ok: true, json: async () => ({ result }) };
    },
  });
  await assert.rejects(failing.sendAndConfirm(new Uint8Array([1]), { sleep: async () => {} }), /BAD failed/);
});
