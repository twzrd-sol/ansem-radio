// The live hub state: the API's snapshot, refreshed after every action. Off in a design preview.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createHubApi, type ApiState, type HubApi } from "./api";
import { buildToday } from "./today";
import { watchVisible } from "./refresh";
import type { HubSnapshot } from "./types";

export interface LiveHub {
  load: "loading" | "error" | "ready";
  state: ApiState | null;
  snapshot: HubSnapshot;
  refresh: () => Promise<void>;
  api: HubApi;
}

export function useLiveHub(enabled: boolean, given?: HubApi): LiveHub {
  // One client for the page's life: it holds the CSRF token, and a new one per render would refetch forever.
  const [api] = useState(() => given ?? createHubApi());
  const [load, setLoad] = useState<LiveHub["load"]>("loading");
  const [state, setState] = useState<ApiState | null>(null);
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await api.state();
      // A session the cookie holds needs its CSRF token before the first write.
      if (next.me && !api.hasSession) await api.me();
      if (request !== latest.current) return;
      setState(next);
      setLoad("ready");
    } catch {
      if (request !== latest.current) return;
      setLoad("error");
    }
  }, [api]);
  useEffect(() => {
    if (enabled) return watchVisible(refresh);
  }, [enabled, refresh]);
  const snapshot = useMemo(() => buildToday(state), [state]);
  return { load, state, snapshot, refresh, api };
}
