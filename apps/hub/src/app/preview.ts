// Design-review controls. Off unless the URL carries ?preview=sample or ?preview=today; the live hub never
// shows them and never reads a fixture. The state lives in the URL so every reviewed state has a link.
import { useSyncExternalStore } from "react";

import type { Scenario } from "../data/types";

export type DataState = "ready" | "loading" | "error";
export type Position = "none" | "active" | "requested" | "releasable";
export type FlowStep = "edit" | "connect" | "review" | "signing" | "done" | "failed";
export type FailKind = "cancelled" | "simulation" | "network" | "expired";

export interface PreviewState {
  enabled: boolean;
  scenario: Scenario;
  data: DataState;
  joined: boolean;
  position: Position;
  flow: FlowStep;
  fail: FailKind;
}

const pick = <T extends string>(params: URLSearchParams, key: string, allowed: readonly T[], fallback: T): T => {
  const value = params.get(key);
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
};

export function readPreview(search: string): PreviewState {
  const params = new URLSearchParams(search);
  const mode = params.get("preview");
  const enabled = mode === "sample" || mode === "today";
  if (!enabled) return { enabled, scenario: "today", data: "ready", joined: true, position: "none", flow: "edit", fail: "cancelled" };
  return {
    enabled,
    scenario: mode === "sample" ? "sample" : "today",
    data: pick(params, "data", ["ready", "loading", "error"] as const, "ready"),
    joined: params.get("joined") !== "0",
    position: pick(params, "position", ["none", "active", "requested", "releasable"] as const, "none"),
    flow: pick(params, "flow", ["edit", "connect", "review", "signing", "done", "failed"] as const, "edit"),
    fail: pick(params, "fail", ["cancelled", "simulation", "network", "expired"] as const, "cancelled"),
  };
}

export function writePreview(next: PreviewState) {
  const params = new URLSearchParams();
  params.set("preview", next.scenario);
  if (next.data !== "ready") params.set("data", next.data);
  if (!next.joined) params.set("joined", "0");
  if (next.position !== "none") params.set("position", next.position);
  if (next.flow !== "edit") params.set("flow", next.flow);
  if (next.fail !== "cancelled") params.set("fail", next.fail);
  window.history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
  window.dispatchEvent(new Event("hub:preview"));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener("hub:preview", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hub:preview", onChange);
    window.removeEventListener("popstate", onChange);
  };
};

export function usePreview(): PreviewState {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  return readPreview(search);
}
