// SPDX-License-Identifier: MIT
// A streamer's "Back this streamer" badge: a small static SVG with the channel's name and its latest public Twitch
// reading, linking nowhere by itself (the page that embeds it wraps it in a link). No script, no external fetch, no
// money or points figure. Twitch numbers are display only and carry their source.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clip = (s, max) => (String(s).length > max ? `${String(s).slice(0, max - 1)}…` : String(s));
const clean = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "");

export const BADGE = Object.freeze({ width: 320, height: 140 });

/** `listing`: { name, claimed }, `performance`: the listing's Twitch reading or null. Returns an SVG string. */
export function renderBadge({ listing, performance = null, host = "radiolan.live" }) {
  const name = clip(clean(listing.name), 24);
  const live = Boolean(performance?.live);
  const status = live
    ? `Live${Number.isFinite(performance.viewers) ? ` · ${performance.viewers.toLocaleString("en-US")} watching` : ""}`
    : performance ? "Offline right now" : "On Twitch";
  const game = live && performance.game ? clip(clean(performance.game), 34) : "";
  const joined = listing.claimed === true;
  const label = `${clean(listing.name)} on Radio LAN. ${status}${game ? `, ${game}` : ""}.`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE.width}" height="${BADGE.height}" viewBox="0 0 ${BADGE.width} ${BADGE.height}" role="img" aria-label="${esc(label)}">
<rect width="${BADGE.width}" height="${BADGE.height}" rx="14" fill="#13110e"/>
<rect x="0.5" y="0.5" width="${BADGE.width - 1}" height="${BADGE.height - 1}" rx="13.5" fill="none" stroke="#ffb23f" stroke-opacity="0.45"/>
<text x="18" y="28" font-family="system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="1.6" fill="#ffb23f">RADIO LAN</text>
${joined ? `<text x="${BADGE.width - 18}" y="28" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" fill="#c9f23d">Streamer joined</text>` : ""}
<text x="18" y="62" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#efe6d2">${esc(name)}</text>
<circle cx="24" cy="82" r="4.5" fill="${live ? "#ff5b45" : "#6b6f68"}"/>
<text x="36" y="86" font-family="system-ui,sans-serif" font-size="14" fill="#efe6d2">${esc(status)}</text>
${game ? `<text x="18" y="106" font-family="system-ui,sans-serif" font-size="12" fill="#bab09b">${esc(game)}</text>` : ""}
<text x="18" y="${BADGE.height - 14}" font-family="system-ui,sans-serif" font-size="11" fill="#bab09b">Follow and back on ${esc(clip(clean(host), 40))}</text>
${performance ? `<text x="${BADGE.width - 18}" y="${BADGE.height - 14}" text-anchor="end" font-family="system-ui,sans-serif" font-size="9" fill="#9a917f">Data: Twitch</text>` : ""}
</svg>
`;
}
