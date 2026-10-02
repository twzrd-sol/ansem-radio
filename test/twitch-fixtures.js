import { buildTwitchBoard, normalizeTwitchStream } from "../src/markets/twitch-metrics.js";

export const AT = "2026-09-30T03:00:00Z";

/** A live tracked-channel row as Helix would report it, already normalized. */
export function liveRow(login, viewers, started = "2026-09-30T02:15:00Z", at = AT) {
  return normalizeTwitchStream({ user_login: login, user_name: login, type: "live", viewer_count: viewers, game_name: "Just Chatting", title: "t", started_at: started }, login, at);
}

export function offlineRow(login, at = AT) {
  return normalizeTwitchStream(null, login, at);
}

/** A two-channel board: kaicenat leads xqc by 11,250, ninja offline. */
export function twitchBoard(rows = [liveRow("kaicenat", 41250), liveRow("xqc", 30000, "2026-09-30T01:00:00Z"), offlineRow("ninja")], opts = {}) {
  return { ...buildTwitchBoard(rows, { now: () => Date.parse(AT), ...opts }), errors: [] };
}
