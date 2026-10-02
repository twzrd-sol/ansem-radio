# Provider adapters

Each adapter converts a provider observation into `AttentionEvent` without
adding rewards or claiming more evidence strength than the source supplies.

`twitch.js` is the first adapter. A later Listen adapter will translate signed
local playback checkpoints from Spotify and other players into the same core
shape.

Provider credentials, cursors, reconnection, persistence, and retention belong
to the adapter service. They do not belong in `src/core`.

## Twitch IRC socket

`twitch-irc-socket.js` opens Twitch's TLS WebSocket, performs the PASS/NICK
handshake, requests tags and commands, joins only the supplied curated channel
set, answers PING locally, and emits the observations normalized by
`twitch-irc.js`. It never sends chat messages.

Twitch currently requires a User Access Token for the same lowercase login
passed to the socket, with `chat:read` and `chat:edit` according to the
[Twitch IRC documentation](https://dev.twitch.tv/docs/chat/irc/). This client
does not use `chat:edit`; it never sends `PRIVMSG`. Inject the token at runtime;
never put it in this repository or log the PASS frame.

```js
import { createStationIrcSession } from "../live/irc-session.js";

const irc = createStationIrcSession({
  login: "radiolanlive",
  oauthToken: process.env.TWITCH_IRC_OAUTH_TOKEN,
  onEvent: enqueueAttentionEvent,
});

irc.start();
```

The live server validates the account and scopes at startup and hourly,
refreshes 15 minutes before token expiry, reconnects IRC with the rotated
access token, and can save each rotated token pair back to the secrets manager. The socket
never receives the refresh token and remains unaware of secret persistence.
