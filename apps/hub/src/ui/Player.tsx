import { useEffect, useRef, useState } from "react";

import { TWITCH_CHANNEL, TWITCH_URL } from "../chain/config";
import type { Station } from "../data/station";
import { useHub } from "../data/hub";
import { SeasonStanding } from "./Collector";
import { Icon, LanMark, StationPill } from "./atoms";

/** Twitch's embedded player must be at least 400 x 300, and phones only start playback after a tap. */
export const EMBED_MIN_WIDTH = 400;

/** `parent` is the exact hostname serving the page, which Twitch requires for every embedding domain. */
export const twitchEmbedSrc = (hostname: string, channel: string = TWITCH_CHANNEL) =>
  `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(hostname)}&autoplay=true`;

export const twitchChatSrc = (hostname: string, channel: string = TWITCH_CHANNEL) =>
  `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${encodeURIComponent(hostname)}&darkpopout`;

function RoomSeason() {
  const hub = useHub();
  if (hub.status === "ready") return <SeasonStanding snapshot={hub.snapshot} now={Date.now()} />;
  return (
    <aside className="room-standing" aria-label="LAN">
      <p className="label">LAN · AI DJ and broadcast console</p>
      <p className="small">Season standing joins the room when the hub is ready. Play stays free. Your locker is separate.</p>
      <div className="room-standing__links">
        <a href="#/play">Play free</a>
        <a href="#/board">Points board</a>
        <a href="#/positions">Your locker</a>
      </div>
    </aside>
  );
}

/** Poster first. "Play here" loads the official player only at 400 px or wider; narrower screens link out. */
export function Player({ station, channel = TWITCH_CHANNEL }: { station: Station; channel?: string }) {
  const url = channel === TWITCH_CHANNEL ? TWITCH_URL : `https://www.twitch.tv/${channel}`;
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [chat, setChat] = useState(false);

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
    <section className="station-room" aria-label={channel === TWITCH_CHANNEL ? "Radio LAN room" : `${channel} room`}>
      <div className="station-room__screen">
        <div ref={box} className={live ? "player player--bleed player--live" : "player player--bleed"}>
          {live ? (
            <iframe src={twitchEmbedSrc(window.location.hostname, channel)} title={channel === TWITCH_CHANNEL ? "Radio LAN live stream" : `${channel} live on Twitch`} allow="autoplay; fullscreen" allowFullScreen />
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
      </div>
      <div className="station-room__side">
        <div className="room-chat">
          <div className="room-chat__head">
            <span className="label">Official Twitch chat · {channel}</span>
            <button className="btn btn--ghost" type="button" aria-expanded={chat} onClick={() => setChat((open) => !open)}>
              {chat ? "Close chat" : "Open Twitch chat"}
            </button>
          </div>
          {chat ? <iframe src={twitchChatSrc(window.location.hostname, channel)} title={`${channel} official Twitch chat`} /> : <p className="small">Meet the room in Twitch chat. Site activities live in Play; backing lives in your locker.</p>}
        </div>
        {channel === TWITCH_CHANNEL ? <RoomSeason /> : null}
      </div>
    </section>
  );
}
