/** Authenticated Twitch IRC session locked to Radio LAN. Receive-only unless allowSend: true. */

import {
  createTwitchIrcSocket,
  TWITCH_IRC_WEBSOCKET_URL,
} from "../providers/twitch-irc-socket.js";
import { STATION_CHANNEL } from "./station.js";

export const TWITCH_IRC_URL = TWITCH_IRC_WEBSOCKET_URL;

export function createStationIrcSession(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("station IRC options are required");
  }
  const socket = createTwitchIrcSocket({
    ...options,
    login: options.login ?? STATION_CHANNEL,
    channels: [STATION_CHANNEL],
  });
  return Object.freeze({
    start: socket.start,
    stop: socket.stop,
    state: socket.state,
    say: socket.say,
    allowSend: socket.allowSend,
  });
}
