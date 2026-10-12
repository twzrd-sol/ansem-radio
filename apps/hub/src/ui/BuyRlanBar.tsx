import { useState } from "react";

import { RLAN_MINT } from "../chain/config";
import { BUY_RLAN_LINE, HOW_TO_BUY, HOW_TO_BUY_STEPS } from "../data/public-copy";

/** The Buy button goes through radiolan.live so each click is counted at the edge and the destination can change without a deploy.
 *  Cloudflare redirects both paths (302) to the ClawPump token page, `RLAN_TOKEN_URL`. One path per placement, because the
 *  free plan's analytics show paths but not query strings. If the redirect rule is ever removed these become 404s. */
export const BUY_PATH_HERO = "/go/buy";
export const BUY_PATH_BLOCK = "/go/buy-block";

export type MintCopyState = "idle" | "copied" | "failed";

export function copyMintLabel(state: MintCopyState): string {
  if (state === "copied") return "Copied";
  if (state === "failed") return "Copy failed";
  return "Copy";
}

export function BuyRlanBar({ variant = "block" }: { variant?: "hero" | "block" } = {}) {
  const [copyState, setCopyState] = useState<MintCopyState>("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(RLAN_MINT);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
    }
  };
  return (
    <section className={variant === "hero" ? "buy-rlan buy-rlan--hero" : "buy-rlan"} aria-label="Buy $RLAN">
      <a className="btn btn--primary buy-rlan__cta" href={variant === "hero" ? BUY_PATH_HERO : BUY_PATH_BLOCK} target="_blank" rel="noopener noreferrer">
        Buy $RLAN
      </a>
      <p className="small">Buying is optional; playing is free. Tokens can lose all value. Radio LAN receives creator fees through ClawPump, a third-party launchpad. <a href="/terms#tokens">Read token risks and terms</a> and the <a href="/legal#rlan">launch disclosure</a>.</p>
      <p className="small buy-rlan__line">{BUY_RLAN_LINE}</p>
      <p className="buy-rlan__how">{HOW_TO_BUY}</p>
      <ol className="buy-rlan__steps">
        {HOW_TO_BUY_STEPS.map((step) => (
          <li key={step.n}>
            <span className="buy-rlan__n" aria-hidden="true">{step.n}</span>
            <span>{step.title}</span>
          </li>
        ))}
      </ol>
      <p className="buy-rlan__mint small">
        Mint <code className="mono">{RLAN_MINT}</code>
        <button className="link-btn" type="button" onClick={() => void copy()}>
          {copyMintLabel(copyState)}
        </button>
      </p>
      {copyState === "failed" && (
        <p className="buy-rlan__error" role="alert">Could not copy the mint. Select it and copy it yourself.</p>
      )}
    </section>
  );
}
