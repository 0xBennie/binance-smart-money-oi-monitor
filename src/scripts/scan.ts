/**
 * Market-wide long/short-imbalance scan from the local DB.
 *   npm run scan            # top 10 each side
 *   npm run scan 20         # top 20 each side
 */
import 'dotenv/config';
import { scanExtreme } from '../tracking.js';
import { dbErrorHint } from '../storage.js';
import { maybeHelp, parseFlags } from './cli-help.js';

const argv = process.argv.slice(2);
maybeHelp(argv, {
  usage: 'npm run scan -- [limit] [--json]',
  description: 'Market-wide long/short-imbalance scan from the local DB — top N most long- and short-heavy symbols (default 10 each); requires tracker history.',
  example: 'npm run scan -- 20',
});
const { json, rest } = parseFlags(argv);
const limit = Number(rest[0]) > 0 ? Number(rest[0]) : 10;
let res: any;
try {
  res = scanExtreme({ limit });
} catch (e) {
  console.error(dbErrorHint(e));
  process.exit(1);
}
if ('error' in res) {
  console.error(res.error);
  process.exit(1);
}
if (json) {
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}
const line = (e: any) =>
  `  ${String(e.symbol).padEnd(16)} LSR ${String(e.longShortRatio).padEnd(8)} 多盈 ${e.longProfitPct ?? '—'}%  空盈 ${e.shortProfitPct ?? '—'}%  (${e.ageMin}m ago)`;
console.log(`scanned ${res.scanned} symbols\n`);
console.log('▲ 多空比最高 (highest long/short ratio):');
res.mostLong.forEach((e: any) => console.log(line(e)));
console.log('\n▼ 多空比最低 (lowest long/short ratio):');
res.mostShort.forEach((e: any) => console.log(line(e)));
