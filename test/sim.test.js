import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync, readdirSync } from "node:fs";

import { main, parseArgs } from "../src/sim/cli.js";
import { createRng } from "../src/sim/rng.js";
import { calibrationFrom, resolveParams, simulate } from "../src/sim/simulate.js";
import { EARN, streakBonus } from "../src/sim/twitch-points.js";
import { gini, splitPool, stakeFor, topShare } from "../src/sim/world-points.js";

test("the PRNG is mulberry32, pinned", () => {
  const r = createRng(42);
  assert.equal(r.next().toFixed(10), "0.6011037519");
  assert.equal(r.next().toFixed(10), "0.4482905590");
  const z = createRng(0); // zero seed is lifted to 1, never stuck
  assert.notEqual(z.next(), z.next());
});

test("Twitch's published numbers are what the simulator uses", () => {
  assert.deepEqual([EARN.watch_points, EARN.watch_every_minutes, EARN.bonus_points, EARN.bonus_every_minutes, EARN.raid, EARN.follow, EARN.first_cheer, EARN.first_gift], [10, 5, 50, 15, 250, 300, 350, 500]);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(streakBonus), [0, 300, 350, 400, 450, 450]);
  assert.deepEqual(EARN.sub_multiplier, { 0: 1, 1: 1.2, 2: 1.4, 3: 2 });
});

test("same seed and parameters give identical output; a different seed differs", () => {
  const p = resolveParams();
  assert.equal(JSON.stringify(simulate(p)), JSON.stringify(simulate(resolveParams())));
  assert.notEqual(JSON.stringify(simulate(resolveParams({ seed: 7 })).world_a), JSON.stringify(simulate(p).world_a));
});

test("points are conserved and bounded across many seeds and settings", () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    for (const over of [{}, { farm: { agents: 3 }, predictions: { per_stream: 6, outcomes: 4, stake_fraction: 1 } }, { predictions: { no_winner_rule: "refund", cancel_probability: 0.5 } }]) {
      const r = simulate(resolveParams({ seed, ...over }));
      const a = r.world_a;
      const minted = Object.values(a.minted_by_source).reduce((s, v) => s + v, 0);
      const burned = Object.values(a.burned_by_sink).reduce((s, v) => s + v, 0);
      assert.equal(minted, a.minted);
      assert.equal(minted - burned, a.outstanding, `seed ${seed}`);
      assert.ok(a.predictions.max_stake <= 250_000);
      for (const [sink, value] of Object.entries(a.burned_by_sink)) assert.ok(value >= 0, `${sink} ${value}`);
      assert.ok(a.gini >= 0 && a.gini <= 1);
      assert.ok(r.world_b.emitted <= r.params.token.emission_per_stream * r.params.streams);
    }
  }
});

test("World B never depends on World A's parameters", () => {
  const base = simulate(resolveParams({ farm: { agents: 2 } }));
  const changed = simulate(resolveParams({ farm: { agents: 2 }, rewards: [{ title: "x", cost: 1 }], predictions: { per_stream: 9, outcomes: 7, stake_fraction: 0.9 }, behaviour: { claim_bonus_probability: 1, redeem_probability_per_minute: 0.5 } }));
  assert.equal(JSON.stringify(changed.world_b), JSON.stringify(base.world_b));
  assert.equal(JSON.stringify(changed.audience), JSON.stringify(base.audience));
});

test("a bot farm captures most of a watch/chat emission; every World B output carries its label", () => {
  const none = simulate(resolveParams());
  const farm = simulate(resolveParams({ farm: { agents: 5 } }));
  assert.equal(none.world_b.farm_share, 0);
  assert.ok(farm.world_b.farm_share > 0.5, String(farm.world_b.farm_share));
  assert.match(farm.world_b.label, /HYPOTHETICAL/);
  assert.match(farm.world_b.label, /AGENTS\.md/);
  assert.match(farm.world_a.label, /no monetary value/);
});

test("parameters outside Twitch's rules are refused", () => {
  assert.throws(() => resolveParams({ stream_minutes: 5 }), /stream_minutes/);
  assert.throws(() => resolveParams({ predictions: { outcomes: 11 } }), /2 to 10/);
  assert.throws(() => resolveParams({ predictions: { window_seconds: 10 } }), /30 to 1800/);
  assert.throws(() => resolveParams({ rewards: Array(51).fill({ title: "r", cost: 1 }) }), /at most 50/);
  assert.throws(() => resolveParams({ behaviour: { chat_per_minute: 2 } }), /between 0 and 1/);
  assert.throws(() => resolveParams({}, "big"), /unknown preset/);
});

test("Gini and top share behave at the edges", () => {
  assert.equal(gini([5, 5, 5, 5]), 0);
  assert.ok(Math.abs(gini([0, 0, 0, 100]) - 0.75) < 1e-9);
  assert.equal(topShare([10, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.1), 1);
  assert.equal(gini([]), 0);
});

test("calibration uses only fields that exist and says which", () => {
  const cal = calibrationFrom({ stream: { avg_viewers: 4, sessions: 2, live_minutes: 180 }, chat: { per_live_minute: 2 } });
  assert.deepEqual(cal.overrides, { audience: { mean_concurrent: 4 }, stream_minutes: 90, behaviour: { chat_per_minute: 0.5 } });
  assert.equal(cal.used.length, 3);
  assert.deepEqual(calibrationFrom({ stream: { avg_viewers: null, sessions: 0, live_minutes: 0 }, chat: { per_live_minute: null } }), { overrides: {}, used: [] });
});

test("the CLI prints a labelled report, JSON, calibration, and refuses bad input", () => {
  const out = [];
  assert.equal(main(["--farm", "5", "--streams", "4"], { print: (l) => out.push(l) }), 0);
  assert.match(out.at(-1), /UNCALIBRATED/);
  assert.match(out.at(-1), /World B \(HYPOTHETICAL/);
  assert.match(out.at(-1), /farm share: 0\.\d+ with 5 farm accounts/);
  assert.equal(main(["--json", "--set", "predictions.outcomes=3"], { print: (l) => out.push(l) }), 0);
  assert.equal(JSON.parse(out.at(-1)).params.predictions.outcomes, 3);
  const summary = JSON.stringify({ stream: { avg_viewers: 3, sessions: 1, live_minutes: 60 }, chat: { per_live_minute: 1.5 } });
  assert.equal(main(["--calibrate", "s.json"], { print: (l) => out.push(l), readFile: () => summary }), 0);
  assert.match(out.at(-1), /Calibrated: audience\.mean_concurrent/);
  assert.equal(main(["--nope"], { print: (l) => out.push(l) }), 2);
  assert.equal(main(["--set", "x"], { print: (l) => out.push(l) }), 2);
  assert.deepEqual(parseArgs(["--seed", "9"]).overrides, { seed: 9 });
});

test("the simulator imports nothing that can reach the network or the live room", () => {
  for (const name of readdirSync(new URL("../src/sim/", import.meta.url))) {
    const source = readFileSync(new URL(`../src/sim/${name}`, import.meta.url), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) assert.ok(spec.startsWith("./") || spec === "node:fs" || spec === "node:url", `${name} imports ${spec}`);
    assert.equal(/\bfetch\(|WebSocket/.test(source), false, name);
  }
});

test("stakes stay within 10 to 250,000 points and never exceed the balance", () => {
  assert.equal(stakeFor(9, 1), 0);
  assert.equal(stakeFor(10, 0.01), 10);
  assert.equal(stakeFor(40, 0.25), 10);
  assert.equal(stakeFor(1000, 0.25), 250);
  assert.equal(stakeFor(5_000_000, 1), 250_000);
  assert.equal(stakeFor(12, 1), 12);
});

test("winners split the whole pool in proportion, rounded down, and the dust is accounted for", () => {
  const { payouts, dust } = splitPool(new Map([["a", 100], ["b", 200]]), 1000);
  assert.deepEqual([...payouts], [["a", 333], ["b", 666]]);
  assert.equal(dust, 1);
  const none = splitPool(new Map(), 500);
  assert.equal(none.payouts.size, 0);
  assert.equal(none.dust, 500);
  for (let i = 1; i < 50; i += 1) {
    const stakes = new Map([["x", i], ["y", 3 * i + 1], ["z", 7]]);
    const pool = 11 * i + 97;
    const r = splitPool(stakes, pool);
    assert.equal([...r.payouts.values()].reduce((s, v) => s + v, 0) + r.dust, pool);
    assert.ok(r.dust >= 0 && r.dust < stakes.size);
  }
});

test("a subscription multiplies watch points only, not bonuses", () => {
  // No rewards or predictions, so richer subscribers cannot shift the claim draws.
  const quiet = { rewards: [], predictions: { per_stream: 0 } };
  const plain = simulate(resolveParams({ ...quiet, behaviour: { sub_share: { tier1: 0, tier2: 0, tier3: 0 } } })).world_a.minted_by_source;
  const tier3 = simulate(resolveParams({ ...quiet, behaviour: { sub_share: { tier1: 0, tier2: 0, tier3: 1 } } })).world_a.minted_by_source;
  assert.equal(tier3.watch, plain.watch * 2);
  assert.equal(tier3.bonus, plain.bonus);
});

test("first-cheer points come at most once per 30 days", () => {
  const daily = simulate(resolveParams({ streams: 3, behaviour: { first_cheer_probability: 1 } }));
  assert.equal(daily.world_a.minted_by_source.first_cheer, 350 * daily.audience.unique_viewers);
  const monthly = simulate(resolveParams({ streams: 3, days_between_streams: 31, behaviour: { first_cheer_probability: 1 } }));
  assert.ok(monthly.world_a.minted_by_source.first_cheer > 350 * monthly.audience.unique_viewers);
});

test("--set refuses prototype keys and keeps an equals sign inside the value", () => {
  for (const path of ["__proto__.polluted", "constructor.prototype.polluted", "farm.__proto__.x", "a..b"]) {
    assert.throws(() => parseArgs(["--set", `${path}=1`]), /refuses the key path/, path);
  }
  assert.equal(({}).polluted, undefined, "Object.prototype is untouched");
  assert.equal(parseArgs(["--set", "label=b=c"]).overrides.label, "b=c");
  assert.throws(() => parseArgs(["--set", "novalue"]), /needs key.path=value/);
});
