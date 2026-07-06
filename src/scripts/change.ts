/**
 * How much each side added/reduced over the last N minutes, from the local DB.
 *   npm run change MAGMA          # last 60 min
 *   npm run change MAGMA 15       # last 15 min
 */
import 'dotenv/config';
import { getChange } from '../tracking.js';

const [sym, minArg] = process.argv.slice(2);
if (!sym) {
  console.error('usage: npm run change <SYMBOL> [minutes]');
  process.exit(1);
}
const minutes = Number(minArg) > 0 ? Number(minArg) : 60;
console.log(JSON.stringify(getChange(sym, minutes), null, 2));
