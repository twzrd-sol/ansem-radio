// Compiling a single arena instruction into the wire bytes a wallet signs. The fan is the fee payer and the only signer.
import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";

export interface Lifetime {
  blockhash: string;
  lastValidBlockHeight: bigint;
}

/** Unsigned transaction bytes (signature slots zeroed), ready to simulate and to hand to a wallet. */
export function compileWire(feePayer: Address, instruction: Instruction, lifetime: Lifetime): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: lifetime.blockhash as Blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstruction(instruction, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

export const decodeWire = (wire: Uint8Array) => getTransactionDecoder().decode(wire);

/** Base64 wire form for simulateTransaction and sendTransaction. */
export const wireBase64 = (wire: Uint8Array) => getBase64EncodedWireTransaction(decodeWire(wire));

/** The fee payer's signature (base58) of a signed transaction, which identifies it before it is sent. */
export const signatureOf = (signedWire: Uint8Array) => getSignatureFromTransaction(decodeWire(signedWire)) as string;

/** True when every signature slot of the decoded transaction is filled. */
export function isFullySigned(signedWire: Uint8Array): boolean {
  return Object.values(decodeWire(signedWire).signatures).every((s) => s !== null && s.some((b) => b !== 0));
}
