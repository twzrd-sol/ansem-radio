// Labeled fixtures for the prototype. Production paths never import this unless ?tape=demo is set.
import type { ChannelRef, TapeEvent } from "./events";

export const DEMO_CHANNELS: ChannelRef[] = [
  { slug: "radiolanlive", name: "Radio LAN", arena: "TapeDemoArena1111111111111111111111111111" },
  { slug: "lan-east", name: "LAN East", arena: "TapeDemoArena2222222222222222222222222222" },
  { slug: "lan-west", name: "LAN West", arena: "TapeDemoArena3333333333333333333333333333" },
];

export function demoEvents(now = 1_775_712_000_000): TapeEvent[] {
  const slot = 512_400;
  return [
    { id: "demo-1", kind: "deposit", slot, at: now - 12_000, account: DEMO_CHANNELS[0]!.arena!, channel: "Radio LAN", slug: "radiolanlive", participants: 12, summary: "Deposit · comes back 1:1 · 12 participants" },
    { id: "demo-2", kind: "season", slot: slot + 2, at: now - 8_000, account: DEMO_CHANNELS[1]!.arena!, channel: "LAN East", slug: "lan-east", participants: 4, season: 2, summary: "Season 2 opened" },
    { id: "demo-3", kind: "deposit", slot: slot + 2, at: now - 7_500, account: DEMO_CHANNELS[1]!.arena!, channel: "LAN East", slug: "lan-east", participants: 4, summary: "Deposit · comes back 1:1 · 4 participants" },
    { id: "demo-4", kind: "deposit", slot: slot + 5, at: now - 3_000, account: DEMO_CHANNELS[0]!.arena!, channel: "Radio LAN", slug: "radiolanlive", participants: 13, summary: "Deposit · comes back 1:1 · 13 participants" },
    { id: "demo-5", kind: "withdraw", slot: slot + 5, at: now - 2_800, account: DEMO_CHANNELS[0]!.arena!, channel: "Radio LAN", slug: "radiolanlive", participants: 12, summary: "Withdrawal · 12 participants" },
    { id: "demo-6", kind: "deposit", slot: slot + 6, at: now - 1_000, account: DEMO_CHANNELS[2]!.arena!, channel: "LAN West", slug: "lan-west", participants: 1, summary: "Deposit · comes back 1:1 · 1 participant" },
  ];
}

export function readTapeDemo(search: string): boolean {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("tape") === "demo";
}
