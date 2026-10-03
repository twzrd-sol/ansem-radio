import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Strict CSP for the built page only (the dev server injects inline scripts). Same-origin bundle, the official
 * Twitch player, the RPC relay, and Mobile Wallet Adapter's local socket on Android (ws://localhost).
 */
export function contentSecurityPolicy(relayUrl: string | undefined): Plugin {
  const relayOrigin = relayUrl && /^https?:\/\//.test(relayUrl) ? new URL(relayUrl).origin : "";
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${relayOrigin ? ` ${relayOrigin}` : ""} ws://localhost:*`,
    "frame-src https://player.twitch.tv",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
  return {
    name: "radiolan-hub-csp",
    apply: "build",
    transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  // A local run keeps the hub API and relay same-origin by proxying them to the station (dev only; the edge does
  // this in production). Same-origin is what the session cookie (SameSite=Strict) and the passkey origin need.
  const proxy = env.VITE_HUB_STATION ? Object.fromEntries(["/hub/api", "/hub/rpc", "/macro/state", "/stream"].map((path) => [path, { target: env.VITE_HUB_STATION, changeOrigin: false }])) : undefined;
  return {
    base: "/hub/",
    plugins: [react(), tailwindcss(), contentSecurityPolicy(env.VITE_HUB_RPC_URL)],
    server: { proxy },
    preview: { proxy },
    build: { target: "es2022", sourcemap: false },
    test: { environment: "node", include: ["src/**/*.spec.{ts,tsx}"] },
  };
});
