// Snippets a streamer pastes into their own site or README, and the PNG a Twitch panel needs (a panel takes an
// uploaded image plus a link, not a hotlinked one). Pure string building; nothing here calls the station.
import { API_BASE } from "./api";

export const BADGE_SIZE = { width: 320, height: 140 } as const;

export interface EmbedSnippets { pageUrl: string; badgeUrl: string; html: string; markdown: string }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mdEsc = (s: string) => s.replace(/[\[\]\\]/g, "\\$&");

/** `origin` and `pathname` come from the page that is open, so the snippet points at the host actually serving the hub. */
export function embedSnippets({ origin, pathname, slug, name }: { origin: string; pathname: string; slug: string; name: string }): EmbedSnippets {
  if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(slug)) throw new TypeError("a listing slug is required");
  const pageUrl = `${origin}${pathname}#/s/${slug}`;
  const badgeUrl = `${origin}${API_BASE}/badge/${slug}.svg`;
  const alt = `${name} on Radio LAN`;
  return {
    pageUrl,
    badgeUrl,
    html: `<a href="${esc(pageUrl)}"><img src="${esc(badgeUrl)}" alt="${esc(alt)}" width="${BADGE_SIZE.width}" height="${BADGE_SIZE.height}"></a>`,
    markdown: `[![${mdEsc(alt)}](${badgeUrl})](${pageUrl})`,
  };
}

/** Rasterizes the badge to a PNG for a Twitch panel (320 px wide, 2x for sharpness), as a Blob. */
export async function badgePng(badgeUrl: string): Promise<Blob> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The badge didn't load.")); image.src = badgeUrl; });
  const canvas = document.createElement("canvas");
  canvas.width = BADGE_SIZE.width * 2;
  canvas.height = BADGE_SIZE.height * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't make the image.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("This browser can't make the image."))), "image/png"));
}
