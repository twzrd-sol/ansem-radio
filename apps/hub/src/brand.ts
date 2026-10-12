// The one place the hub names itself. radiolan.live is an open board of Twitch streamers; the station's own channel
// (TWITCH_CHANNEL) is one listing on it, not the product. Change the name, host or tagline here only.
export const BRAND = Object.freeze({
  name: "Radio LAN",
  host: "radiolan.live",
  artist: "THE WZRD OF ZO",
  console: "LAN",
  tagline: "Follow the streamers you watch and play free each season.",
});

/** Handle display name. The room screen does not repeat the artist; the shell does. */
export const ATTRIBUTION = `${BRAND.name} by ${BRAND.artist}`;
export const LAN_ROLE = `${BRAND.console} is the AI DJ and broadcast console.`;
