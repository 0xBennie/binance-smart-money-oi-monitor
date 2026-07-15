/** Per-side position change from the local DB. Use `--` before script args. */
import 'dotenv/config';
import { getChange, type ChangeResult } from '../tracking.js';
import { dbErrorHint } from '../storage.js';
import { fmtPrice } from '../format-num.js';
import { maybeHelp, parseFlags } from './cli-help.js';

const argv = process.argv.slice(2);
maybeHelp(argv, {
  usage: 'npm run change -- <SYMBOL> [minutes] [--json]',
  description: 'Per-side smart-money quantity added/reduced over the last N minutes (default 60); requires tracker history.',
  example: 'npm run change -- MAGMA 15',
});
const { json, rest } = parseFlags(argv);
const [sym, minArg] = rest;
if (!sym) {
  console.error('usage: npm run change -- <SYMBOL> [minutes] [--json]');
  process.exit(1);
}
const minutes = Number(minArg) > 0 ? Number(minArg) : 60;
let result: ReturnType<typeof getChange>;
try {
  result = getChange(sym, minutes);
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

const d: ChangeResult = result;
const fmtQty = (n: number) => Math.round(n).toLocaleString('en-US');
const signedQty = (n: number) => `${n > 0 ? '+' : ''}${fmtQty(n)}`;
const pct = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`;
const priceVs = (avg: number) => d.price != null && avg > 0
  ? `${d.price > avg ? '+' : ''}${(((d.price - avg) / avg) * 100).toFixed(1)}%`
  : '—';
const col = (value: string) => value.padEnd(20);
const L = d.long;
const S = d.short;
console.log([
  '',
  `  ${d.symbol.replace(/USDT$/, '')}  仓位变化  近 ${minutes}m (${d.samples} 样本, 实际跨度 ${d.spanMinutes}m)   现价 ${d.price != null ? '$' + fmtPrice(d.price) : '—'}`,
  `  ${'─'.repeat(58)}`,
  '                 多头 ▲                空头 ▼',
  `  张数(全体)     ${col(`${fmtQty(L.fromQty)}→${fmtQty(L.toQty)}`)} ${fmtQty(S.fromQty)}→${fmtQty(S.toQty)}`,
  `  变化           ${col(`${signedQty(L.qtyChange)} (${pct(L.qtyChangePct)})`)} ${signedQty(S.qtyChange)} (${pct(S.qtyChangePct)})`,
  `  庄家张数变化   ${col(`${signedQty(L.whale.qtyChange)} (${pct(L.whale.qtyChangePct)})`)} ${signedQty(S.whale.qtyChange)} (${pct(S.whale.qtyChangePct)})`,
  `  庄家均价       ${col(fmtPrice(L.whaleAvg))} ${fmtPrice(S.whaleAvg)}`,
  `  现价 vs 庄均   ${col(priceVs(L.whaleAvg))} ${priceVs(S.whaleAvg)}`,
  '', `  ${d.verdict}`, '', '  仅供数据分析，不构成投资建议。', '',
].join('\n'));
