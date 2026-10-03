import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { describe, expect, it, vi } from "vitest";
import { connectWallet } from "./wallet";

const key = "A2fN4LCB5se9nDtttqQj6fx5yg3TpZLuphiZVJ4JZLyb";
const account = (chains: WalletAccount["chains"] = ["solana:devnet"]): WalletAccount => ({ address: key, publicKey: new Uint8Array(32), chains, features: ["solana:signTransaction"] });
function fakeWallet(initial: WalletAccount[], messages = false) {
  let accounts = initial;
  let listener: ((change: { accounts: WalletAccount[] }) => void) | null = null;
  const sign = vi.fn(async () => [{ signedTransaction: new Uint8Array([1]) }]);
  const message = vi.fn(async ({ message }: { message: Uint8Array }) => [{ signedMessage: message, signature: new Uint8Array(64) }]);
  const wallet = {
    version: "1.0.0", name: "Test wallet", icon: "data:image/png;base64,AA==", chains: ["solana:devnet"],
    get accounts() { return accounts; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts }) },
      "standard:events": { version: "1.0.0", on: (_name: string, next: typeof listener) => { listener = next; return () => { listener = null; }; } },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: [0], signTransaction: sign },
      ...(messages ? { "solana:signMessage": { version: "1.0.0", signMessage: message } } : {}),
    },
  } as Wallet;
  return { wallet, sign, message, change: (next: WalletAccount[]) => { accounts = next; listener?.({ accounts }); } };
}

describe("shared wallet connection", () => {
  it("connects for address reads without requesting a signature", async () => {
    const fake = fakeWallet([account()]);
    const port = await connectWallet(fake.wallet);
    expect(port.address).toBe(key);
    expect(port.walletName).toBe("Test wallet");
    expect(fake.sign).not.toHaveBeenCalled();
    await port.signTransaction(new Uint8Array([3]));
    expect(fake.sign).toHaveBeenCalledTimes(1);
  });

  it("clears a removed account and refuses to sign an old review", async () => {
    const fake = fakeWallet([account()]);
    const port = await connectWallet(fake.wallet);
    const clear = vi.fn();
    const stop = port.onInvalidated(clear);
    fake.change([]);
    expect(clear).toHaveBeenCalledTimes(1);
    await expect(port.signTransaction(new Uint8Array([3]))).rejects.toThrow("wallet account changed");
    expect(fake.sign).not.toHaveBeenCalled();
    stop();
    fake.change([]);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("never falls back to a mainnet-only account", async () => {
    const fake = fakeWallet([account(["solana:mainnet"])]);
    await expect(connectWallet(fake.wallet)).rejects.toThrow("no account that can sign on Solana devnet");
    expect(fake.sign).not.toHaveBeenCalled();
  });

  it("invalidates an account that stops offering transaction signing", async () => {
    const fake = fakeWallet([account()]);
    const port = await connectWallet(fake.wallet);
    const clear = vi.fn();
    const stop = port.onInvalidated(clear);
    fake.change([{ ...account(), features: [] }]);
    expect(clear).toHaveBeenCalledTimes(1);
    await expect(port.signTransaction(new Uint8Array([3]))).rejects.toThrow("wallet account changed");
    expect(fake.sign).not.toHaveBeenCalled();
    stop();
  });

  it("offers optional exact-message linking without a transaction or an automatic signature", async () => {
    const a: WalletAccount = { ...account(), features: [...account().features, "solana:signMessage"] };
    const fake = fakeWallet([a], true);
    const port = await connectWallet(fake.wallet);
    expect(port.signMessage).toBeTypeOf("function");
    expect(fake.message).not.toHaveBeenCalled();
    const text = new TextEncoder().encode("Radio LAN wallet link");
    expect(await port.signMessage!(text)).toHaveLength(64);
    expect(fake.message).toHaveBeenCalledWith({ account: a, message: text });
    expect(fake.sign).not.toHaveBeenCalled();
    expect((await connectWallet(fakeWallet([account()]).wallet)).signMessage).toBeUndefined();
  });

  it("rejects wallet message prefixes and an account change during the prompt", async () => {
    const a: WalletAccount = { ...account(), features: [...account().features, "solana:signMessage"] };
    const fake = fakeWallet([a], true);
    const port = await connectWallet(fake.wallet);
    fake.message.mockImplementationOnce(async () => [{ signedMessage: new Uint8Array([0]), signature: new Uint8Array(64) }]);
    await expect(port.signMessage!(new Uint8Array([1]))).rejects.toThrow("exact link message");
    fake.message.mockImplementationOnce(async ({ message }) => { fake.change([]); return [{ signedMessage: message, signature: new Uint8Array(64) }]; });
    await expect(port.signMessage!(new Uint8Array([1]))).rejects.toThrow("wallet account changed");
    expect(fake.sign).not.toHaveBeenCalled();
  });
});
