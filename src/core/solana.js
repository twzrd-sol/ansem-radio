// Minimal Solana: program-derived addresses, legacy transactions and JSON-RPC.
// Hand-rolled (operator, 2026-10-01): package.json has no dependencies. Account
// order and byte layout follow solana-sdk's legacy Message, so a message built
// here is byte-identical to one the Rust SDK builds for the same instructions.

import { createHash } from "node:crypto";

import { decodeBase58, encodeBase58 } from "./base58.js";

// --- Ed25519 curve membership, for program-derived addresses ---

const P = 2n ** 255n - 19n;
const mod = (a) => ((a % P) + P) % P;
function power(base, exponent) {
  let result = 1n;
  let b = mod(base);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}
const D = mod(-121665n * power(121666n, P - 2n));

/**
 * Whether 32 bytes decompress to an Ed25519 point, as curve25519-dalek's
 * CompressedEdwardsY::decompress decides it: y is read little-endian without
 * the sign bit, and the point exists iff (y^2 - 1) / (d y^2 + 1) is a square.
 */
export function isOnCurve(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new TypeError("expected 32 bytes");
  let y = 0n;
  for (let i = 31; i >= 0; i -= 1) y = (y << 8n) | BigInt(bytes[i]);
  y = mod(y & ((1n << 255n) - 1n));
  const yy = (y * y) % P;
  const u = mod(yy - 1n);
  const v = mod(D * yy + 1n);
  if (u === 0n) return true;
  return power((u * power(v, P - 2n)) % P, (P - 1n) / 2n) === 1n;
}

const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");

function toKey(value) {
  const bytes = typeof value === "string" ? decodeBase58(value) : value;
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new TypeError("a public key must be 32 bytes");
  return bytes;
}

/** Program-derived address: the first bump from 255 down whose hash is off the curve. */
export function findProgramAddress(seeds, programId) {
  const program = toKey(programId);
  if (seeds.length > 15 || seeds.some((seed) => !(seed instanceof Uint8Array) || seed.length > 32)) {
    throw new TypeError("seeds must be at most 15 byte arrays of at most 32 bytes");
  }
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = createHash("sha256");
    for (const seed of seeds) hash.update(seed);
    hash.update(Uint8Array.of(bump)).update(program).update(PDA_MARKER);
    const address = new Uint8Array(hash.digest());
    if (!isOnCurve(address)) return { address, bump };
  }
  throw new Error("no valid program address");
}

// --- legacy transactions ---

export function compactU16(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError("compact-u16 out of range");
  const out = [];
  let rest = value;
  for (;;) {
    const byte = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(byte);
      return Uint8Array.from(out);
    }
    out.push(byte | 0x80);
  }
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function compareBytes(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Compile instructions into a legacy message. Each instruction is
 * { programId, keys: [{ pubkey, isSigner, isWritable }], data }. The fee payer
 * comes first; the rest are grouped as writable signers, read-only signers,
 * writable non-signers and read-only non-signers, each sorted by key bytes.
 * Returns { bytes, accountKeys, signerCount }.
 */
export function compileLegacyMessage({ feePayer, instructions, recentBlockhash }) {
  const metas = new Map();
  const add = (pubkey, isSigner, isWritable) => {
    const key = toKey(pubkey);
    const id = encodeBase58(key);
    const meta = metas.get(id) ?? { key, isSigner: false, isWritable: false };
    meta.isSigner ||= isSigner;
    meta.isWritable ||= isWritable;
    metas.set(id, meta);
  };
  const payer = encodeBase58(toKey(feePayer));
  add(feePayer, true, true);
  for (const ix of instructions) {
    for (const account of ix.keys) add(account.pubkey, account.isSigner, account.isWritable);
    add(ix.programId, false, false);
  }

  const rest = [...metas.entries()].filter(([id]) => id !== payer).map(([, meta]) => meta);
  const group = (signer, writable) =>
    rest.filter((m) => m.isSigner === signer && m.isWritable === writable).sort((a, b) => compareBytes(a.key, b.key));
  const ordered = [metas.get(payer), ...group(true, true), ...group(true, false), ...group(false, true), ...group(false, false)];
  const index = new Map(ordered.map((meta, i) => [encodeBase58(meta.key), i]));
  const signerCount = ordered.filter((m) => m.isSigner).length;
  const readonlySigned = ordered.filter((m) => m.isSigner && !m.isWritable).length;
  const readonlyUnsigned = ordered.filter((m) => !m.isSigner && !m.isWritable).length;
  if (ordered.length > 255) throw new RangeError("too many accounts");

  const blockhash = toKey(recentBlockhash);
  const compiled = instructions.map((ix) => {
    const accounts = ix.keys.map((account) => index.get(encodeBase58(toKey(account.pubkey))));
    return concat([
      Uint8Array.of(index.get(encodeBase58(toKey(ix.programId)))),
      compactU16(accounts.length),
      Uint8Array.from(accounts),
      compactU16(ix.data.length),
      ix.data,
    ]);
  });
  const bytes = concat([
    Uint8Array.of(signerCount, readonlySigned, readonlyUnsigned),
    compactU16(ordered.length),
    ...ordered.map((meta) => meta.key),
    blockhash,
    compactU16(instructions.length),
    ...compiled,
  ]);
  return { bytes, accountKeys: ordered.map((meta) => meta.key), signerCount };
}

/**
 * Sign a compiled message. `signers` are { publicKey, sign } and must cover
 * every required signer. Returns the wire bytes and the first signature (the
 * transaction id).
 */
export function signTransaction(message, signers) {
  const byKey = new Map(signers.map((signer) => [encodeBase58(signer.publicKey), signer]));
  const signatures = message.accountKeys.slice(0, message.signerCount).map((key) => {
    const signer = byKey.get(encodeBase58(key));
    if (!signer) throw new Error(`missing signer ${encodeBase58(key)}`);
    return signer.sign(message.bytes);
  });
  const wire = concat([compactU16(signatures.length), ...signatures, message.bytes]);
  if (wire.length > 1232) throw new RangeError("transaction is larger than 1232 bytes");
  return { wire, signature: encodeBase58(signatures[0]) };
}

// --- JSON-RPC ---

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

/** A JSON-RPC client. `fetchImpl` is injectable for tests. */
export function createRpc(url, { fetchImpl = fetch } = {}) {
  let id = 0;
  async function call(method, params = []) {
    id += 1;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
    return body.result;
  }

  return Object.freeze({
    call,

    /** Account data and owner, or null when the account does not exist. */
    async getAccount(address) {
      const result = await call("getAccountInfo", [encodeBase58(toKey(address)), { encoding: "base64", commitment: "confirmed" }]);
      if (!result?.value) return null;
      return {
        owner: result.value.owner,
        lamports: result.value.lamports,
        data: new Uint8Array(Buffer.from(result.value.data[0], "base64")),
        slot: result.context.slot,
      };
    },

    async getBalance(address) {
      return (await call("getBalance", [encodeBase58(toKey(address)), { commitment: "confirmed" }])).value;
    },

    async latestBlockhash() {
      return (await call("getLatestBlockhash", [{ commitment: "confirmed" }])).value.blockhash;
    },

    genesisHash: () => call("getGenesisHash"),

    /** Send wire bytes and wait until confirmed. Throws on a failed transaction. */
    async sendAndConfirm(wire, { timeoutMs = 60_000, pollMs = 1_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
      const signature = await call("sendTransaction", [
        Buffer.from(wire).toString("base64"),
        { encoding: "base64", preflightCommitment: "confirmed" },
      ]);
      for (let waited = 0; waited <= timeoutMs; waited += pollMs) {
        let status;
        try {
          status = (await call("getSignatureStatuses", [[signature]])).value[0];
        } catch (error) {
          // Public RPCs rate-limit polling (HTTP 429); the transaction is already sent, so wait and poll again.
          if (/HTTP 429/.test(error.message)) {
            await sleep(pollMs);
            continue;
          }
          throw error;
        }
        if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
        if (status && ["confirmed", "finalized"].includes(status.confirmationStatus)) return signature;
        await sleep(pollMs);
      }
      throw new Error(`transaction ${signature} not confirmed in ${timeoutMs} ms`);
    },

    /** Run a transaction without signatures or fees landing; returns { err, logs }. */
    async simulate(wire) {
      const result = await call("simulateTransaction", [
        Buffer.from(wire).toString("base64"),
        { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" },
      ]);
      return { err: result.value.err, logs: result.value.logs ?? [] };
    },
  });
}
