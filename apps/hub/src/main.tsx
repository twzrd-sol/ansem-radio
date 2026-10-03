import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/hub.css";
import { App } from "./app/App";
import { ARENA_MINT } from "./chain/config";
import { captureTwitchCallback } from "./data/twitch-link";
import { TwitchCallback } from "./screens/TwitchCallback";

const twitchCallback = captureTwitchCallback(window.location, window.history);

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    {twitchCallback ? <TwitchCallback callback={twitchCallback} /> : <App fallbackMint={ARENA_MINT} />}
  </StrictMode>,
);
