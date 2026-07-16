/**
 * Time-series chart of a symbol's smart-money long/short position + avg entry,
 * from the local DB, as a self-contained dark HTML file.
 *   npm run chart BEAT        # last 24h
 *   npm run chart BEAT 72     # last 72h
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { buildChart, renderChartHtml } from '../chart.js';
import { dbErrorHint } from '../storage.js';
import { maybeHelp, parseFlags } from './cli-help.js';

const argv = process.argv.slice(2);
maybeHelp(argv, {
  usage: 'npm run chart -- <SYMBOL> [hours]',
  description: "Time-series chart of a symbol's smart-money long/short position + avg entry, written as a self-contained dark HTML file (default last 24h); requires tracker history.",
  example: 'npm run chart -- BEAT 72',
});
const { rest } = parseFlags(argv);
const [sym, hoursArg] = rest;
if (!sym) {
  console.error('usage: npm run chart -- <SYMBOL> [hours]');
  process.exit(1);
}
const hours = Number(hoursArg) > 0 ? Number(hoursArg) : 24;
let data;
try {
  data = await buildChart(sym, hours);
} catch (e) {
  console.error(dbErrorHint(e));
  process.exit(1);
}
if (data.rows.length < 2) {
  console.error(`not enough local history for ${data.symbol} — run the tracker (npm run track) for a while first, with ${data.symbol} in the watchlist.`);
  process.exit(1);
}
const out = `${data.symbol.toLowerCase()}-chart.html`;
writeFileSync(out, renderChartHtml(data));
console.log(`✅ wrote ${out} (${data.rows.length} points) — open it in a browser and screenshot.`);
