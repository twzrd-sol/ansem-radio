/**
 * Print the live Twitch board and the chorus's dry-run lines. Sends nothing.
 *   node src/markets/board-cli.js [--rows N]
 * Needs TWITCH_CLIENT_ID + TWITCH_IRC_OAUTH_TOKEN in the environment (the secrets manager run).
 */

import { createChorus } from "../agents/chorus.js";
import { describeTwitchRow, fetchTwitchBoard } from "./twitch-metrics.js";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback; };
const maxRows = Number(arg("--rows", 3)) || 3;

const board = await fetchTwitchBoard();
console.log(`Radio LAN live board · ${board.source} · ${board.generated_at} · ${board.live_count} tracked live, ${board.tracked_live_viewers.toLocaleString("en-US")} watching across tracked channels`);
for (const row of board.rows) console.log(`  ${describeTwitchRow(row)}`);
if (board.race) console.log(`  race: ${board.race.a} vs ${board.race.b}, gap ${board.race.gap.toLocaleString("en-US")}`);
if (board.offline.length) console.log(`  offline: ${board.offline.join(", ")}`);
if (board.errors.length) console.log(`\nerrors: ${board.errors.map((item) => Object.values(item).join(":")).join(", ")}`);

const chorus = createChorus({ schedule: (fn) => fn() });
const lines = await chorus.run(board, { maxRows });
console.log(`\nChorus dry run (${chorus.provider} brain, nothing sent):`);
for (const line of lines) console.log(line.text ? `  ${line.text}` : `  [${line.handle} dropped: ${line.reason}]`);
