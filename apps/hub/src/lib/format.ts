// Display formatting. Dates are UTC and carry the year, so a release date is exact wherever it is read.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

export const fmt = (n: number | bigint) => Number(n).toLocaleString("en-US");

/** A dust signature cost in words. The exact SOL amount stays on a second line, not as a price. */
export function feltCost(lamports: bigint): string {
  return lamports <= 10_000n ? "Less than half a cent" : "Less than a cent";
}

export const short = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`;

/** Base units to a decimal string, trimmed of trailing zeros, without floating point. */
export function units(baseUnits: bigint, decimals: number): string {
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

/** Base units to a fixed number of decimals, rounded down so a short figure never overstates. */
export function unitsFloor(baseUnits: bigint, decimals: number, shown: number): string {
  const scale = 10n ** BigInt(decimals - shown);
  const kept = baseUnits / scale;
  const whole = kept / 10n ** BigInt(shown);
  const frac = (kept % 10n ** BigInt(shown)).toString().padStart(shown, "0");
  return shown ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
}

/** "250" or "12.5" (RLAN, 6 decimals) to base units; null when the text is not a valid amount. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const [, whole = "0", frac = ""] = match;
  if (frac.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export const utc = (ms: number) => {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};

/** An exact duration in words: "90 seconds", "7 days", "1 hour 1 minute" (the two largest units). */
export function duration(seconds: number): string {
  if (seconds < 120) return `${seconds} seconds`;
  const out: string[] = [];
  let rest = seconds;
  for (const [size, name] of [[86_400, "day"], [3_600, "hour"], [60, "minute"], [1, "second"]] as const) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n && out.length < 2) out.push(`${n} ${name}${n === 1 ? "" : "s"}`);
  }
  return out.join(" ");
}

export const left = (ms: number) => {
  if (ms <= 0) return "0m";
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};
