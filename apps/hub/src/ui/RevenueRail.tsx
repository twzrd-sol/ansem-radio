import type { ReactNode } from "react";

import { CLAWPUMP_TOKEN_URL, ICELAN_EXPLORER_URL, REVENUE, RLAN_EXPLORER_URL } from "../data/revenue";
import { Ext, Icon } from "./atoms";

function Card({
  kind,
  title,
  status,
  text,
  children,
}: {
  kind: "live" | "closed";
  title: string;
  status: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <li className={`rev__card rev__card--${kind}`}>
      <span className={`rev__chip rev__chip--${kind}`}>{status}</span>
      <h3 className="rev__title">{title}</h3>
      <p className="small">{text}</p>
      {children}
    </li>
  );
}

/** Frontpage honesty: creator share, $RLAN links, $ICELAN vault closed. Never an open vault. */
export function RevenueRail() {
  return (
    <section className="rev" aria-label="Solana revenue">
      <div className="rev__head">
        <p className="eyebrow">{REVENUE.eyebrow}</p>
        <h2 className="h3">{REVENUE.title}</h2>
        <p className="small">{REVENUE.lede}</p>
      </div>
      <ul className="rev__grid">
        <Card {...REVENUE.creator}>
          <p className="rev__links">
            <Ext href={CLAWPUMP_TOKEN_URL}>ClawPump token page</Ext>
          </p>
        </Card>
        <Card {...REVENUE.rlan}>
          <p className="rev__links">
            <Ext href={RLAN_EXPLORER_URL}>$RLAN mint</Ext>
            <Ext href={CLAWPUMP_TOKEN_URL}>ClawPump</Ext>
          </p>
        </Card>
        <Card {...REVENUE.icelan}>
          <p className="rev__links">
            <Ext href={ICELAN_EXPLORER_URL}>$ICELAN mint</Ext>
            <a href="#/claim">Collect</a>
          </p>
        </Card>
      </ul>
    </section>
  );
}

export function RevenueStrip() {
  return (
    <p className="hero__status" role="status">
      {REVENUE.strip.map((item) => (
        <span key={item}>
          <Icon name="lock" size="sm" />
          {item}
        </span>
      ))}
    </p>
  );
}
