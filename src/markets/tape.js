/**
 * Provenance for a Helix quote, and the station channel's own tape.
 * Quote rows are the allowlist. Raid, subscription, and prediction notes are
 * observations of radiolanlive. They are not a score. Participant identity fields are
 * omitted; prediction titles are public channel text and can contain names.
 */

const PREDICTION = /^prediction_(begin|progress|lock|end)$/;

function countTotal(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function quoteProvenance(row, { station, recordedAt } = {}) {
  if (typeof station !== "string" || station.trim() === "") throw new TypeError("station is required");
  const at = row?.fetched_at ?? recordedAt;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new TypeError("quote needs a timestamp");
  return `Data: Twitch. Recorded by ${station} at ${at}.`;
}

function viewers(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? ` ${Math.floor(n)} viewers` : "";
}

function noteText(event) {
  const at = event.observed_at;
  if (typeof at !== "string") return null;
  if (event.signal === "raid") return `${at} raid${viewers(event.metadata?.viewers)}`;
  if (event.signal === "subscription") return `${at} subscription`;
  if (event.kind === "raid_out") return `${at} raid out${viewers(event.totals?.viewers)}`;
  if (PREDICTION.test(event.kind ?? "")) {
    const title = typeof event.labels?.title === "string" && event.labels.title !== "" ? ` ${event.labels.title}` : "";
    const outcomes = Array.isArray(event.outcomes) ? event.outcomes.length : 0;
    return `${at} prediction${title} (${outcomes} outcomes)`;
  }
  return null;
}

/** First notice for each id wins. Chat, cheers, and anything unnamed are dropped. */
export function tapeNotes(records) {
  const seen = new Set();
  const notes = [];
  for (const record of records ?? []) {
    const event = record?.event ?? record;
    const id = event?.id;
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    const text = noteText(event);
    if (!text) continue;
    seen.add(id);
    notes.push(Object.freeze({ id, at: event.observed_at, text }));
  }
  return Object.freeze(notes);
}

/**
 * Events the tape may publish to the page. First notice per id wins, and the
 * published shape is a whitelist: participant ids, source broadcaster ids,
 * predictor names, and point or token totals are not copied. User counts on a
 * prediction outcome are the public participation count, not points.
 */
export function publicTapeEvents(records) {
  const seen = new Set();
  const events = [];
  for (const record of records ?? []) {
    const event = record?.event ?? record;
    const id = event?.id;
    if (typeof id !== "string" || id === "" || seen.has(id) || !noteText(event)) continue;
    seen.add(id);
    const outcomes = (Array.isArray(event.outcomes) ? event.outcomes : []).slice(0, 10).map((outcome) => {
      const users = countTotal(outcome?.totals?.users);
      return Object.freeze({
        label: typeof outcome?.label === "string" ? outcome.label : "",
        totals: users === null ? {} : { users },
      });
    });
    events.push(Object.freeze({
      id,
      observed_at: event.observed_at,
      signal: event.signal,
      kind: event.kind,
      metadata: countTotal(event.metadata?.viewers) === null ? undefined : { viewers: countTotal(event.metadata?.viewers) },
      totals: countTotal(event.totals?.viewers) === null ? undefined : { viewers: countTotal(event.totals?.viewers) },
      labels: typeof event.labels?.title === "string" && event.labels.title !== "" ? { title: event.labels.title } : undefined,
      outcomes: outcomes.length ? Object.freeze(outcomes) : undefined,
    }));
  }
  return Object.freeze(events);
}
