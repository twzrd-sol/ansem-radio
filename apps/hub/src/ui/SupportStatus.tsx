import type { Market } from "../data/market";
import { RLAN_MINT } from "../chain/config";
import { units } from "../lib/format";
import { Fact, SampleTag } from "./atoms";
// Match the arena index's two five-minute intervals rather than expiring between normal polls.
const MAX_READ_AGE_MS = 10 * 60_000;

/** A chain read describes RLAN deposited in the arena, never the ICELAN rewards budget. */
export function SupportStatus({ market, now }: { market: Market | null; now: number }) {
  const age = market?.observedAt ? now - Date.parse(market.observedAt) : NaN;
  const fresh = Boolean(market && !market.stale && market.network === "mainnet" && Number.isFinite(age) && age >= 0 && age <= MAX_READ_AGE_MS);
  const listing = fresh ? market?.listings.find((l) => l.slug === "radiolanlive" && l.arena?.mint === RLAN_MINT) : null;
  const arena = listing?.arena;
  const open = Boolean(listing?.backingOpen && arena && !arena.closed);
  return <section className="panel" aria-labelledby="h-support-status">
    <div className="panel__head"><h2 className="label" id="h-support-status">RLAN support</h2>{market?.sample && <SampleTag />}<span className="small">{fresh ? "Solana mainnet" : "Awaiting a fresh mainnet read"}</span></div>
    <dl className="facts">
      <Fact label="Radio LAN locker">{fresh ? open ? "Open" : "Closed" : "Status unavailable"}</Fact>
      {arena && <Fact label="Deposited">{units(BigInt(arena.total), 6)} RLAN · {arena.backers} {arena.backers === "1" ? "backer" : "backers"}</Fact>}
      {arena && <Fact label="Arena"><a className="mono" href={`https://explorer.solana.com/address/${arena.address}`} target="_blank" rel="noopener noreferrer">{arena.address.slice(0, 4)}…{arena.address.slice(-4)} <span className="sr-only">Open arena on Solana mainnet explorer</span></a></Fact>}
    </dl>
    <p className="small">An active RLAN position on your linked wallet gives eligible Play credits 2× weight, within season caps. It does not multiply these ICELAN task amounts.</p>
    <p className="small">Deposited RLAN is yours to withdraw under the arena schedule. It does not fund the ICELAN rewards vault.</p>
    <p className="small"><a href="#/positions">My positions</a>{open && <> · <a href="#/back/radiolanlive">Support Radio LAN</a></>}</p>
  </section>;
}
