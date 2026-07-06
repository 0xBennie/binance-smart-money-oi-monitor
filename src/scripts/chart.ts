/**
 * Time-series chart of a symbol's smart-money long/short position + avg entry,
 * from the local DB, as a self-contained dark HTML file.
 *   npm run chart BEAT        # last 24h
 *   npm run chart BEAT 72     # last 72h
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { buildChart, renderChartHtml } from '../chart.js';

const [sym, hoursArg] = process.argv.slice(2);
if (!sym) {
  console.error('usage: npm run chart <SYMBOL> [hours]');
  process.exit(1);
}
const hours = Number(hoursArg) > 0 ? Number(hoursArg) : 24;
const data = buildChart(sym, hours);
if (data.rows.length < 2) {
  console.error(`not enough local history for ${data.symbol} — run the tracker (npm run track) for a while first, with ${data.symbol} in the watchlist.`);
  process.exit(1);
}
const out = `${data.symbol.toLowerCase()}-chart.html`;
writeFileSync(out, renderChartHtml(data));
console.log(`✅ wrote ${out} (${data.rows.length} points) — open it in a browser and screenshot.`);
