/**
 * Market-wide long/short-imbalance scan from the local DB.
 *   npm run scan            # top 10 each side
 *   npm run scan 20         # top 20 each side
 */
import 'dotenv/config';
import { scanExtreme } from '../tracking.js';
import { dbErrorHint } from '../storage.js';

const limit = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 10;
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
const line = (e: any) =>
  `  ${String(e.symbol).padEnd(16)} LSR ${String(e.longShortRatio).padEnd(8)} 多盈 ${e.longProfitPct ?? '—'}%  空盈 ${e.shortProfitPct ?? '—'}%  (${e.ageMin}m ago)`;
console.log(`scanned ${res.scanned} symbols\n`);
console.log('▲ 最偏多 (highest long/short ratio):');
res.mostLong.forEach((e: any) => console.log(line(e)));
console.log('\n▼ 最偏空 (lowest long/short ratio):');
res.mostShort.forEach((e: any) => console.log(line(e)));
