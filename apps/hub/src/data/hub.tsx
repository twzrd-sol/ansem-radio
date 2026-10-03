import { createContext, useContext, type ReactNode } from "react";

import type { HubSnapshot } from "./types";

export type HubLoad =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; snapshot: HubSnapshot };

const HubContext = createContext<HubLoad>({ status: "loading" });

export function HubProvider({ value, children }: { value: HubLoad; children: ReactNode }) {
  return <HubContext.Provider value={value}>{children}</HubContext.Provider>;
}

export const useHub = () => useContext(HubContext);

export const isSample = (load: HubLoad) => load.status === "ready" && load.snapshot.scenario === "sample";
