/**
 * Runs the agent chorus over a board. Dry-run by default: returns the lines it would say.
 * Sending requires both allowSend and a `say` function from an IRC socket created with
 * allowSend: true. Pacing keeps well under Twitch's 20 messages / 30 s per account.
 */

import { createBrain } from "./brain.js";
import { CHORUS, LAN } from "./personas.js";

export function planChorus(board, { maxRows = 3 } = {}) {
  if (!board || !Array.isArray(board.rows)) throw new TypeError("a market board is required");
  const rows = board.rows.slice(0, Math.max(1, Number(maxRows) || 3));
  const steps = [];
  for (const row of rows) {
    steps.push({ persona: LAN, row });
    for (const persona of CHORUS) steps.push({ persona, row });
  }
  return Object.freeze(steps);
}

export function createChorus({
  brain = createBrain(),
  say = null,
  allowSend = false,
  // Why lines are not sent when allowSend is false (e.g. "station_offline").
  disabledReason = "send_disabled",
  gapMs = 4000,
  schedule = (fn, ms) => setTimeout(fn, ms),
  clock = Date.now,
} = {}) {
  if (allowSend && typeof say !== "function") {
    throw new TypeError("allowSend requires a say function");
  }
  const wait = (ms) => new Promise((resolve) => schedule(resolve, ms));

  const run = async (board, { maxRows = 3, onLine = () => {} } = {}) => {
    const steps = planChorus(board, { maxRows });
    const lines = [];
    let first = true;
    for (const { persona, row } of steps) {
      const take = await brain.take(persona, row);
      if (!take.ok) {
        lines.push(Object.freeze({ handle: persona.handle, text: null, sent: false, reason: take.reason, at: new Date(clock()).toISOString() }));
        continue;
      }
      if (!first) await wait(gapMs);
      first = false;
      let sent = false;
      let reason = allowSend ? null : disabledReason;
      if (allowSend) {
        const result = await say(take.text, persona);
        sent = Boolean(result?.sent);
        reason = sent ? null : (result?.reason ?? "send_failed");
      }
      const line = Object.freeze({ handle: persona.handle, text: take.text, sent, reason, at: new Date(clock()).toISOString() });
      lines.push(line);
      try {
        onLine(line);
      } catch {
        // Consumers must never break the chorus.
      }
    }
    return Object.freeze(lines);
  };

  return Object.freeze({ run, plan: planChorus, provider: brain.provider, allowSend });
}
