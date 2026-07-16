/**
 * Generate a shareable Smart Money panel (self-contained dark HTML) for a symbol.
 * Open the file in a browser and screenshot it for a tweet, or serve it anywhere.
 *
 * Usage:
 *   npm run panel BEAT
 *   npx tsx src/scripts/panel.ts ETH --out eth.html
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { buildPanel, renderPanelHtml } from '../panel.js';
import { maybeHelp } from './cli-help.js';

const args = process.argv.slice(2);
maybeHelp(args, {
  usage: 'npm run panel -- <SYMBOL> [--out file.html]',
  description: 'Generate a shareable Smart Money panel (self-contained dark HTML) for a symbol from live data — open it in a browser and screenshot for a tweet.',
  example: 'npm run panel -- BEAT --out beat.html',
});
const symbol = args.find((a) => !a.startsWith('-'));
if (!symbol) {
  console.error('usage: npm run panel -- <SYMBOL> [--out file.html]');
  process.exit(1);
}

const data = await buildPanel(symbol);
if (!data) {
  console.error(`no smart-money data for ${symbol} (unsupported symbol or Binance temporarily blocked)`);
  process.exit(1);
}

const outIdx = args.indexOf('--out');
const out = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : `${data.symbol.toLowerCase()}-panel.html`;
writeFileSync(out, renderPanelHtml(data));
console.log(`✅ wrote ${out} — open it in a browser and screenshot for a tweet.`);
