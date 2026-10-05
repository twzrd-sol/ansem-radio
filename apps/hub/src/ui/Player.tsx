import { useEffect, useRef, useState } from "react";

import { TWITCH_CHANNEL, TWITCH_URL } from "../chain/config";
import type { Station } from "../data/station";
import { Icon, LanMark, StationPill } from "./atoms";

/** Twitch's embedded player must be at least 400 x 300, and phones only start playback after a tap. */
export const EMBED_MIN_WIDTH = 400;

/** `parent` is the exact hostname serving the page, which Twitch requires for every embedding domain. */
export const twitchEmbedSrc = (hostname: string, channel: string = TWITCH_CHANNEL) =>
  `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(hostname)}&autoplay=true`;

/** Poster first. "Play here" loads the official player only at 400 px or wider; narrower screens link out. */
export function Player({ station, channel = TWITCH_CHANNEL }: { station: Station; channel?: string }) {
  const url = channel === TWITCH_CHANNEL ? TWITCH_URL : `https://www.twitch.tv/${channel}`;
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!live || !box.current || typeof ResizeObserver === "undefined") return;
    const el = box.current;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth < EMBED_MIN_WIDTH) setLive(false);
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [live]);

  const play = () => {
    if (!box.current || box.current.clientWidth < EMBED_MIN_WIDTH) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    setLive(true);
  };

  return (
    <div ref={box} className={live ? "player player--bleed player--live" : "player player--bleed"}>
      {live ? (
        <iframe src={twitchEmbedSrc(window.location.hostname, channel)} title={`${channel} live on Twitch`} allow="autoplay; fullscreen" allowFullScreen />
      ) : (
        <div className="player__poster">
          <LanMark className="player__mark" />
          <p className="label">{channel === TWITCH_CHANNEL ? "Radio LAN" : channel} on Twitch</p>
          {channel === TWITCH_CHANNEL && <StationPill station={station} />}
          <div className="player__actions">
            <button className="btn btn--primary player__embed" type="button" onClick={play}>
              <Icon name="play" />
              Play here
            </button>
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
              Watch on Twitch
              <Icon name="ext" size="sm" />
            </a>
          </div>
          <p className="player__narrow">Opens the Twitch app or site. The embedded player needs a wider screen.</p>
        </div>
      )}
    </div>
  );
}
