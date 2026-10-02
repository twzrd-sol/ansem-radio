// Keccak-256 as Solana programs and Ethereum use it (pad byte 0x01), plus
// SHA3-256 (pad byte 0x06) from the same sponge so tests can check the
// permutation against node:crypto, which has SHA3-256 but not Keccak-256.
// Written from the Keccak reference (FIPS 202 permutation, original padding);
// the round constants and rotation offsets match the evidence-ledger program's
// src/keccak.rs in attention-oracle-program. Lanes are 64-bit, held as two
// unsigned 32-bit halves (lo, hi) so no BigInt is needed.

const RATE = 136; // bytes: (1600 - 2 * 256) / 8
const RATE_LANES = RATE / 8;

// Round constants, split into low and high 32-bit halves.
const RC_LO = Uint32Array.of(
  0x00000001, 0x00008082, 0x0000808a, 0x80008000, 0x0000808b, 0x80000001,
  0x80008081, 0x00008009, 0x0000008a, 0x00000088, 0x80008009, 0x8000000a,
  0x8000808b, 0x0000008b, 0x00008089, 0x00008003, 0x00008002, 0x00000080,
  0x0000800a, 0x8000000a, 0x80008081, 0x00008080, 0x80000001, 0x80008008,
);
const RC_HI = Uint32Array.of(
  0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x00000000, 0x00000000,
  0x80000000, 0x80000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000,
  0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x00000000, 0x80000000,
);

// Rotation offset for lane x + 5y.
const RHO = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

// Destination of lane x + 5y under pi: (x, y) -> (y, 2x + 3y mod 5).
const PI = RHO.map((_, i) => {
  const x = i % 5;
  const y = Math.floor(i / 5);
  return y + 5 * ((2 * x + 3 * y) % 5);
});

function permute(lo, hi) {
  const cLo = new Uint32Array(5);
  const cHi = new Uint32Array(5);
  const bLo = new Uint32Array(25);
  const bHi = new Uint32Array(25);

  for (let round = 0; round < 24; round += 1) {
    // theta
    for (let x = 0; x < 5; x += 1) {
      cLo[x] = lo[x] ^ lo[x + 5] ^ lo[x + 10] ^ lo[x + 15] ^ lo[x + 20];
      cHi[x] = hi[x] ^ hi[x + 5] ^ hi[x + 10] ^ hi[x + 15] ^ hi[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const nextLo = cLo[(x + 1) % 5];
      const nextHi = cHi[(x + 1) % 5];
      const dLo = cLo[(x + 4) % 5] ^ ((nextLo << 1) | (nextHi >>> 31));
      const dHi = cHi[(x + 4) % 5] ^ ((nextHi << 1) | (nextLo >>> 31));
      for (let y = 0; y < 25; y += 5) {
        lo[x + y] ^= dLo;
        hi[x + y] ^= dHi;
      }
    }

    // rho and pi
    for (let i = 0; i < 25; i += 1) {
      const n = RHO[i];
      const l = lo[i];
      const h = hi[i];
      const j = PI[i];
      if (n === 0) {
        bLo[j] = l;
        bHi[j] = h;
      } else if (n < 32) {
        bLo[j] = (l << n) | (h >>> (32 - n));
        bHi[j] = (h << n) | (l >>> (32 - n));
      } else if (n === 32) {
        bLo[j] = h;
        bHi[j] = l;
      } else {
        const m = n - 32;
        bLo[j] = (h << m) | (l >>> (32 - m));
        bHi[j] = (l << m) | (h >>> (32 - m));
      }
    }

    // chi
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x += 1) {
        const a = y + ((x + 1) % 5);
        const b = y + ((x + 2) % 5);
        lo[y + x] = bLo[y + x] ^ (~bLo[a] & bLo[b]);
        hi[y + x] = bHi[y + x] ^ (~bHi[a] & bHi[b]);
      }
    }

    // iota
    lo[0] ^= RC_LO[round];
    hi[0] ^= RC_HI[round];
  }
}

function toBytes(part) {
  if (part instanceof Uint8Array) return part;
  if (typeof part === "string") return new TextEncoder().encode(part);
  throw new TypeError("hash input parts must be Uint8Array or string");
}

function sponge(parts, padByte) {
  const chunks = parts.map(toBytes);
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  // Always at least one padding byte, so a full final block adds a block.
  const padded = new Uint8Array((Math.floor(length / RATE) + 1) * RATE);
  let offset = 0;
  for (const chunk of chunks) {
    padded.set(chunk, offset);
    offset += chunk.length;
  }
  padded[length] ^= padByte;
  padded[padded.length - 1] ^= 0x80;

  const lo = new Uint32Array(25);
  const hi = new Uint32Array(25);
  for (let block = 0; block < padded.length; block += RATE) {
    for (let i = 0; i < RATE_LANES; i += 1) {
      const p = block + 8 * i;
      lo[i] ^= padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24);
      hi[i] ^= padded[p + 4] | (padded[p + 5] << 8) | (padded[p + 6] << 16) | (padded[p + 7] << 24);
    }
    permute(lo, hi);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i += 1) {
    for (let k = 0; k < 4; k += 1) {
      out[8 * i + k] = lo[i] >>> (8 * k);
      out[8 * i + 4 + k] = hi[i] >>> (8 * k);
    }
  }
  return out;
}

/**
 * Keccak-256 of the concatenation of `parts` (Uint8Array or UTF-8 string).
 * Returns 32 bytes. This is the hash the evidence-ledger program uses for
 * leaves, Merkle nodes and log_id PDAs. It is not SHA3-256.
 */
export function keccak256(...parts) {
  return sponge(parts, 0x01);
}

/** SHA3-256 from the same sponge. Exists so tests can check the permutation. */
export function sha3_256(...parts) {
  return sponge(parts, 0x06);
}
