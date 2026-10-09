import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The legal pages are read without JavaScript. Cloudflare's email obfuscation rewrites every
// mailto into /cdn-cgi/l/email-protection and injects a decode script, which leaves no-JS readers
// with "[email protected]". The <!--email_off--> markers tell Cloudflare to leave the address alone.
const pages = ["privacy", "terms", "legal"] as const;
const read = (page: string) => readFileSync(new URL(`../public/${page}/index.html`, import.meta.url), "utf8");

describe("static legal pages", () => {
  it.each(pages)("%s keeps every contact address outside Cloudflare email obfuscation", (page) => {
    const html = read(page);
    const mailtos = html.match(/<a href="mailto:[^"]+">[^<]+<\/a>/g) ?? [];
    expect(mailtos.length).toBeGreaterThan(0);
    // Every mailto: in the file must be one of the plain links matched above; a link with extra
    // attributes or nested markup would otherwise escape the wrapping check.
    expect((html.match(/mailto:/g) ?? []).length).toBe(mailtos.length);
    for (const link of mailtos) expect(html).toContain(`<!--email_off-->${link}<!--/email_off-->`);
  });
  it.each(pages)("%s names the operator and loads no script", (page) => {
    const html = read(page);
    expect(html).toContain("TWZRD, Inc.");
    expect(html).not.toContain("<script");
  });
  it("legal page carries the durable token facts the thread links to", () => {
    const html = read("legal");
    for (const fact of [
      "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy",
      "Dxpt78DTyBv3USxqsFKhQsthTF1JnjdiXQXTPLGBK9m",
      "5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf",
      "5wAVbHfZCBrYPymk1FNeV4D69iZioUmZaiE4ki4qrqWD",
      "3,517,409 RLAN",
      "One operator key",
      "co-signed by a station key",
    ]) expect(html).toContain(fact);
    // Point-in-time facts live in dated posts, not on a legal page.
    for (const banned of ["zero claims", "bonding curve today", "treasury holds", "[confirm"]) expect(html.toLowerCase()).not.toContain(banned);
  });
});
