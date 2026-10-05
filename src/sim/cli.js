#!/usr/bin/env node
/**
 * npm run sim -- [--preset small] [--seed N] [--streams N] [--farm N]
 *                [--set key.path=value ...] [--calibrate summary.json] [--json]
 * Offline only. World A is Twitch Channel Points (no monetary value); World B is a
 * hypothetical token, labelled as such in every output.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { calibrationFrom, resolveParams, simulate } from "./simulate.js";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function setPath(target, path, raw) {
  const keys = path.split(".");
  if (keys.some((key) => key === "" || UNSAFE_KEYS.has(key))) throw new RangeError(`--set refuses the key path ${path}`);
  let node = target;
  for (const key of keys.slice(0, -1)) node = node[key] ??= {};
  const value = raw === "true" ? true : raw === "false" ? false : Number.isFinite(Number(raw)) && raw.trim() !== "" ? Number(raw) : raw;
  node[keys.at(-1)] = value;
}

export function parseArgs(argv) {
  const overrides = {};
  let preset = "small";
  let calibrate = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (argv[i] === undefined) throw new RangeError(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === "--preset") preset = next();
    else if (arg === "--seed") overrides.seed = Number(next());
    else if (arg === "--streams") overrides.streams = Number(next());
    else if (arg === "--farm") setPath(overrides, "farm.agents", next());
    else if (arg === "--set") {
      const pair = next();
      const at = pair.indexOf("=");
      const path = at < 0 ? "" : pair.slice(0, at);
      const value = at < 0 ? undefined : pair.slice(at + 1);
      if (!path || value === undefined) throw new RangeError("--set needs key.path=value");
      setPath(overrides, path, value);
    } else if (arg === "--calibrate") calibrate = next();
    else if (arg === "--json") json = true;
    else throw new RangeError(`unknown argument ${arg}`);
  }
  return { overrides, preset, calibrate, json };
}

export function formatReport(r, used) {
  const a = r.world_a;
  const b = r.world_b;
  return [
    `Seed ${r.seed}, ${r.audience.streams} streams of ${r.params.stream_minutes} min. ${used.length ? `Calibrated: ${used.join("; ")}.` : "Preset only: UNCALIBRATED, illustrative numbers."}`,
    `Audience: ${r.audience.unique_viewers} unique humans, average ${r.audience.average_concurrent} concurrent, peak ${r.audience.peak_concurrent}, ${r.audience.chats} chats${r.params.farm.agents ? `, plus ${r.params.farm.agents} farm accounts` : ""}.`,
    "",
    `World A (${a.label})`,
    `  minted ${a.minted}: ${Object.entries(a.minted_by_source).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `  burned ${a.burned}: ${Object.entries(a.burned_by_sink).map(([k, v]) => `${k} ${v}`).join(", ")}; outstanding ${a.outstanding}; velocity ${a.velocity}`,
    `  balances: Gini ${a.gini}, top 10% hold ${a.top10_share}; ${Math.round(a.participation_share * 100)}% of humans redeemed or predicted; farm holds ${a.farm_points_share}`,
    `  predictions: ${a.predictions.count} (${a.predictions.resolved} resolved, ${a.predictions.canceled} canceled, ${a.predictions.no_winner} no winner), average pool ${a.predictions.average_pool}, max stake ${a.predictions.max_stake}`,
    "",
    `World B (${b.label})`,
    `  rule: ${b.rule}; emitted ${b.emitted}; Gini ${b.gini}, top 10% hold ${b.top10_share}`,
    `  farm share: ${b.farm_share} with ${b.farm_agents} farm accounts`,
  ].join("\n");
}

export function main(argv = process.argv.slice(2), { print = (l) => console.log(l), readFile = (p) => readFileSync(p, "utf8") } = {}) {
  try {
    const { overrides, preset, calibrate, json } = parseArgs(argv);
    let used = [];
    let merged = overrides;
    if (calibrate) {
      const cal = calibrationFrom(JSON.parse(readFile(calibrate)));
      used = cal.used;
      merged = { ...cal.overrides, ...overrides, audience: { ...cal.overrides.audience, ...overrides.audience }, behaviour: { ...cal.overrides.behaviour, ...overrides.behaviour } };
    }
    const result = simulate(resolveParams(merged, preset));
    print(json ? JSON.stringify({ ...result, calibrated_from: used }, null, 2) : formatReport(result, used));
    return 0;
  } catch (error) {
    print(`sim: ${error.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
