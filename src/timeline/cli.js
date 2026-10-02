#!/usr/bin/env node
/**
 * npm run timeline -- summary [--hours N | --days N] [--json]
 * Reads the local timeline (RADIO_LAN_TIMELINE_DIR). Internal view; do not publish
 * its output. The ingest itself runs inside the live room
 * with RADIO_LAN_TIMELINE=1.
 */

import { pathToFileURL } from "node:url";

import { createTimelineStore } from "./store.js";
import { AFFILIATE_THRESHOLDS, formatSummary, summarize } from "./summary.js";

function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

export function main(argv = process.argv.slice(2), { env = process.env, clock = Date.now, print = (l) => console.log(l), store } = {}) {
  const [command, ...args] = argv;
  if (command !== "summary") {
    print("usage: timeline summary [--hours N | --days N] [--json]");
    return 2;
  }
  const hours = option(args, "--days") ? Number(option(args, "--days")) * 24 : Number(option(args, "--hours") ?? 24);
  if (!Number.isFinite(hours) || hours <= 0) {
    print("--hours and --days must be positive numbers");
    return 2;
  }
  let thresholds = AFFILIATE_THRESHOLDS;
  if (env.RADIO_LAN_AFFILIATE_THRESHOLDS) {
    try {
      thresholds = { ...AFFILIATE_THRESHOLDS, ...JSON.parse(env.RADIO_LAN_AFFILIATE_THRESHOLDS) };
    } catch {
      print("RADIO_LAN_AFFILIATE_THRESHOLDS is not JSON");
      return 2;
    }
  }
  const timeline = store ?? createTimelineStore({ dir: env.RADIO_LAN_TIMELINE_DIR || undefined, clock });
  const now = clock();
  const lookback = Math.max(hours, thresholds.window_days * 24) * 3_600_000;
  const culture = typeof timeline.readCulture === "function" ? timeline.readCulture({ since: now - hours * 3_600_000 }) : [];
  const summary = summarize(timeline.readMinutes({ since: now - lookback }), timeline.readGaps({ since: now - lookback }), { now, hours, thresholds, culture });
  print(args.includes("--json") ? JSON.stringify(summary, null, 2) : formatSummary(summary));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
