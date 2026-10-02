import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claimText } from "../src/attribution/claim.js";
import { treeHeadPreimage } from "../src/attribution/head.js";
import { createAttributionLog, loadAttributionLog } from "../src/attribution/log.js";
import { verifyInclusion } from "../src/attribution/tree.js";
import { decodeBase58, encodeBase58 } from "../src/core/base58.js";
import { signerFromSeed, verifyEd25519 } from "../src/core/ed25519.js";
import { keccak256 } from "../src/core/keccak.js";
import { DEVNET_GENESIS_HASH } from "../src/core/solana.js";
import { MAINNET_GENESIS_HASH, anchor, init, keysFrom, main, status, verify } from "../src/sinks/evidence-ledger-cli.js";
import { ED25519_PROGRAM, PROGRAM_ID, ledgerAddress, rootAddress } from "../src/sinks/evidence-ledger.js";

const AUTHORITY_SEED = "a1".repeat(32);
const LOG_SEED = "b2".repeat(32);
const ENV = { RADIOLAN_ATTRIBUTION_AUTHORITY_SEED: AUTHORITY_SEED, RADIOLAN_ATTRIBUTION_LOG_SEED: LOG_SEED };
const keys = keysFrom(ENV);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const disc = (text) => new Uint8Array(createHash("sha256").update(text).digest().subarray(0, 8));
const u64 = (value) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
};
const readU64 = (bytes, at) => Number(new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(at, true));

// --- an in-memory devnet that applies the program's checks to real wire bytes ---

function parseTransaction(wire) {
  let at = 0;
  const signatures = [];
  for (let i = wire[at++]; i > 0; i -= 1) signatures.push(wire.subarray(at, (at += 64)));
  const message = wire.subarray(at);
  const [signerCount] = [message[0]];
  let p = 3;
  const keyList = [];
  for (let n = message[p++]; n > 0; n -= 1) keyList.push(message.subarray(p, (p += 32)));
  p += 32; // blockhash
  const instructions = [];
  for (let n = message[p++]; n > 0; n -= 1) {
    const programId = encodeBase58(keyList[message[p++]]);
    const accounts = [];
    for (let k = message[p++]; k > 0; k -= 1) accounts.push(message[p++]);
    let length = message[p++];
    if (length & 0x80) length = (length & 0x7f) | (message[p++] << 7);
    instructions.push({ programId, accounts, data: message.subarray(p, (p += length)) });
  }
  return { signatures, message, signerCount, keyList, instructions };
}

function fakeDevnet({ genesis = DEVNET_GENESIS_HASH } = {}) {
  const accounts = new Map([[PROGRAM_ID, { owner: "BPFLoaderUpgradeab1e11111111111111111111111", data: new Uint8Array(36) }]]);
  const sent = [];
  let slot = 1000;
  const put = (address, data) => accounts.set(encodeBase58(address), { owner: PROGRAM_ID, data });

  function apply(wire, { verifySignatures = true } = {}) {
    const tx = parseTransaction(wire);
    tx.keyList.slice(0, tx.signerCount).forEach((key, i) => {
      if (verifySignatures && !verifyEd25519(key, tx.message, tx.signatures[i])) throw new Error("signature verification failed");
    });
    const signed = (index) => index < tx.signerCount;
    tx.instructions.forEach((ix, n) => {
      if (ix.programId !== PROGRAM_ID) return;
      const name = hex(ix.data.subarray(0, 8));
      const data = ix.data.subarray(8);
      const key = (i) => tx.keyList[ix.accounts[i]];
      if (name === hex(disc("global:init_ledger"))) {
        const logId = data.subarray(66, 66 + data[65]);
        const { address, bump } = ledgerAddress(Buffer.from(logId).toString());
        if (hex(address) !== hex(key(1)) || accounts.has(encodeBase58(address))) throw new Error("init_ledger refused");
        put(address, Uint8Array.from([...disc("account:Ledger"), 1, bump, data[64], ...data.subarray(0, 32), ...keccak256(logId), ...data.subarray(32, 64), ...u64(0), ...u64(0), 0, 0, 0, 0, 0]));
      } else if (name === hex(disc("global:anchor_head"))) {
        const ledger = accounts.get(encodeBase58(key(2))).data;
        if (!signed(ix.accounts[0]) || hex(key(0)) !== hex(ledger.subarray(11, 43))) throw new Error("Unauthorized");
        const treeSize = readU64(data, 0);
        const head = { logId: Buffer.from(data.subarray(49, 49 + data[48])).toString(), treeSize, timestamp: readU64(data, 8), root: data.subarray(16, 48) };
        const prev = tx.instructions[n - 1];
        if (prev?.programId !== ED25519_PROGRAM) throw new Error("MissingSignatureCheck");
        const d = prev.data;
        const pk = d.subarray(16, 48);
        if (hex(pk) !== hex(ledger.subarray(75, 107)) || hex(d.subarray(112)) !== hex(treeHeadPreimage(head))) throw new Error("SignatureBindingMismatch");
        if (!verifyEd25519(pk, d.subarray(112), d.subarray(48, 112))) throw new Error("ed25519 precompile failed");
        if (readU64(ledger, 115) > 0 && treeSize <= readU64(ledger, 107)) throw new Error("SequenceMismatch");
        const { address, bump } = rootAddress(key(2), treeSize);
        if (hex(address) !== hex(key(3))) throw new Error("InvalidSeeds");
        slot += 1;
        put(address, Uint8Array.from([...disc("account:RootEntry"), 1, bump, ...u64(treeSize), ...head.root, ...new Uint8Array(32), ...u64(treeSize), ...u64(head.timestamp), ...u64(slot), ...u64(1790000000), ...key(0), 0, 0, 0, 0, 0, 0]));
        ledger.set(u64(treeSize), 107);
        ledger.set(u64(readU64(ledger, 115) + 1), 115);
      } else if (name === hex(disc("global:verify_inclusion"))) {
        const root = accounts.get(encodeBase58(key(1)))?.data;
        const treeSize = readU64(data, 0);
        const path = [];
        for (let at = 48; at < data.length; at += 32) path.push(data.subarray(at, at + 32));
        if (!root || !verifyInclusion(data.subarray(8, 40), readU64(data, 40), treeSize, path, root.subarray(18, 50))) throw new Error("InvalidProof");
      } else {
        throw new Error("unknown instruction");
      }
    });
  }

  const rpc = {
    genesisHash: async () => genesis,
    getAccount: async (address) => {
      const account = accounts.get(typeof address === "string" ? address : encodeBase58(address));
      return account ? { ...account, lamports: 1, slot } : null;
    },
    getBalance: async () => 500_000_000,
    latestBlockhash: async () => encodeBase58(new Uint8Array(32).fill(9)),
    sendAndConfirm: async (wire) => {
      apply(wire);
      sent.push(wire);
      return `SIG${sent.length}`;
    },
    // Like simulateTransaction with sigVerify off: checks run, nothing lands.
    simulate: async (wire) => {
      const snapshot = new Map([...accounts].map(([k, v]) => [k, { ...v, data: v.data.slice() }]));
      try {
        apply(wire, { verifySignatures: false });
        return { err: null, logs: [] };
      } catch (error) {
        return { err: { InstructionError: [0, error.message] }, logs: [] };
      } finally {
        accounts.clear();
        for (const [k, v] of snapshot) accounts.set(k, v);
      }
    },
  };
  return { rpc, accounts, sent, put };
}

const creator = signerFromSeed(new Uint8Array(32).fill(1));
const collaborator = signerFromSeed(new Uint8Array(32).fill(2));
const bytes = (text) => new TextEncoder().encode(text);

function demoLogLines(count) {
  const log = createAttributionLog({ network: "devnet", headSigner: keys.logKey });
  for (let i = 0; i < count; i += 1) {
    const text = claimText({
      action: "credit",
      network: "devnet",
      creator: encodeBase58(creator.publicKey),
      binding: "bb".repeat(32),
      work: ["clip", "edit", "guest_segment"][i % 3],
      scope: hex(createHash("sha256").update(`scope ${i}`).digest()),
      deliverable: hex(createHash("sha256").update(`deliverable ${i}`).digest()),
      collaborator: encodeBase58(collaborator.publicKey),
    });
    log.append({ text, creatorSignature: creator.sign(bytes(text)), collaboratorSignature: collaborator.sign(bytes(text)) });
  }
  return log.toLines();
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "radiolan-anchor-"));
}

// --- tests ---

test("status reads the chain and prints public keys, never seeds", async () => {
  const { rpc } = fakeDevnet();
  const out = await status({ rpc, env: ENV });
  assert.equal(out.network, "devnet");
  assert.equal(out.program_exists, true);
  assert.equal(out.ledger_exists, false);
  assert.equal(out.ledger, encodeBase58(ledgerAddress("radiolan.attribution.v1").address));
  assert.equal(out.our_authority, encodeBase58(keys.authority.publicKey));
  const text = JSON.stringify(out);
  assert.equal(text.includes(AUTHORITY_SEED), false);
  assert.equal(text.includes(LOG_SEED), false);
  assert.equal("our_authority" in (await status({ rpc, env: {} })), false);
});

test("init creates our ledger once and then recognises it", async () => {
  const { rpc, sent } = fakeDevnet();
  const first = await init({ rpc, env: ENV });
  assert.equal(first.created, true);
  const second = await init({ rpc, env: ENV });
  assert.equal(second.created, false);
  assert.equal(sent.length, 1);
  const out = await status({ rpc, env: ENV });
  assert.equal(out.scheme, 2);
  assert.equal(out.authority, out.our_authority);
  assert.equal(out.trusted_signer, out.our_trusted_signer);
});

test("a squatted log id is refused, and nothing is sent", async () => {
  const { rpc, sent } = fakeDevnet();
  const squatter = keysFrom({ RADIOLAN_ATTRIBUTION_AUTHORITY_SEED: "c3".repeat(32), RADIOLAN_ATTRIBUTION_LOG_SEED: LOG_SEED });
  await init({ rpc, env: { RADIOLAN_ATTRIBUTION_AUTHORITY_SEED: "c3".repeat(32), RADIOLAN_ATTRIBUTION_LOG_SEED: LOG_SEED } });
  assert.notEqual(encodeBase58(squatter.authority.publicKey), encodeBase58(keys.authority.publicKey));
  await assert.rejects(init({ rpc, env: ENV }), /held by someone else \(authority/);
  await assert.rejects(anchor({ rpc, env: ENV, logLines: demoLogLines(1) }), /held by someone else/);
  assert.equal(sent.length, 1); // only the squatter's own init
});

test("sending refuses any cluster but devnet", async () => {
  const { rpc, sent } = fakeDevnet({ genesis: MAINNET_GENESIS_HASH });
  await assert.rejects(init({ rpc, env: ENV }), /not devnet/);
  await assert.rejects(anchor({ rpc, env: ENV, logLines: demoLogLines(1) }), /not devnet/);
  assert.equal(sent.length, 0);
});

test("missing or malformed seeds fail by name, never by value", async () => {
  const { rpc } = fakeDevnet();
  await assert.rejects(init({ rpc, env: {} }), /RADIOLAN_ATTRIBUTION_AUTHORITY_SEED must be set/);
  const bad = { ...ENV, RADIOLAN_ATTRIBUTION_LOG_SEED: "zz-secret-value" };
  await assert.rejects(init({ rpc, env: bad }), (error) => /RADIOLAN_ATTRIBUTION_LOG_SEED/.test(error.message) && !error.message.includes("zz-secret-value"));
});

test("anchor puts a signed head on chain and writes receipts that verify against it", async () => {
  const { rpc } = fakeDevnet();
  await init({ rpc, env: ENV });
  const dir = tempDir();
  try {
    const result = await anchor({ rpc, env: ENV, logLines: demoLogLines(3), outDir: dir, now: () => 1790000000 });
    assert.equal(result.head.tree_size, 3);
    assert.equal(result.trusted_signer, encodeBase58(keys.logKey.publicKey));
    assert.deepEqual(readdirSync(dir).sort(), ["anchor.json", "receipt-0.json", "receipt-1.json", "receipt-2.json"]);
    for (const index of [0, 1, 2]) {
      const receipt = JSON.parse(readFileSync(join(dir, `receipt-${index}.json`), "utf8"));
      const checked = await verify({ rpc, receipt });
      assert.equal(checked.ok, true);
      assert.equal(checked.index, index);
      assert.equal(checked.tree_size, 3);
      assert.deepEqual(checked.checks, ["receipt_offline", "head_key_from_chain", "anchored_root_matches", "program_verify_inclusion"]);
    }
    const anchored = JSON.parse(readFileSync(join(dir, "anchor.json"), "utf8"));
    assert.equal(anchored.root_account, result.root_account);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("anchoring the same size twice is refused before sending; a larger log anchors", async () => {
  const { rpc, sent } = fakeDevnet();
  await init({ rpc, env: ENV });
  await anchor({ rpc, env: ENV, logLines: demoLogLines(2) });
  await assert.rejects(anchor({ rpc, env: ENV, logLines: demoLogLines(2) }), /already anchored size 2/);
  assert.equal(sent.length, 2);
  const bigger = await anchor({ rpc, env: ENV, logLines: demoLogLines(4) });
  assert.equal(bigger.head.tree_size, 4);
});

test("verify fails on a tampered receipt, an unanchored head, or a head key the chain does not hold", async () => {
  const { rpc } = fakeDevnet();
  await init({ rpc, env: ENV });
  const dir = tempDir();
  try {
    await anchor({ rpc, env: ENV, logLines: demoLogLines(3), outDir: dir });
    const receipt = JSON.parse(readFileSync(join(dir, "receipt-1.json"), "utf8"));
    await assert.rejects(verify({ rpc, receipt: { ...receipt, salt: "00".repeat(32) } }), /does not verify: commitment/);

    // A head signed by the right key at a size nobody anchored.
    const unanchored = loadAttributionLog(demoLogLines(5), { network: "devnet", headSigner: keys.logKey });
    unanchored.signHead();
    await assert.rejects(verify({ rpc, receipt: unanchored.receipt(0) }), /no head of size 5 is anchored/);

    // The same receipt checked against a chain whose ledger holds a different head key.
    const other = fakeDevnet();
    await init({ rpc: other.rpc, env: { ...ENV, RADIOLAN_ATTRIBUTION_LOG_SEED: "d4".repeat(32) } });
    await assert.rejects(verify({ rpc: other.rpc, receipt }), /head signature does not verify/);

    await assert.rejects(verify({ rpc, receipt: { ...receipt, text: "nope" } }), /network/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify refuses a head that differs from the anchored one, and a program rejection", async () => {
  const { rpc } = fakeDevnet();
  await init({ rpc, env: ENV });
  const lines = demoLogLines(3);
  await anchor({ rpc, env: ENV, logLines: lines, now: () => 1790000000 });
  // Same size and root, signed later: valid offline, but not the head on chain.
  const later = loadAttributionLog(lines, { network: "devnet", headSigner: keys.logKey, now: () => 1790000999 });
  later.signHead();
  await assert.rejects(verify({ rpc, receipt: later.receipt(0) }), /differs from the receipt's head/);

  const onTime = loadAttributionLog(lines, { network: "devnet", headSigner: keys.logKey, now: () => 1790000000 });
  onTime.signHead();
  assert.equal((await verify({ rpc, receipt: onTime.receipt(0) })).ok, true);
  const rejecting = { ...rpc, simulate: async () => ({ err: { InstructionError: [0, { Custom: 6 }] }, logs: [] }) };
  await assert.rejects(verify({ rpc: rejecting, receipt: onTime.receipt(0) }), /program rejected inclusion/);
  const unrunnable = { ...rpc, simulate: async () => ({ err: "AccountNotFound", logs: [] }) };
  await assert.rejects(verify({ rpc: unrunnable, receipt: onTime.receipt(0) }), /on-chain check could not run: "AccountNotFound"/);
});

test("main prints one JSON result and returns an exit code", async () => {
  const logged = [];
  const original = { log: console.log, error: console.error };
  console.log = (line) => logged.push(["out", line]);
  console.error = (line) => logged.push(["err", line]);
  try {
    assert.equal(await main(["nonsense"], {}), 1);
    assert.match(logged.at(-1)[1], /usage: status/);
    assert.equal(await main(["anchor"], ENV), 1);
    assert.match(logged.at(-1)[1], /--log/);
    assert.equal(await main(["verify"], {}), 1);
    assert.match(logged.at(-1)[1], /receipt file/);
  } finally {
    Object.assign(console, original);
  }
  assert.equal(logged.some(([, line]) => line.includes(AUTHORITY_SEED)), false);
});

test("the ledger and head keys stay separate", () => {
  assert.notEqual(encodeBase58(keys.authority.publicKey), encodeBase58(keys.logKey.publicKey));
  assert.equal(decodeBase58(encodeBase58(keys.logKey.publicKey)).length, 32);
});
