import { ARENA_PROGRAM, RLAN_MINT } from "../chain/config";
import { PageHead } from "./atoms";

export const PUBLIC_SOURCE = "https://github.com/twzrd-sol/ansem-radio";
export function HowLink() { return <a href="#/how">How this works</a>; }

/** One shared explanation for Play, backing, identity and the station. */
export function HowItWorks() {
  return <>
    <PageHead title="How Radio LAN works" lede="Play for points. Follow your creators. Back them with RLAN when you choose." />
    <section className="panel how-copy" aria-label="Radio LAN rules">
      <p>Play is free. Each season, do activities on this site to earn points. Points freeze when the season closes. A finalized board can be anchored on Solana. If the season was funded, your share of its perks follows your points.</p>
      <p>Backing is optional. You can commit RLAN to a creator you watch. It sits in your own support account, nobody else can move it, and you can request it back any time. It becomes available when the on-chain season you asked in ends. Adding more cancels a pending request. If the creator closes the arena, every position unlocks.</p>
      <p>Backing adds no points and changes nobody's share. Twitch figures are shown for context only. Following is saved in this browser and adds no points.</p>
      <p>A hub account keeps your activity records. Twitch identity and a wallet are optional links. Twitch viewing, chat and Channel Points do not determine season points.</p>
      <p>Radio LAN never asks for your seed phrase or private key. Connecting reads your wallet's public address. Your wallet opens for a transaction only when you tap Sign.</p>
      <p>The hub currently uses devnet test tokens. The ClawPump launch token lives on mainnet. Mainnet backing and collecting perks will appear when those flows are ready.</p>
    </section>
    <section className="section" aria-label="Public source">
      <h2 className="h2">Built in the open</h2>
      <p><a href={PUBLIC_SOURCE} target="_blank" rel="noopener noreferrer">MIT source on GitHub</a> · <a href={`${PUBLIC_SOURCE}/tree/main/programs/radiolan-arena/src`} target="_blank" rel="noopener noreferrer">Solana program source</a></p>
      <p className="small">Program <code>{ARENA_PROGRAM}</code></p>
      <p className="small">Mainnet RLAN mint <code>{RLAN_MINT}</code></p>
    </section>
  </>;
}
