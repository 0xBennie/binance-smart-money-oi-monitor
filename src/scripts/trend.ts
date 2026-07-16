/** Per-side in-profit trend from the local DB. Use `--` before script args. */
import 'dotenv/config';
import { getProfitTrend, type ProfitTrend, type ProfitSideTrend } from '../tracking.js';
import { dbErrorHint } from '../storage.js';
import { maybeHelp, parseFlags } from './cli-help.js';

const argv = process.argv.slice(2);
maybeHelp(argv, {
  usage: 'npm run trend -- <SYMBOL> [minutes] [--json]',
  description: "How each side's trader/whale in-profit percentage moved over the last N minutes (default 60); requires tracker history.",
  example: 'npm run trend -- BEAT 120',
});
const { json, rest } = parseFlags(argv);
const [sym, minArg] = rest;
if (!sym) {
  console.error('usage: npm run trend -- <SYMBOL> [minutes] [--json]');
  process.exit(1);
}
const minutes = Number(minArg) > 0 ? Number(minArg) : 60;
let result: ReturnType<typeof getProfitTrend>;
try {
  result = getProfitTrend(sym, minutes);
} catch (e) {
  console.error(dbErrorHint(e));
  process.exit(1);
}
if ('error' in result) {
  console.error(result.error);
  process.exit(1);
}
if (json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const d: ProfitTrend = result;
const pair = (from: number | null, to: number | null, change: number | null) => {
  if (from == null || to == null) return '—';
  return `${from}%→${to}%${change == null ? '' : ` (${change > 0 ? '+' : ''}${change})`}`;
};
const traders = (side: ProfitSideTrend) => pair(side.fromPct, side.toPct, side.change);
const whales = (side: ProfitSideTrend) => pair(side.whaleFromPct, side.whaleToPct, side.whaleChange);
const col = (value: string) => value.padEnd(20);
console.log([
  '',
  `  ${d.symbol.replace(/USDT$/, '')}  盈利占比趋势  近 ${minutes}m (${d.samples} 样本, 实际跨度 ${d.spanMinutes}m)`,
  `  ${'─'.repeat(58)}`,
  '                 多头 ▲                空头 ▼',
  `  交易员盈利占比 ${col(traders(d.long))} ${traders(d.short)}`,
  `  庄家盈利占比   ${col(whales(d.long))} ${whales(d.short)}`,
  '', `  ${d.verdict}`, '', '  仅供数据分析，不构成投资建议。', '',
].join('\n'));
