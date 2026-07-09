/**
 * Library basics. From a clone:  npx tsx examples/basics.ts BEAT
 * In your own project, install the package and change the import to:
 *   import { ... } from 'binance-smart-money-oi-monitor';
 */
import {
  getSmartMoneyOverview,
  getOpenInterest,
  smartMoneyNotionalUsd,
  smartMoneyShareOfOI,
  buildPanel,
  renderPanelHtml,
} from '../src/index.js';
import { writeFileSync } from 'node:fs';

const symbol = (process.argv[2] || 'BTC').toUpperCase().replace(/USDT$/, '') + 'USDT';

// 1. Raw smart-money + OI, and the two derived metrics.
const [sm, oi] = await Promise.all([getSmartMoneyOverview(symbol), getOpenInterest(symbol)]);
if (!sm) {
  console.error(`no smart-money data for ${symbol} (retry, or it may be uncovered)`);
  process.exit(1);
}
console.log(`${symbol}  L/S ratio ${sm.longShortRatio}`);
console.log(`  long whales avg ${sm.longWhalesAvgEntryPrice}, ${sm.longProfitTraders}/${sm.longTraders} in profit`);
console.log(`  smart-money notional  $${(smartMoneyNotionalUsd(sm) / 1e6).toFixed(2)}M`);
if (oi) console.log(`  share of total OI     ${((smartMoneyShareOfOI(sm, oi.oiNowUsd) ?? 0) * 100).toFixed(1)}%`);

// 2. Build a shareable panel and write it to an HTML file.
const panel = await buildPanel(symbol);
if (panel) {
  const out = `${symbol.toLowerCase()}-panel.html`;
  writeFileSync(out, renderPanelHtml(panel));
  console.log(`\nwrote ${out} — open it in a browser`);
}
