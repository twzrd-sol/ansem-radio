import assert from "node:assert/strict";
import test from "node:test";

import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

import { seasonIndex, withdrawAvailableAt } from "../src/sinks/arena.js";

const html = readFileSync(new URL("../public/hub.html", import.meta.url), "utf8");
const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
const css = /<style>([\s\S]*)<\/style>/.exec(html)[1];

// Just enough DOM for the page's h() builder, so every screen renders in node and its text can be read.
class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.attrs = new Map();
    this.children = [];
    this.data = "";
  }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  getAttribute(key) { return this.attrs.has(key) ? this.attrs.get(key) : null; }
  removeAttribute(key) { this.attrs.delete(key); }
  addEventListener() {}
  append(...kids) {
    for (const kid of kids) {
      if (kid.tag === "#fragment") this.children.push(...kid.children);
      else this.children.push(kid);
    }
  }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  querySelector() { return null; }
  get textContent() { return this.tag === "#text" ? this.data : this.children.map((child) => child.textContent).join(" "); }
}
const fakeDocument = {
  createElement: (tag) => new FakeNode(tag),
  createElementNS: (_ns, tag) => new FakeNode(tag),
  createTextNode: (value) => Object.assign(new FakeNode("#text"), { data: value }),
  createDocumentFragment: () => new FakeNode("#fragment"),
};

function boot(search = "") {
  const context = vm.createContext({ __HUB_TEST__: true, document: fakeDocument, location: { search, hash: "", hostname: "twzrd.xyz", pathname: "/stream" }, URLSearchParams });
  vm.runInContext(script, context);
  return context.__hub;
}
const nodes = (root) => [root, ...root.children.flatMap((child) => nodes(child))];
const classes = (node) => (node.getAttribute?.("class") ?? "").split(" ");
const text = (root) => root.textContent.replace(/\s+/g, " ").trim();
const sentences = (value) => value.split(/(?<=[.!?])\s+/);
const hrefs = (root) => nodes(root).map((node) => node.getAttribute?.("href")).filter(Boolean);

// Every screen, with the argument its route takes.
const SCREENS = [["", ""], ["s", "radiolanlive"], ["play", ""], ["board", ""], ["back", ""], ["me", ""], ["claim", ""]];
const render = (hub, key, arg = "") => hub.ROUTES[key].render(arg);

test("the page script parses and builds every screen from text nodes, never markup", () => {
  assert.doesNotThrow(() => new vm.Script(script));
  for (const sink of [".innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "javascript:", "srcdoc", "localStorage", "sessionStorage", "document.cookie"]) {
    assert.equal(script.includes(sink), false, sink);
  }
  const hub = boot();
  for (const [key, arg] of SCREENS) assert.ok(text(render(hub, key, arg)).length > 0, key);
});

test("the page loads only its own fonts and the official Twitch player", () => {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self';/);
  assert.match(csp, /font-src 'self';/);
  assert.match(csp, /frame-src https:\/\/player\.twitch\.tv;/);
  assert.deepEqual(csp.match(/https?:\/\/[^\s;]+/g), ["https://player.twitch.tv"], "the CSP names one outside origin");
  assert.equal(/<(link|img|object|embed|base)\b/i.test(html), false);
  assert.equal(/<script[^>]*\bsrc=/i.test(html), false);
  const origins = new Set((html.match(/https?:\/\/[^\s"'`)<>;]+/g) ?? []).map((url) => new URL(url.replace(/\$\{[^}]*\}/g, "x")).origin));
  assert.deepEqual([...origins].sort(), ["http://www.w3.org", "https://explorer.solana.com", "https://player.twitch.tv", "https://www.twitch.tv"]);
  assert.equal(/www\.w3\.org\/(?!2000\/svg)/.test(html), false, "w3.org appears only as the SVG namespace");

});

test("the Twitch player waits for a tap, needs 400 x 300, and links out on narrower screens", () => {
  const hub = boot();
  const stream = render(hub, "s", "radiolanlive");
  assert.equal(nodes(stream).some((node) => node.tag === "iframe"), false, "no player loads before a tap");
  assert.ok(hrefs(stream).includes("https://www.twitch.tv/radiolanlive"), "Watch on Twitch is always offered");
  assert.match(text(stream), /Play here/);
  assert.equal(hub.EMBED_MIN_WIDTH, 400);
  assert.equal(hub.twitchEmbedSrc("twzrd.xyz"), "https://player.twitch.tv/?channel=radiolanlive&parent=twzrd.xyz&autoplay=true");
  assert.equal(hub.twitchEmbedSrc("www.twzrd.xyz"), "https://player.twitch.tv/?channel=radiolanlive&parent=www.twzrd.xyz&autoplay=true", "parent is the exact serving hostname");
  assert.match(script, /if \(box\.clientWidth < EMBED_MIN_WIDTH\)/);
  assert.match(script, /twitchEmbedSrc\(location\.hostname\)/);
  assert.match(css, /\.player--live \{ min-height: 300px; \}/);
  assert.match(css, /@container \(min-width: 400px\) \{ \.player__embed \{ display: inline-flex; \}/);
});

test("nothing forces a phone layout wider than the screen", () => {
  // A text input sizes itself to about 20 characters; at 48 px type that pushed the backing panel to 425 px on a
  // 390 px phone. Zero width plus flex lets it fill the row instead. The history table wraps instead of growing.
  assert.match(css, /\.amount input \{ flex: 1; width: 0; min-width: 0;/);
  assert.match(css, /\.tbl \{ width: 100%; table-layout: fixed;/);
  assert.match(css, /\.player \{ position: relative; overflow: hidden; width: 100%; aspect-ratio: 16 \/ 9; min-height: 250px;/, "explicit width, so the minimum height never widens the player");
});

test("fonts are self-hosted with their licenses", () => {
  const sources = [...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((m) => m[1]);
  assert.equal(sources.length, 3);
  for (const source of sources) {
    assert.match(source, /^\/public\/hub-fonts\/[a-z0-9-]+\.woff2$/);
    assert.ok(existsSync(new URL(`..${source}`, import.meta.url)), source);
  }
  for (const license of ["OFL-barlow.txt", "OFL-big-shoulders-display.txt"]) {
    assert.match(readFileSync(new URL(`../public/hub-fonts/${license}`, import.meta.url), "utf8"), /SIL Open Font License, Version 1\.1/);
  }
});

test("copy follows the hub plan: no yield, returns or launch claims anywhere in the page", () => {
  const lower = html.toLowerCase();
  for (const banned of [/\byield/, /\bapy\b/, /\breturns\b/, /\breturn on\b/, /guarantee/, /\binvest/, /\bgasless\b/, /no dev buy/, /\bstak(e|ed|es|ing)\b/, /earn by holding/, /\bprofit/, /\bairdrop/, /0% founder/, /\breward/]) {
    assert.equal(banned.test(lower), false, String(banned));
  }
});

test("the Today scenario shows no fixture on any screen", () => {
  const hub = boot("?scenario=today&position=active&flow=review");
  const fixtures = [String(hub.SAMPLE.players), `${hub.SAMPLE.pool.amount} ${hub.SAMPLE.pool.asset}`, hub.SAMPLE.fan.handle, hub.SAMPLE.board[0][0], `Season ${hub.SAMPLE.season}`, `Season ${hub.SAMPLE.last.season}`, hub.SAMPLE.wallet.address.slice(0, 4), hub.SAMPLE.upcoming[0].name];
  for (const [key, arg] of SCREENS) {
    const root = render(hub, key, arg);
    assert.equal(nodes(root).some((node) => classes(node).includes("tag--sample")), false, `${key} shows a SAMPLE mark`);
    for (const fixture of fixtures) assert.equal(text(root).includes(fixture), false, `${key} shows ${fixture}`);
  }
  assert.match(text(render(hub, "s", "radiolanlive")), /An unfunded season pays nothing/);
  assert.match(text(render(hub, "back")), /Wallet connect arrives with the build/, "no wallet step runs in Today");
});

test("the Sample scenario marks fixtures on every screen", () => {
  for (const search of ["", "?joined=0", "?position=requested&flow=review"]) {
    const hub = boot(search);
    for (const [key, arg] of SCREENS) {
      assert.ok(nodes(render(hub, key, arg)).some((node) => classes(node).includes("tag--sample")), `${search} ${key}`);
    }
  }
});

test("backing never promises points or odds, and states the release rule", () => {
  for (const position of ["none", "active", "requested", "releasable"]) {
    for (const flow of ["edit", "connect", "review", "signing", "done", "failed"]) {
      const hub = boot(`?position=${position}&flow=${flow}`);
      const all = text(render(hub, "back"));
      assert.match(all, /Request withdrawal anytime\./);
      assert.match(all, /Available after [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC/);
      for (const sentence of sentences(all).filter((s) => /\b(points?|odds|weight)\b/i.test(s))) {
        assert.match(sentence, /\b(no|never|not)\b/i, `${position}/${flow}: "${sentence}"`);
      }
    }
  }
  const backing = /function backingFacts\(\)[\s\S]*?\n  }\n/.exec(script)[0] + /function railBacking\(\)[\s\S]*?\n  }\n/.exec(script)[0];
  assert.match(backing, /never adds points|No points/);
});

test("on-chain screens carry the devnet ribbon, name the network and link the program", () => {
  const hub = boot("?flow=review");
  assert.equal(hub.ROUTES.back.devnet, true);
  for (const key of Object.keys(hub.ROUTES)) assert.equal(Boolean(hub.ROUTES[key].devnet), key === "back", key);
  assert.match(html, /<div id="ribbon" class="ribbon" role="note" hidden><span class="ribbon__word">DEVNET<\/span>/);
  const back = render(hub, "back");
  assert.ok(hrefs(back).includes(`https://explorer.solana.com/address/${hub.ARENA_PROGRAM}?cluster=devnet`));
  assert.ok(hrefs(back).includes(`https://explorer.solana.com/address/${hub.TEST_MINT}?cluster=devnet`));
  assert.match(text(back), /Solana devnet/);
  assert.match(text(back), /Simulation passed/);
  assert.match(text(back), /Account rent 0\.003654 SOL, returned when you withdraw everything/);
  assert.match(text(back), /never asks for your seed phrase/);

  const claim = render(boot(), "claim");
  assert.match(text(claim), /The pool payout program is separate from radiolan-arena and doesn't exist yet/);
  const claimButton = nodes(claim).find((node) => node.tag === "button" && /Claim/.test(text(node)));
  assert.equal(claimButton.getAttribute("disabled"), "");
  assert.match(text(claim), /When claims open, they will not require backing or a minimum RLAN balance/);
});

test("after a confirmed step the position card shows the chain read-back", () => {
  const panelText = (search) => text(render(boot(search), "back").children[1].children[0].children[0]);
  assert.match(panelText("?flow=done"), /Active 250\.000000 RLAN/);
  assert.match(panelText("?position=active&flow=done"), /Active 500\.000000 RLAN/);
  assert.match(panelText("?position=requested&flow=done"), /Active 500\.000000 RLAN/, "a deposit cancels the request");
  assert.match(panelText("?position=releasable&flow=done"), /No backing yet/);
  assert.match(panelText("?position=requested"), /Withdrawal requested/);
});

test("the wallet appears only at an on-chain step", () => {
  const hub = boot();
  for (const [key, arg] of SCREENS) assert.equal(text(render(hub, key, arg)).includes("Phantom"), false, key);
  assert.match(text(render(boot("?flow=connect"), "back")), /Phantom.*Solflare.*Backpack.*Mobile Wallet Adapter/);
  assert.match(text(render(boot("?joined=0"), "s", "radiolanlive")), /No wallet needed/);
});

test("activities are native, capped, and their caps add up to the season maximum", () => {
  const hub = boot();
  assert.deepEqual(Object.keys(hub.SAMPLE.policy).sort(), ["accepted_work", "poll_response", "question"]);
  assert.deepEqual([...new Set(hub.ACTIVITIES.map((a) => a.action))].sort(), ["accepted_work", "poll_response", "question"]);
  const play = render(hub, "play");
  const all = text(play);
  assert.match(all, /nothing from Twitch chat counts/);
  for (const a of hub.ACTIVITIES) assert.ok(all.includes(a.title), a.title);
  assert.equal((all.match(/\d a day · \d+ a season/g) ?? []).length, hub.ACTIVITIES.length);
  assert.equal(hub.seasonMax(), Object.values(hub.SAMPLE.policy).reduce((sum, r) => sum + r.points * r.perSeason, 0));
  assert.ok(hub.SAMPLE.fan.points <= hub.seasonMax());
  for (const [, points] of [...hub.SAMPLE.board, ...hub.SAMPLE.last.top]) assert.ok(points <= hub.seasonMax(), "no sample score above the cap");
});

test("the weekly season opens Monday 00:00 UTC, freezes at the end of Friday and ends the next Monday", () => {
  const { seasonWindow } = boot();
  const friday = seasonWindow(Date.parse("2026-10-02T13:00:00Z"));
  assert.equal(new Date(friday.opens).toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(new Date(friday.freezes).toISOString(), "2026-10-03T00:00:00.000Z");
  assert.equal(new Date(friday.ends).toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(friday.open, true);
  assert.equal(seasonWindow(Date.parse("2026-10-04T23:59:00Z")).open, false);
  assert.equal(new Date(seasonWindow(Date.parse("2026-10-05T00:00:00Z")).opens).toISOString(), "2026-10-05T00:00:00.000Z");
});

test("release dates follow the arena program's schedule, as the arena client computes it", () => {
  const hub = boot();
  for (const seconds of [60, 604800, 2419200]) {
    const start = 1790985600;
    for (const now of [start - 1, start, start + seconds - 1, start + seconds, start + 10 * seconds + 5]) {
      assert.equal(hub.arenaSeasonIndex(start, seconds, now), Number(seasonIndex(start, seconds, now)), `index ${seconds} ${now}`);
    }
    for (const requested of [0, 1, 12]) {
      assert.equal(hub.withdrawAvailableAt(start, seconds, requested), Number(withdrawAvailableAt(start, seconds, requested)), `available ${seconds} ${requested}`);
    }
  }
  assert.equal(hub.releaseAt(), hub.seasonWindow().ends, "a request this sample season is available when the next season opens");
  const today = boot("?scenario=today");
  assert.equal(today.releaseAt(), null, "no arena, no date");
  const backToday = text(render(today, "back"));
  assert.match(backToday, /No arena is open yet/);
  assert.doesNotMatch(backToday, /Available after [A-Z][a-z]{2} \d/);
});

test("status copy matches the chain: the arena program is live on mainnet, with no arena there yet", () => {
  assert.doesNotMatch(html, /mainnet is not live|mainnet waits for review|not deployed\. it waits/i);
  assert.match(html, /This preview uses Solana devnet\./);
  for (const search of ["", "?scenario=today"]) {
    assert.match(text(render(boot(search), "back")), /The radiolan-arena program has been live on mainnet since 2 Oct 2026\. No arena is open on mainnet yet, so this flow uses devnet\./);
  }
  assert.match(text(render(boot("?scenario=today"), "s", "radiolanlive")), /Program on mainnet, no arena yet/);
});

test("the station status is the page's only network read and is labelled Data: Twitch", () => {
  assert.equal((script.match(/\bfetch\(/g) ?? []).length, 1);
  assert.match(script, /fetch\("\/macro\/state\?hours=6"/);
  assert.match(html, /Data: Twitch/);
  assert.match(text(render(boot(), "s", "radiolanlive")), /Data: Twitch/);
});
