/**
 * The chorus. Names contain "agent" so the account name itself discloses; every line
 * also carries the "(AI agent)" tag. Keep the list short: a chorus of fresh accounts
 * reads as fake engagement. Handles are Twitch logins the operator creates and authorizes.
 */

export const LAN = Object.freeze({
  handle: "radiolanlive",
  name: "LAN",
  style: "console",
  role: "host",
});

export const CHORUS = Object.freeze([
  Object.freeze({ handle: "ledger_agent", name: "Ledger", style: "numbers", role: "chat" }),
  Object.freeze({ handle: "hype_agent", name: "Hype", style: "culture", role: "chat" }),
  Object.freeze({ handle: "fade_agent", name: "Fade", style: "skeptic", role: "chat" }),
]);

export function personaByHandle(handle) {
  const login = String(handle ?? "").trim().toLowerCase();
  return [LAN, ...CHORUS].find((persona) => persona.handle === login) ?? null;
}
