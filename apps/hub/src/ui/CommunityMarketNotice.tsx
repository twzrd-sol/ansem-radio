import type { Listing } from "../data/market";

export function CommunityMarketNotice({ listing, compact = false }: { listing: Listing; compact?: boolean }) {
  const channel = listing.twitch ? `twitch.tv/${listing.twitch}` : listing.slug;
  const copy = `Community-opened market for ${channel}. The streamer has not claimed this listing, and Radio LAN has not verified that the arena belongs to them. Deposited RLAN stays in your own support account; it is not paid to the channel.`;
  return compact
    ? <span className="feature__community-note" data-testid="community-market-notice">Community-open · arena ownership unverified by Radio LAN</span>
    : <p className="note" role="note" data-testid="community-market-notice">{copy}</p>;
}
