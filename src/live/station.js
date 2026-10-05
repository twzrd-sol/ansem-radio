/** Locked station room. Official Twitch embed only; no rebroadcast. */

export const STATION_CHANNEL = "radiolanlive";
export const STATION_URL = "https://www.twitch.tv/radiolanlive";
export const STATION_TITLE = "RADIO LAN";

export function twitchParentHost(host) {
  if (typeof host !== "string" || !host.trim()) {
    throw new TypeError("Twitch embed parent host is required");
  }
  const cleaned = host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
  if (!cleaned) throw new TypeError("Twitch embed parent host is required");
  return cleaned;
}

function parentQuery(parentHost) {
  const parent = twitchParentHost(parentHost);
  const parents = new Set([parent]);
  if (parent === "localhost" || parent === "127.0.0.1") {
    parents.add("localhost");
    parents.add("127.0.0.1");
  }
  return [...parents].map((item) => `parent=${encodeURIComponent(item)}`).join("&");
}

export function officialPlayerSrc(parentHost) {
  return `https://player.twitch.tv/?channel=${STATION_CHANNEL}&${parentQuery(parentHost)}`;
}

export function officialChatSrc(parentHost) {
  return `https://www.twitch.tv/embed/${STATION_CHANNEL}/chat?${parentQuery(parentHost)}`;
}
