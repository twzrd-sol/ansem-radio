import { describe, expect, it } from "vitest";
import { embedSnippets } from "./embed";

const base = { origin: "https://radiolan.live", pathname: "/hub/", slug: "ninja", name: "Ninja" };

describe("embed snippets", () => {
  it("points at the host that is serving the hub, for the page and the badge", () => {
    const s = embedSnippets(base);
    expect(s.pageUrl).toBe("https://radiolan.live/hub/#/s/ninja");
    expect(s.badgeUrl).toBe("https://radiolan.live/hub/api/badge/ninja.svg");
    expect(s.html).toBe('<a href="https://radiolan.live/hub/#/s/ninja"><img src="https://radiolan.live/hub/api/badge/ninja.svg" alt="Ninja on Radio LAN" width="320" height="140"></a>');
    expect(s.markdown).toBe("[![Ninja on Radio LAN](https://radiolan.live/hub/api/badge/ninja.svg)](https://radiolan.live/hub/#/s/ninja)");
  });
  it("escapes a hostile display name in both formats", () => {
    const s = embedSnippets({ ...base, name: 'A"><script>x</script>]' });
    expect(s.html).not.toContain("<script>");
    expect(s.html).toContain("&quot;&gt;&lt;script&gt;");
    expect(s.markdown).toContain("\\]");
  });
  it("refuses a malformed slug", () => {
    expect(() => embedSnippets({ ...base, slug: "Bad Slug" })).toThrow();
  });
});
