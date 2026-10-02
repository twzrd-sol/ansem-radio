/**
 * Timeline files, outside the repository:
 *   raw/<UTC hour>.jsonl     normalized events, deleted once older than 24 hours
 *   minutes/<UTC day>.jsonl  per-minute aggregates (counts only), local and internal
 *   culture/<UTC day>.jsonl  hourly per-streamer rollups of the tracked streamers
 *   gaps.jsonl               intervals when the ingest was disconnected
 * Nothing here is published or shared.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const RAW_RETENTION_HOURS = 24;

export function defaultTimelineDir(env = process.env) {
  return env.RADIO_LAN_TIMELINE_DIR || join(homedir(), ".local", "share", "radiolan", "timeline");
}

function lines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function createTimelineStore({ dir = defaultTimelineDir(), clock = Date.now } = {}) {
  for (const sub of ["", "raw", "minutes", "culture"]) mkdirSync(join(dir, sub), { recursive: true, mode: 0o700 });
  const write = (path, obj) => appendFileSync(path, `${JSON.stringify(obj)}\n`, { mode: 0o600 });

  return Object.freeze({
    dir,

    appendRaw(item) {
      const hour = new Date(clock()).toISOString().slice(0, 13);
      write(join(dir, "raw", `${hour}.jsonl`), { received_at: new Date(clock()).toISOString(), ...item });
    },

    appendMinute(bucket) {
      write(join(dir, "minutes", `${bucket.minute.slice(0, 10)}.jsonl`), bucket);
    },

    /** Hourly per-streamer culture rollups (derived counts; local, never published). */
    appendCulture(rollup) {
      write(join(dir, "culture", `${rollup.hour.slice(0, 10)}.jsonl`), rollup);
    },

    readCulture({ since = 0 } = {}) {
      const sinceDay = new Date(since).toISOString().slice(0, 10);
      return readdirSync(join(dir, "culture"))
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0, 10) >= sinceDay)
        .sort()
        .flatMap((name) => lines(join(dir, "culture", name)))
        .filter((rollup) => Date.parse(rollup.hour) >= since);
    },

    appendGap(gap) {
      write(join(dir, "gaps.jsonl"), gap);
    },

    /** Delete raw hour files whose whole hour ended more than 24 hours ago. Returns the names removed. */
    purgeRaw() {
      const cutoff = clock() - RAW_RETENTION_HOURS * 3_600_000;
      const removed = [];
      for (const name of readdirSync(join(dir, "raw"))) {
        const match = /^(\d{4}-\d{2}-\d{2}T\d{2})\.jsonl$/.exec(name);
        if (!match) continue;
        const hourEnd = Date.parse(`${match[1]}:00:00Z`) + 3_600_000;
        if (hourEnd <= cutoff) {
          rmSync(join(dir, "raw", name));
          removed.push(name);
        }
      }
      return removed;
    },

    readMinutes({ since = 0 } = {}) {
      const sinceDay = new Date(since).toISOString().slice(0, 10);
      return readdirSync(join(dir, "minutes"))
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0, 10) >= sinceDay)
        .sort()
        .flatMap((name) => lines(join(dir, "minutes", name)))
        .filter((bucket) => Date.parse(bucket.minute) >= since);
    },

    readGaps({ since = 0 } = {}) {
      return lines(join(dir, "gaps.jsonl")).filter((gap) => Date.parse(gap.end) >= since);
    },
  });
}
