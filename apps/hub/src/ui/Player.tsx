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

/**
 * Twitch's own pop-out chat window. Twitch signs the viewer in there as a first-party page, so it works where the
 * embedded chat cannot: the embed signs in through a separate window and then needs third-party cookies to see that
 * session, which Chrome Incognito, Brave Shields and a "block third-party cookies" setting refuse. That is the
 * "asks me to log in again" loop. The hub passkey and the hub's Twitch identity link never sign anyone into Twitch.
 */
export const twitchChatPopout = (channel: string = TWITCH_CHANNEL) =>
  `https://www.twitch.tv/popout/${encodeURIComponent(channel)}/chat?popout=`;

export const CHAT_SIGN_IN_COPY = "Twitch chat signs you in on Twitch, separately from your Radio LAN passkey and links.";
export const CHAT_LOOP_COPY = "If the embedded chat keeps asking you to log in, your browser is blocking third-party cookies for Twitch. The pop-out signs you in on Twitch directly.";

function RoomSeason() {
  const hub = useHub();
  if (hub.status === "ready") return <SeasonStanding snapshot={hub.snapshot} now={Date.now()} />;
  return (
    <aside className="room-standing" aria-label="LAN">
      <p className="label">Your season</p>
      <p className="small">Your season standing appears when the hub is ready. Play stays free; backing is separate.</p>
      <div className="room-standing__links">
        <a href="#/play">Play free</a>
        <a href="#/board">Points board</a>
        <a href="#/positions">My positions</a>
      </div>
    </aside>
  );
}

/** radiolanlive is a listed Twitch channel, not a live show. Other listed channels may still embed. */
export function Player({ station, channel = TWITCH_CHANNEL }: { station: Station; channel?: string }) {
  const official = channel === TWITCH_CHANNEL;
  const url = official ? TWITCH_URL : `https://www.twitch.tv/${channel}`;
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [chat, setChat] = useState(false);

  useEffect(() => {
    if (official || !live || !box.current || typeof ResizeObserver === "undefined") return;
    const el = box.current;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth < EMBED_MIN_WIDTH) setLive(false);
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [live, official]);

  const play = () => {
    if (!box.current || box.current.clientWidth < EMBED_MIN_WIDTH) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    setLive(true);
  };

  if (official) {
    return (
      <section className="station-room station-room--listing" aria-label="Radio LAN channel listing">
        <div className="station-room__screen">
          <div className="player player--bleed">
            <div className="player__poster">
              <LanMark className="player__mark" />
              <p className="label">Radio LAN on Twitch</p>
              <StationPill station={station} />
              <div className="player__actions">
                <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
                  View on Twitch
                  <Icon name="ext" size="sm" />
                </a>
              </div>
              <p className="small">Listed Twitch channel. Not a live show.</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="station-room" aria-label={`${channel} room`}>
      <div className="station-room__screen">
        <div ref={box} className={live ? "player player--bleed player--live" : "player player--bleed"}>
          {live ? (
            <iframe src={twitchEmbedSrc(window.location.hostname, channel)} title={`${channel} live on Twitch`} allow="autoplay; fullscreen" allowFullScreen />
          ) : (
            <div className="player__poster">
              <LanMark className="player__mark" />
              <p className="label">{channel} on Twitch</p>
              <div className="player__actions">
                <button className="btn player__embed" type="button" onClick={play}>
                  <Icon name="play" />
                  Open player
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
          </div>
          <div className="room-chat__actions">
            <a className="btn room-chat__popout" href={twitchChatPopout(channel)} target="_blank" rel="noopener noreferrer">
              <Icon name="ext" size="sm" />
              Chat on Twitch
            </a>
            <button className="btn btn--ghost" type="button" aria-expanded={chat} onClick={() => setChat((open) => !open)}>
              {chat ? "Close embedded chat" : "Show chat here"}
            </button>
          </div>
          <p className="small">{CHAT_SIGN_IN_COPY} The pop-out opens Twitch's own chat window, where posting does not depend on third-party cookies.</p>
          {chat ? (
            <>
              <iframe src={twitchChatSrc(window.location.hostname, channel)} title={`${channel} official Twitch chat`} allow="storage-access" />
              <p className="small fine">{CHAT_LOOP_COPY}</p>
            </>
          ) : (
            <p className="small fine">Read the room live: chat on Twitch, or show it here. Site activities live in Play; backing lives in your locker.</p>
          )}
        </div>
        <RoomSeason />
      </div>
    </section>
  );
}
