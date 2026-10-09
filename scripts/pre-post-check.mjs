#!/usr/bin/env node
// Read-only gate check before any public post about $RLAN, $ICELAN, claims or the arena.
// Prints one line per check: PASS / FAIL / INFO / UNVERIFIED. Exit 1 only when a gate FAILs.
// Public RPC only (override with RPC_URL). No secrets, no writes, no wallet.
//
//   node scripts/pre-post-check.mjs            # full run
//   RPC_URL=https://... node scripts/pre-post-check.mjs
//
// Checks: legal pages are real pages (not the hub SPA shell); RLAN still routes through the
// pump.fun curve; both mints have revoked authorities; the ICELAN vault balance; rewards-program
// transaction count (claims landed?); upgrade authority of both programs; claim, Twitch-link and
// leaderboard route states.

const SITE = process.env.SITE_URL ?? "https://radiolan.live";
const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const JUP = "https://lite-api.jup.ag/swap/v1/quote";
const SOL = "So11111111111111111111111111111111111111112";
const RLAN = "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy";
const ICELAN = "Dxpt78DTyBv3USxqsFKhQsthTF1JnjdiXQXTPLGBK9m";
const ARENA = "5MvZnDK38E3MkvgxnvwMAuSAvxtAf7CQirzunK3Sr8Kf";
const REWARDS = "5wAVbHfZCBrYPymk1FNeV4D69iZioUmZaiE4ki4qrqWD";
const VAULT_TOKENS = "2rWTNKcH9wjcjTgSaktZgpviP6C3XWTwJ9V1EBVRDUVt";
const HOT_KEY = "EatwUpB2eCRcCEJgvQvzNb1hiPKqasjzXQ7NtVVFuLYX";

const rows = [];
let failed = false;
const out = (level, name, detail) => {
  if (level === "FAIL") failed = true;
  rows.push([level, name, detail]);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, init = {}) {
  const res = await fetch(url, { redirect: "manual", ...init, headers: { "user-agent": "radiolan-pre-post-check", ...(init.headers ?? {}) } });
  const body = await res.text();
  return { status: res.status, body };
}

let rpcId = 0;
async function rpc(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(attempt === 0 ? 400 : 1500 * attempt);
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    if (res.status === 429) continue;
    const json = await res.json();
    if (json.error?.code === 429) continue;
    if (json.error) throw new Error(`${method}: ${json.error.message}`);
    return json.result;
  }
  throw new Error(`${method}: rate limited after 4 attempts`);
}

const isShell = (body, shell) => body === shell || /<div id="root">/.test(body);

async function legalPages() {
  const shell = (await http(`${SITE}/hub/`)).body;
  for (const path of ["/terms", "/privacy"]) {
    const { status, body } = await http(`${SITE}${path}`);
    const word = path === "/terms" ? /terms/i : /privacy/i;
    if (status === 200 && !isShell(body, shell) && word.test(body) && /TWZRD, Inc\./.test(body)) {
      out("PASS", `legal ${path}`, "200, real page, names TWZRD, Inc.");
    } else if (status === 200 && isShell(body, shell)) {
      out("FAIL", `legal ${path}`, "200 but it is the hub SPA shell, not a page");
    } else {
      out("FAIL", `legal ${path}`, `HTTP ${status}`);
    }
  }
}

async function curve() {
  try {
    const url = `${JUP}?inputMint=${SOL}&outputMint=${RLAN}&amount=10000000&slippageBps=100`;
    const { status, body } = await http(url);
    if (status !== 200) return out("UNVERIFIED", "RLAN curve", `Jupiter HTTP ${status}`);
    const labels = (JSON.parse(body).routePlan ?? []).map((p) => p.swapInfo?.label);
    if (labels.length === 1 && /pump\.fun/i.test(labels[0])) out("INFO", "RLAN curve", "still on the pump.fun curve (single Pump.fun hop); post 4 wording holds");
    else out("INFO", "RLAN curve", `route changed: ${labels.join(" > ") || "none"}; rewrite post 4 before posting`);
  } catch (e) {
    out("UNVERIFIED", "RLAN curve", e.message);
  }
}

async function mint(name, address, expectedSupply) {
  try {
    const info = (await rpc("getAccountInfo", [address, { encoding: "jsonParsed" }]))?.value?.data?.parsed?.info;
    if (!info) return out("UNVERIFIED", `${name} mint`, "no parsed data");
    const revoked = info.mintAuthority == null && info.freezeAuthority == null;
    // pump.fun mints carry 999,999,999.999999: compare whole tokens to within one unit.
    const scale = 10n ** BigInt(info.decimals);
    const raw = BigInt(info.supply);
    const whole = (raw + scale / 2n) / scale;
    const diff = whole > expectedSupply ? whole - expectedSupply : expectedSupply - whole;
    const level = revoked && diff <= 1n ? "PASS" : "FAIL";
    const ui = `${raw / scale}.${(raw % scale).toString().padStart(info.decimals, "0")}`;
    out(level, `${name} mint`, `supply ${ui}, mintAuthority ${info.mintAuthority ?? "none"}, freezeAuthority ${info.freezeAuthority ?? "none"}`);
  } catch (e) {
    out("UNVERIFIED", `${name} mint`, e.message);
  }
}

async function vault() {
  try {
    const bal = await rpc("getTokenAccountBalance", [VAULT_TOKENS]);
    out("INFO", "ICELAN vault", `${Number(bal.value.uiAmountString).toLocaleString("en-US")} ICELAN in vault tokens`);
  } catch (e) {
    out("UNVERIFIED", "ICELAN vault", e.message);
  }
}

async function rewardsActivity() {
  try {
    const sigs = await rpc("getSignaturesForAddress", [REWARDS, { limit: 50 }]);
    const newest = sigs[0] ? new Date(sigs[0].blockTime * 1000).toISOString() : "none";
    out("INFO", "rewards program txs", `${sigs.length} signatures (5 setup txs through 2026-10-07); newest ${newest}. Anything above 5 may be a claim: recount before saying "zero claims"`);
  } catch (e) {
    out("UNVERIFIED", "rewards program txs", e.message);
  }
}

async function authority(name, program) {
  try {
    const prog = (await rpc("getAccountInfo", [program, { encoding: "jsonParsed" }]))?.value?.data?.parsed?.info;
    const pd = prog?.programData;
    if (!pd) return out("UNVERIFIED", `${name} upgrade authority`, "program account not parsed");
    const data = (await rpc("getAccountInfo", [pd, { encoding: "jsonParsed" }]))?.value?.data?.parsed?.info;
    const auth = data?.authority ?? "none (immutable)";
    out("INFO", `${name} upgrade authority`, auth === HOT_KEY ? "still the single hot key; post 11 wording holds" : `changed: ${auth}; rewrite post 11`);
  } catch (e) {
    out("UNVERIFIED", `${name} upgrade authority`, e.message);
  }
}

async function routes() {
  const claim = await http(`${SITE}/hub/api/icelan-claim`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  out("INFO", "claim route", claim.status === 404 ? "404: claims handler OFF" : `HTTP ${claim.status}: claims handler mounted (401 or 403 both mean session-gated)`);
  const twitch = await http(`${SITE}/hub/api/identity/twitch/start`, { method: "POST" });
  out("INFO", "twitch link route", twitch.status === 404 ? "404: Twitch link OFF" : `HTTP ${twitch.status}: Twitch link mounted`);
  const board = await http(`${SITE}/hub/api/leaderboard`);
  out("INFO", "leaderboard api", board.status === 200 ? "200: streamer board ON" : `HTTP ${board.status}: streamer board OFF`);
}

await legalPages();
await curve();
await mint("RLAN", RLAN, 1_000_000_000n);
await mint("ICELAN", ICELAN, 6_665_498_680n);
await vault();
await rewardsActivity();
await authority("arena", ARENA);
await authority("rewards", REWARDS);
await routes();

const width = Math.max(...rows.map((r) => r[1].length));
console.log(`pre-post check  site=${SITE}  rpc=${new URL(RPC).host}  at=${new Date().toISOString()}`);
for (const [level, name, detail] of rows) console.log(`${level.padEnd(10)} ${name.padEnd(width)}  ${detail}`);
console.log(failed ? "\nRESULT: GATE FAILED. Do not post." : "\nRESULT: gates pass. Re-read INFO lines against the draft before posting.");
process.exit(failed ? 1 : 0);
