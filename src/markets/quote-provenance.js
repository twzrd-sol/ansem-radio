// MIT. Display provenance only; no observations, scoring or persistence.
export function quoteProvenance(row, { station, recordedAt } = {}) {
  if (typeof station !== "string" || station.trim() === "") throw new TypeError("station is required");
  const at = row?.fetched_at ?? recordedAt;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new TypeError("quote needs a timestamp");
  return `Data: Twitch. Recorded by ${station} at ${at}.`;
}
