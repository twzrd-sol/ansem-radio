// Wallets through Wallet Standard (plan section 8). Extensions and in-wallet browsers register themselves; on Android
// Chrome, Mobile Wallet Adapter registers itself through @solana-mobile/wallet-standard-mobile. The page builds the
// transaction, the wallet only signs, and the page sends it through the relay. Nothing here holds a key.
import { address } from "@solana/kit";
import { createDefaultAuthorizationCache, createDefaultChainSelector, registerMwa } from "@solana-mobile/wallet-standard-mobile";
import { SolanaSignMessage, SolanaSignTransaction, type SolanaSignMessageFeature, type SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet } from "@wallet-standard/base";
import { StandardConnect, StandardEvents, type StandardConnectFeature, type StandardEventsFeature } from "@wallet-standard/features";
import { useEffect, useState } from "react";

import { CHAIN, NETWORK_LABEL } from "./config";
import type { ConnectedWallet } from "../data/wallet-session";

/** A wallet the hub can use: it connects, signs a transaction without sending it, and offers the build's network. */
export const isUsable = (wallet: Wallet) => StandardConnect in wallet.features && SolanaSignTransaction in wallet.features && wallet.chains.includes(CHAIN);

/** Dispatched when Mobile Wallet Adapter finds no wallet app, so the page can say so in its own words. */
export const NO_WALLET_APP_EVENT = "hub:no-wallet-app";

/**
 * Register Mobile Wallet Adapter. The package registers only where it works (Android, a secure context, not a
 * webview); elsewhere it logs and does nothing. Its own "wallet not found" modal is replaced by the page's message.
 */
export function registerMobileWallet() {
  registerMwa({
    appIdentity: { name: "Radio LAN", uri: window.location.origin },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: [CHAIN],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: async () => {
      window.dispatchEvent(new Event(NO_WALLET_APP_EVENT));
    },
  });
}

/** The usable wallets right now, for code that is not a component (the positions screen's one-tap read). */
export const listWallets = (): Wallet[] => getWallets().get().filter(isUsable);

export function useWallets(): Wallet[] {
  const [wallets, setWallets] = useState<Wallet[]>(() => getWallets().get().filter(isUsable));
  useEffect(() => {
    const api = getWallets();
    const update = () => setWallets(api.get().filter(isUsable));
    const offRegister = api.on("register", update);
    const offUnregister = api.on("unregister", update);
    update();
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);
  return wallets;
}

/** Connect (only when the fan taps an on-chain action) and return the port the flow signs through. */
export async function connectWallet(wallet: Wallet): Promise<ConnectedWallet> {
  const connect = (wallet.features as StandardConnectFeature)[StandardConnect];
  const { accounts } = await connect.connect();
  const account = accounts.find((a) => a.chains.includes(CHAIN) && a.features.includes(SolanaSignTransaction));
  if (!account) throw new Error(`The wallet returned no account that can sign on ${NETWORK_LABEL}.`);
  const sign = (wallet.features as SolanaSignTransactionFeature)[SolanaSignTransaction];
  const messages = (wallet.features as Partial<SolanaSignMessageFeature>)[SolanaSignMessage];
  const stillConnected = (a: typeof account) => a.address === account.address && a.chains.includes(CHAIN) && a.features.includes(SolanaSignTransaction);
  return {
    address: address(account.address),
    walletName: wallet.name,
    ...(messages && account.features.includes(SolanaSignMessage) ? { async signMessage(message: Uint8Array) {
      if (!wallet.accounts.some((a) => stillConnected(a) && a.features.includes(SolanaSignMessage))) throw new Error("The wallet account changed. Review the link again.");
      const [result] = await messages.signMessage({ account, message });
      if (!wallet.accounts.some((a) => stillConnected(a) && a.features.includes(SolanaSignMessage))) throw new Error("The wallet account changed. Review the link again.");
      if (!result || result.signature.length !== 64 || (result.signatureType && result.signatureType !== "ed25519") || result.signedMessage.length !== message.length || !result.signedMessage.every((byte, i) => byte === message[i])) throw new Error("The wallet did not sign the exact link message. Nothing was linked.");
      return result.signature;
    } } : {}),
    onInvalidated(clear) {
      const events = (wallet.features as Partial<StandardEventsFeature>)[StandardEvents];
      const offChange = events?.on("change", ({ accounts: changed }) => {
        if (changed && !changed.some(stillConnected)) clear();
      });
      const offUnregister = getWallets().on("unregister", (...wallets) => { if (wallets.includes(wallet)) clear(); });
      return () => { offChange?.(); offUnregister(); };
    },
    async signTransaction(wire) {
      if (!wallet.accounts.some(stillConnected)) throw new Error("The wallet account changed. Connect again and review this step.");
      const [result] = await sign.signTransaction({ account, transaction: wire, chain: CHAIN });
      if (!result) throw new Error("The wallet returned no signed transaction.");
      return result.signedTransaction;
    },
  };
}

/** Where to send a fan with no wallet on this device (plan section 8: only tested combinations are promised). */
export function walletHelp(userAgent: string): { kind: "android" | "ios" | "desktop"; links: Array<[string, string]> } {
  const here = typeof window === "undefined" ? "" : window.location.href;
  const ref = typeof window === "undefined" ? "" : window.location.origin;
  if (/android/i.test(userAgent)) return { kind: "android", links: [] };
  if (/iphone|ipad|ipod/i.test(userAgent)) {
    return {
      kind: "ios",
      links: [
        ["Open in Phantom", `https://phantom.app/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(ref)}`],
        ["Open in Solflare", `https://solflare.com/ul/v1/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(ref)}`],
      ],
    };
  }
  return { kind: "desktop", links: [] };
}
