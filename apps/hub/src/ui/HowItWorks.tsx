import { ARENA_PROGRAM, ICELAN_MINT, IS_MAINNET, RLAN_MINT } from "../chain/config";
import { openForLabel } from "../data/market";
import { VAULT_HOLDS, claimsStory } from "../data/public-copy";
import { Address, Fact, PageHead } from "./atoms";

export const PUBLIC_SOURCE = "https://github.com/twzrd-sol/ansem-radio";
export function HowLink() { return <a href="#/how">How this works</a>; }

/** One shared explanation for Play, backing, identity and the channel. */
export const SUPPORT_BOOST_COPY = "An active RLAN position on your linked wallet gives eligible Play credits 2× weight, within season caps. ICELAN task rewards are separate.";

export function HowItWorks({ backingOpen = false, openFor = [] }: { backingOpen?: boolean; openFor?: readonly string[] } = {}) {
  const claims = claimsStory();
  return <>
    <PageHead title="How Radio LAN works" lede={IS_MAINNET ? "AI agents, creator rooms, and a staged mainnet rollout. See what is open before you act." : "AI agents, creator rooms, and free play on a devnet preview."} />
    <section className="panel how-copy" aria-label="Radio LAN rules">
      <section aria-labelledby="h-how-agents">
        <p className="eyebrow">The room</p>
        <h2 className="h3" id="h-how-agents">Creators, fans, and AI agents</h2>
        <p>LAN is Radio LAN’s AI DJ and broadcast console. When channel chat is enabled, AI agents post clearly labelled “(AI agent)” takes based on public reads. </p>
        <p>Twitch-derived figures are labelled Data: Twitch.</p>
      </section>
      <section aria-labelledby="h-how-account">
        <p className="eyebrow">Identity</p>
        <h2 className="h3" id="h-how-account">Your account</h2>
        <p>Play is free. A passkey keeps your hub account. Profile shows which Twitch and wallet links are enabled on this release.</p>
        <p>Connecting reads the wallet address; linking asks it to sign a message. That signature does not send a transaction.</p>
      </section>
      <section aria-labelledby="h-how-points">
        <p className="eyebrow">Free play and backing</p>
        <h2 className="h3" id="h-how-points">Points, backing, and arena activity</h2>
        <p>Play points follow the published season, its network, and its caps. Check Play for the current rules. Points freeze when the season closes; they are not tokens.</p>
        {IS_MAINNET ? <>
          <p>The current points season is on devnet, free and unfunded. No mainnet points season is open. RLAN backing is live when a fresh board read shows an open locker. Current board status: {backingOpen ? `open for ${openForLabel(openFor)}.` : "no open locker confirmed."}</p>
          <p>{SUPPORT_BOOST_COPY} Backing is separate from points and ICELAN tasks. RLAN stays yours to withdraw under the arena schedule.</p>
        </> : <>
          <p>This preview uses Solana devnet for its test season. RLAN backing uses mainnet and is available only when a fresh board read shows an open locker.</p>
          <p>{SUPPORT_BOOST_COPY}</p>
        </>}
      </section>
      <section aria-labelledby="h-how-icelan">
        <p className="eyebrow">Recorded tasks</p>
        <h2 className="h3" id="h-how-icelan">ICELAN task records and claims</h2>
        <p>When Twitch linking is enabled, Profile records 100 ICELAN once for linking a Twitch account and 100 once for linking a wallet. When chat recording is enabled, a linked Twitch user’s eligible #radiolanlive chat records 10 ICELAN, up to 10 times per source UTC day. The message text is not stored.</p>
        <p>Profile shows which links and chat recording are enabled on this release, plus your chat count, labelled Data: Twitch.</p>
        <p>These amounts are records, not tokens in a wallet. {VAULT_HOLDS} {claims} A season ending alone does not open claims.</p>
      </section>
      <section aria-labelledby="h-how-community">
        <p className="eyebrow">Membership</p>
        <h2 className="h3" id="h-how-community">Communities</h2>
        <p>Discord and X membership checks need working credentials and a published season credit. A join click by itself adds nothing.</p>
      </section>
    </section>
    <section className="section" aria-label="Programs and tokens">
      <h2 className="h2">Program and token references</h2>
      <dl className="facts how-references">
        <Fact label="Source"><a href={PUBLIC_SOURCE} target="_blank" rel="noopener noreferrer">Public source repository</a> · <a href={`${PUBLIC_SOURCE}/tree/main/programs/radiolan-arena/src`} target="_blank" rel="noopener noreferrer">Published RLAN arena program source</a></Fact>
        <Fact label="Arena program"><Address id={ARENA_PROGRAM} /></Fact>
        <Fact label="RLAN mint"><Address id={RLAN_MINT} /> · <a href={`https://jup.ag/swap/SOL-${RLAN_MINT}`} target="_blank" rel="noopener noreferrer">Jupiter</a></Fact>
        <Fact label="ICELAN mint"><Address id={ICELAN_MINT} /></Fact>
      </dl>
    </section>
  </>;
}
