import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RLAN_TOKEN_URL } from "../data/public-copy";
import { BUY_PATH_BLOCK, BUY_PATH_HERO, BuyRlanBar } from "./BuyRlanBar";

const cta = (html: string) => /<a class="btn btn--primary buy-rlan__cta"([^>]*)>/.exec(html)?.[1] ?? "";

describe("the Buy $RLAN button", () => {
  it("goes through the counted /go/ path, one per placement, and still opens in a new tab safely", () => {
    const hero = cta(renderToStaticMarkup(<BuyRlanBar variant="hero" />));
    const block = cta(renderToStaticMarkup(<BuyRlanBar variant="block" />));
    expect(hero).toContain(`href="${BUY_PATH_HERO}"`);
    expect(block).toContain(`href="${BUY_PATH_BLOCK}"`);
    expect(BUY_PATH_HERO).not.toBe(BUY_PATH_BLOCK);
    for (const attrs of [hero, block]) {
      expect(attrs).toContain('target="_blank"');
      expect(attrs).toContain('rel="noopener noreferrer"');
    }
  });

  it("keeps the ClawPump page as the redirect destination the docs name, and shows no other outbound buy link", () => {
    expect(RLAN_TOKEN_URL).toMatch(/^https:\/\/clawpump\.tech\/tokens\/[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    const html = renderToStaticMarkup(<BuyRlanBar variant="hero" />);
    expect(html).not.toContain("clawpump.tech/tokens");
  });
});
