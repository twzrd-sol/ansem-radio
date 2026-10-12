import { useEffect, useMemo, useState } from "react";

import { IS_MAINNET } from "../chain/config";
import { capHistory, reduceTape, type TapeBoard } from "./board";
import { DEMO_CHANNELS, demoEvents, readTapeDemo } from "./demo";
import { channelsFromListings, listingKey, tapeListings, type TapeEvent, type TapeListing } from "./events";
import { MAX_EVENTS } from "./policy";
import { createTapeClient, tapeWsUrl, type TapeStatus } from "./socket";

export type TapeMode = "live" | "demo" | "off";

export function useTape(listings: TapeListing[], search: string): {
  mode: TapeMode;
  status: TapeStatus;
  board: TapeBoard;
  retry: () => void;
} {
  const demo = readTapeDemo(search);
  const live = useMemo(() => tapeListings(listings, IS_MAINNET), [listingKey(listings)]);
  const key = listingKey(live);
  const channels = useMemo(() => (demo ? DEMO_CHANNELS : channelsFromListings(live)), [demo, key]);
  const [events, setEvents] = useState<TapeEvent[]>(() => (demo ? demoEvents() : []));
  const [status, setStatus] = useState<TapeStatus>(demo ? "live" : "connecting");
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (demo) {
      setEvents(demoEvents());
      setStatus("live");
      return;
    }
    setEvents([]);
    const url = tapeWsUrl();
    const client = createTapeClient({
      channels,
      url,
      onEvents: (incoming) => setEvents((current) => capHistory([...current, ...incoming], MAX_EVENTS)),
      onStatus: setStatus,
    });
    return () => client.stop();
  }, [channels, demo, retryTick]);

  return {
    mode: demo ? "demo" : "live",
    status: demo ? "live" : status,
    board: reduceTape(channels, events),
    retry: () => setRetryTick((n) => n + 1),
  };
}
