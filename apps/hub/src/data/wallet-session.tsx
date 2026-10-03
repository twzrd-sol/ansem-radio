import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { WalletPort } from "../chain/flow";

export interface ConnectedWallet extends WalletPort {
  walletName: string;
  onInvalidated: (clear: () => void) => () => void;
  /** Optional exact-message proof. Connecting alone never links a hub account. */
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
}
const Context = createContext<{ wallet: ConnectedWallet | null; setWallet: (wallet: ConnectedWallet | null) => void }>({ wallet: null, setWallet: () => {} });

/** A connection lasts across hub routes, in memory only. Wallet account changes invalidate every old review. */
export function WalletSessionProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  useEffect(() => wallet?.onInvalidated(() => setWallet(null)), [wallet]);
  const value = useMemo(() => ({ wallet, setWallet }), [wallet]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useWalletSession = () => useContext(Context);
