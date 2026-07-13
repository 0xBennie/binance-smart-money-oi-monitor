/**
 * How each side's "% in profit" (traders + whales) moved over the last N minutes,
 * from the local DB. A flip from mostly-losing to mostly-winning is a real shift.
 *   npm run trend BEAT           # last 60 min
 *   npm run trend BEAT 120       # last 120 min
 */
import 'dotenv/config';
import { getProfitTrend } from '../tracking.js';
import { dbErrorHint } from '../storage.js';

const [sym, minArg] = process.argv.slice(2);
if (!sym) {
  console.error('usage: npm run trend <SYMBOL> [minutes]');
  process.exit(1);
}
const minutes = Number(minArg) > 0 ? Number(minArg) : 60;
try {
  console.log(JSON.stringify(getProfitTrend(sym, minutes), null, 2));
} catch (e) {
  console.error(dbErrorHint(e));
  process.exit(1);
}
