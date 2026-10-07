import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultRegistry } from "../src/hub/registry.js";

// The hub says Radio LAN with no host credit.
const HOST = /WZRD OF ZO/i;
const HUB_CHROME = ["public/hub.html", "apps/hub/src/app/App.tsx", "apps/hub/src/screens/Lan.tsx", "apps/hub/src/screens/Market.tsx", "apps/hub/src/screens/Listing.tsx"];

test("hub chrome and the featured listing carry no host credit", () => {
  for (const file of HUB_CHROME) assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), HOST, file);
  const featured = defaultRegistry().find((row) => row.kind === "featured");
  assert.doesNotMatch(featured.blurb, HOST);
});
