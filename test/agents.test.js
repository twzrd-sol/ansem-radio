import assert from "node:assert/strict";
import test from "node:test";

import {
  BANNED_WORDS,
  DISCLOSURE,
  MAX_TAKE_CHARS,
  createBrain,
  sanitizeTake,
  scriptedTake,
  unitFromSeed,
} from "../src/agents/brain.js";
import { createChorus, planChorus } from "../src/agents/chorus.js";
import { CHORUS, LAN, personaByHandle } from "../src/agents/personas.js";
import { liveRow, offlineRow, twitchBoard } from "./twitch-fixtures.js";

/** The board leader: rank 1, 41,250 watching, up nothing yet (no previous board). */
function row() {
  return twitchBoard().rows[0];
}

test("every persona name contains agent or is LAN, and each take is disclosed", () => {
  for (const persona of CHORUS) assert.match(persona.handle, /agent/);
  assert.equal(personaByHandle("HYPE_AGENT")?.name, "Hype");
  assert.equal(personaByHandle("nobody"), null);
  for (const persona of [LAN, ...CHORUS]) {
    const take = sanitizeTake(persona, scriptedTake(persona, row()));
    assert.equal(take.ok, true, take.reason);
    assert.ok(take.text.startsWith(`${persona.name} ${DISCLOSURE}: `), take.text);
    assert.ok(take.text.length <= MAX_TAKE_CHARS);
  }
});

test("scripted takes are deterministic, cite the viewer count, and never use wagering or pricing words", () => {
  const first = scriptedTake(CHORUS[0], row());
  const second = scriptedTake(CHORUS[0], row());
  assert.equal(first, second);
  assert.match(first, /41,250 watching/);
  for (const persona of [LAN, ...CHORUS]) {
    for (const r of [row(), ...twitchBoard().rows.slice(1), offlineRow("ninja")]) {
      const text = scriptedTake(persona, r);
      for (const word of BANNED_WORDS) assert.doesNotMatch(text, new RegExp(`\\b${word}\\b`, "i"), `${persona.name}: ${word}`);
      assert.doesNotMatch(text, /http|kalshi|polymarket|\bprice|\bbook\b|%/i, `${persona.name}: ${text}`);
    }
  }
  assert.throws(() => scriptedTake(LAN, { kind: "price", title: "x" }), /twitch_live/);
  assert.throws(() => scriptedTake(LAN, null), /twitch_live/);
});

test("the seed helper is a stable unit float", () => {
  assert.ok(unitFromSeed("a") >= 0 && unitFromSeed("a") < 1);
  assert.equal(unitFromSeed("a"), unitFromSeed("a"));
  assert.notEqual(unitFromSeed("a"), unitFromSeed("b"));
});

test("sanitizeTake strips venue URLs, drops wagering vocabulary, and caps length", () => {
  const persona = CHORUS[0];
  assert.equal(sanitizeTake(persona, "see https://kalshi.com/markets/x for 15%").text, "Ledger (AI agent): see for 15%");
  assert.equal(sanitizeTake(persona, "go to kalshi.com now").text, "Ledger (AI agent): go to now");
  assert.deepEqual(sanitizeTake(persona, "I'd bet on it"), { ok: false, text: null, reason: "banned_word:bet" });
  assert.deepEqual(sanitizeTake(persona, "buy the dip"), { ok: false, text: null, reason: "banned_word:buy" });
  assert.deepEqual(sanitizeTake(persona, "Kalshi has him at fifteen"), { ok: false, text: null, reason: "banned_word:kalshi" });
  assert.deepEqual(sanitizeTake(persona, "Polymarket disagrees"), { ok: false, text: null, reason: "banned_word:polymarket" });
  assert.deepEqual(sanitizeTake(persona, "what is the price on that"), { ok: false, text: null, reason: "banned_word:price" });
  // Token words are allowed since the operator lifted that filter on 2026-10-01; the line is still disclosed.
  assert.equal(sanitizeTake(persona, "RLAN holders pick the next show").text, "Ledger (AI agent): RLAN holders pick the next show");
  assert.equal(sanitizeTake(persona, "the token mint went live").ok, true);
  // Price and wagering stay banned even next to token words.
  assert.deepEqual(sanitizeTake(persona, "RLAN price is up"), { ok: false, text: null, reason: "banned_word:price" });
  assert.deepEqual(sanitizeTake(persona, "buy the token"), { ok: false, text: null, reason: "banned_word:buy" });
  assert.deepEqual(sanitizeTake(persona, "   "), { ok: false, text: null, reason: "empty" });
  assert.deepEqual(sanitizeTake(persona, "https://x.y"), { ok: false, text: null, reason: "url_only" });
  const long = sanitizeTake(persona, "word ".repeat(200));
  assert.equal(long.ok, true);
  assert.equal(long.reason, "truncated");
  assert.equal(long.text.length, MAX_TAKE_CHARS);
  assert.equal(sanitizeTake(persona, "line one\r\nline two").text, "Ledger (AI agent): line one line two");
});

test("createBrain runs any provider through sanitizeTake and defaults to scripted", async () => {
  const scripted = createBrain();
  assert.equal(scripted.provider, "scripted");
  const take = await scripted.take(LAN, row());
  assert.match(take.text, /^LAN \(AI agent\): Live board: #1 kaicenat: 41,250 watching/);
  const custom = createBrain({ generate: async () => "I would stake everything on Kai" });
  assert.equal(custom.provider, "custom");
  assert.deepEqual(await custom.take(CHORUS[0], row()), { ok: false, text: null, reason: "banned_word:stake" });
  assert.throws(() => createBrain({ generate: "nope" }), /generate/);
});

test("chorus is dry-run by default, paces sends, and reports per-line send state", async () => {
  const board = twitchBoard();
  const plan = planChorus(board, { maxRows: 1 });
  assert.equal(plan.length, 1 + CHORUS.length);
  assert.equal(plan[0].persona.name, "LAN");
  assert.equal(plan[0].row.login, "kaicenat");

  const dry = createChorus({ schedule: (fn) => fn() });
  const lines = await dry.run(board, { maxRows: 1 });
  assert.equal(lines.length, 4);
  assert.ok(lines.every((line) => line.sent === false && line.reason === "send_disabled" && line.text));

  const sent = [];
  const waits = [];
  const live = createChorus({
    allowSend: true,
    say: async (text) => { sent.push(text); return { sent: sent.length < 3, reason: sent.length < 3 ? null : "rate_limited" }; },
    schedule: (fn, ms) => { waits.push(ms); fn(); },
    gapMs: 4000,
  });
  const seen = [];
  const result = await live.run(board, { maxRows: 1, onLine: (line) => seen.push(line.handle) });
  assert.equal(sent.length, 4);
  assert.deepEqual(waits, [4000, 4000, 4000]);
  assert.deepEqual(result.map((line) => line.sent), [true, true, false, false]);
  assert.equal(result[2].reason, "rate_limited");
  assert.deepEqual(seen, ["radiolanlive", "ledger_agent", "hype_agent", "fade_agent"]);
  assert.throws(() => createChorus({ allowSend: true }), /say/);
});

test("twitch-native rows get race takes: disclosed, deterministic, no wagering words, offline handled", async () => {
  const { buildTwitchBoard, normalizeTwitchStream } = await import("../src/markets/twitch-metrics.js");
  const at = "2026-09-30T03:00:00Z";
  const live = (login, viewers, started = "2026-09-30T02:15:00Z") =>
    normalizeTwitchStream({ user_login: login, user_name: login, type: "live", viewer_count: viewers, game_name: "Just Chatting", title: "t", started_at: started }, login, at);
  const previous = buildTwitchBoard([live("kaicenat", 40000), live("xqc", 31000)], { now: () => Date.parse(at) - 60000 });
  const board = buildTwitchBoard([live("kaicenat", 41250), live("xqc", 30000, "2026-09-30T01:00:00Z"), normalizeTwitchStream(null, "ninja", at)], { previous, now: () => Date.parse(at) });
  const leader = board.rows[0];
  const second = board.rows[1];
  assert.equal(scriptedTake(LAN, leader), "Live board: #1 kaicenat: 41,250 watching in Just Chatting, live 45 min. Chat, who closes the gap tonight?");
  assert.equal(scriptedTake(CHORUS[0], leader), "#1 kaicenat: 41,250 watching in Just Chatting, live 45 min. up 1,250 since the last check; holding #1.");
  assert.match(scriptedTake(CHORUS[0], second), /down 1,000 since the last check; 11,250 to the leader/);
  assert.match(scriptedTake(CHORUS[2], leader), /Early numbers lie/);
  assert.match(scriptedTake(CHORUS[2], second), /holds up/);
  const offline = normalizeTwitchStream(null, "ninja", at);
  assert.equal(scriptedTake(CHORUS[1], offline), "ninja dark tonight. The culture moved rooms.");
  for (const persona of [LAN, ...CHORUS]) {
    for (const r of [leader, second, offline]) {
      const take = sanitizeTake(persona, scriptedTake(persona, r));
      assert.equal(take.ok, true, `${persona.name}: ${take.reason}`);
      for (const word of BANNED_WORDS) assert.doesNotMatch(take.text, new RegExp(`\\b${word}\\b`, "i"));
    }
  }
  assert.equal(scriptedTake(LAN, leader), scriptedTake(LAN, leader), "deterministic");
});
