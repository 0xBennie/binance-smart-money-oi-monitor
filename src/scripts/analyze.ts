/**
 * One-shot readable Smart Money report for a coin — no server, no AI, just a
 * formatted terminal summary. Live data via the library.
 *   npm run analyze BEAT
 */
import 'dotenv/config';
import { buildPanel } from '../panel.js';
import { fmtUsd, fmtPrice, fmtPct, fmtChg } from '../format-num.js';
import { maybeHelp, parseFlags } from './cli-help.js';

const argv = process.argv.slice(2);
maybeHelp(argv, {
  usage: 'npm run analyze -- <SYMBOL> [--json]',
  description: 'One-shot readable Smart Money report for a coin from live data — no server, no AI, just a formatted terminal summary.',
  example: 'npm run analyze -- BEAT',
});
const { json, rest } = parseFlags(argv);
const sym = rest[0];
if (!sym) {
  console.error('usage: npm run analyze -- <SYMBOL> [--json]');
  process.exit(1);
}

const d = await buildPanel(sym);
if (!d) {
  console.error(`no data for ${sym} — retry (transient), or it may not have Smart Signal data. See TROUBLESHOOTING.md.`);
  process.exit(1);
}
if (json) {
  console.log(JSON.stringify(d, null, 2));
  process.exit(0);
}

const ratio = d.longShortNotionalRatio;
const L = d.long, S = d.short;
const priceVs = (avg: number) => (d.price != null && avg > 0 ? `${d.price > avg ? '+' : ''}${(((d.price - avg) / avg) * 100).toFixed(1)}%` : '—');

const lines = [
  ``,
  `  ${d.symbol.replace(/USDT$/, '')}  聪明钱分析   现价 ${d.price != null ? '$' + fmtPrice(d.price) : '—'}`,
  `  ${'─'.repeat(52)}`,
  `  多空比(名义)   ${ratio == null ? '—' : ratio.toFixed(2)}     总持仓 ${fmtUsd(d.totalNotionalUsd)} · ${d.totalTraders} 人`,
  ``,
  `                 多头 ▲                空头 ▼`,
  `  交易员/大户     ${String(L.traders).padEnd(4)}/ ${String(L.whales).padEnd(10)} ${String(S.traders).padEnd(4)}/ ${S.whales}`,
  `  平均成本       ${fmtPrice(L.avgEntry).padEnd(14)} ${fmtPrice(S.avgEntry)}`,
  `  现价 vs 成本   ${priceVs(L.avgEntry).padEnd(14)} ${priceVs(S.avgEntry)}`,
  `  盈利占比       ${fmtPct(L.profitPct).padEnd(14)} ${fmtPct(S.profitPct)}`,
  `  预估 PNL       ${fmtUsd(L.pnlUsd).padEnd(14)} ${fmtUsd(S.pnlUsd)}`,
  ``,
  `  头部持仓 LSR   ${d.topPositionLsr ?? '—'}      Taker 买卖比 ${d.takerBsr ?? '—'}`,
  // oiChg4h is ALREADY a percent (4.05 = 4.05%) — fmtChg, never ×100.
  `  SM 占全市场OI  ${fmtPct(d.smShareOfOI)}      总 OI ${fmtUsd(d.oiNowUsd)} (${fmtChg(d.oiChg4h)} 4h)`,
  ``,
  `  仅供数据分析，不构成投资建议。`,
  ``,
];
console.log(lines.join('\n'));
