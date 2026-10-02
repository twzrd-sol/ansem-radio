// Base58 (Bitcoin alphabet), as Solana uses it for public keys and signatures.
// Hand-rolled: package.json has no dependencies (operator, 2026-10-01).

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map([...ALPHABET].map((char, value) => [char, value]));

export function encodeBase58(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("base58 input must be a Uint8Array");
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = []; // base 58, least significant first
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((digit) => ALPHABET[digit]).join("");
}

export function decodeBase58(text) {
  if (typeof text !== "string") throw new TypeError("base58 input must be a string");
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;
  const bytes = []; // base 256, least significant first
  for (let i = zeros; i < text.length; i += 1) {
    const value = INDEX.get(text[i]);
    if (value === undefined) throw new TypeError(`invalid base58 character: ${JSON.stringify(text[i])}`);
    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  out.set(bytes.reverse(), zeros);
  return out;
}

/** A 32-byte Solana public key from its base58 text. Throws on anything else. */
export function decodePublicKey(text, field = "public key") {
  let bytes;
  try {
    bytes = decodeBase58(text);
  } catch {
    throw new TypeError(`${field} must be base58`);
  }
  if (bytes.length !== 32) throw new TypeError(`${field} must be 32 bytes`);
  return bytes;
}
