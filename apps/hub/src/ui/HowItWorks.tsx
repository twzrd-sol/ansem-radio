import { ARENA_PROGRAM, IS_MAINNET, RLAN_MINT } from "../chain/config";
import { Address, PageHead } from "./atoms";

export const PUBLIC_SOURCE = "https://github.com/twzrd-sol/ansem-radio";
export function HowLink() { return <a href="#/how">How this works</a>; }

/** One shared explanation for Play, backing, identity and the station. */
export function HowItWorks() {
  return <>
    <PageHead title="How Radio LAN works" lede={IS_MAINNET ? "The creator board reads the live Solana network. This season's points are scored on a test network that holds no real money. Play is free." : "Play for points. Follow your creators. Backing is a separate activity."} />
    <section className="panel how-copy" aria-label="Radio LAN rules">
      <p>Play is free. Each season, do activities on this site to earn points. Points freeze when the season closes. A finalized board can be anchored on Solana. If the season was funded, your share of its perks follows your points.</p>
      {IS_MAINNET ? <p>No mainnet arena is open on this hub. Backing is not available yet.</p> : <p>Backing is optional. You can commit RLAN to a creator you watch. It sits in your own support account, nobody else can move it, and you can request it back any time. It becomes available when the on-chain season you asked in ends. Adding more cancels a pending request. If the creator closes the arena, every position unlocks.</p>}
      <p>Backing adds no points and changes nobody's share. Twitch figures are shown for context only. Following is saved in this browser and adds no points.</p>
      <p>A hub account keeps your activity records. Twitch identity and a wallet are optional links. Twitch chat and Channel Points are not season points. Board figures are labelled Data: Twitch.</p>
      <p>Discord or X membership can unlock season-points eligibility after OAuth or a confirmed invite, only when season policy publishes that credit. A join click, a fresh join, or a fake account is refused. Likes, posts, and chat volume never count. Season points are not tokens.</p>
      <p>Radio LAN never asks for your seed phrase or private key. Connecting reads your wallet's public address. Your wallet opens for a transaction only when you tap Sign.</p>
      <p>{IS_MAINNET ? "RLAN is Radio LAN's token, launched through ClawPump. It is not being used for backing on this hub yet." : "This build uses devnet test tokens. The ClawPump launch token lives on mainnet."}</p>
    </section>
    <section className="section" aria-label="Public source">
      <h2 className="h2">Built in the open</h2>
      <p><a href={PUBLIC_SOURCE} target="_blank" rel="noopener noreferrer">MIT source on GitHub</a> · <a href={`${PUBLIC_SOURCE}/tree/main/programs/radiolan-arena/src`} target="_blank" rel="noopener noreferrer">Solana program source</a></p>
      <p className="small">Program address <Address id={ARENA_PROGRAM} /></p>
      <p className="small">Token address <Address id={RLAN_MINT} /> · <a href={`https://jup.ag/swap/SOL-${RLAN_MINT}`} target="_blank" rel="noopener noreferrer">Jupiter</a></p>    </section>
  </>;
}
