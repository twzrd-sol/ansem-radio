// Poll rules: one per UTC day, unique ids, 2-6 distinct options; the placeholder file the station ships validates.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadPolls, normalizePolls, pollFor, utcDay } from "../src/hub/polls.js";

const ok = { id: "sat-1", day: "2026-10-03", question: "Which sound?", options: ["Boom bap", "Drill"] };

describe("hub polls", () => {
  it("validates ids, days, options and uniqueness", () => {
    assert.deepEqual(normalizePolls([ok]), [{ ...ok, placeholder: false }]);
    assert.equal(normalizePolls(null).length, 0);
    assert.throws(() => normalizePolls([{ ...ok, id: "Bad Id" }]), /bad id/);
    assert.throws(() => normalizePolls([{ ...ok, day: "3 Oct" }]), /YYYY-MM-DD/);
    assert.throws(() => normalizePolls([{ ...ok, options: ["only one"] }]), /2 to 6 options/);
    assert.throws(() => normalizePolls([{ ...ok, options: ["Same", "same"] }]), /repeats an option/);
    assert.throws(() => normalizePolls([ok, { ...ok, day: "2026-10-04" }]), /duplicate id/);
    assert.throws(() => normalizePolls([ok, { ...ok, id: "sat-2" }]), /two polls on 2026-10-03/);
    assert.throws(() => normalizePolls([{ ...ok, question: "" }]), /question must be/);
  });

  it("finds the poll for a UTC day, never the neighbouring one", () => {
    const polls = normalizePolls([ok, { ...ok, id: "sun-1", day: "2026-10-04" }]);
    const sat = Date.parse("2026-10-03T23:59:59Z") / 1000;
    assert.equal(utcDay(sat), "2026-10-03");
    assert.equal(pollFor(polls, sat).id, "sat-1");
    assert.equal(pollFor(polls, sat + 1).id, "sun-1");
    assert.equal(pollFor(polls, sat + 86_401), null);
  });

  it("loads the shipped placeholder file: seven days, all labelled placeholder", () => {
    const polls = loadPolls(new URL("../docs/examples/hub-devnet/polls.placeholder.json", import.meta.url).pathname);
    assert.equal(polls.length, 7);
    assert.ok(polls.every((p) => p.placeholder));
    assert.deepEqual(polls.map((p) => p.day), ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    const words = /\b(pay|payout|earn|yield|price|trade|buy|sell|stake|invest|money|profit|return)s?\b/i;
    for (const p of polls) for (const t of [p.question, ...p.options]) assert.ok(!words.test(t), t);
  });
});

it("a poll on a day that does not exist is refused", async () => {
  const { normalizePolls } = await import("../src/hub/polls.js");
  for (const day of ["2026-02-31", "2026-13-01", "2026-04-31"]) {
    assert.throws(() => normalizePolls([{ id: "p1", day, question: "Q?", options: ["A", "B"] }]), /needs a day/, day);
  }
  assert.equal(normalizePolls([{ id: "p1", day: "2028-02-29", question: "Q?", options: ["A", "B"] }]).length, 1, "a real leap day is fine");
});
