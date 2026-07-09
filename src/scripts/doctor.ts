/**
 * Self-diagnosis: is Binance reachable, is the native DB dep OK, is the local
 * snapshot DB populated? Turns "it doesn't work" into a checklist.
 *   npm run doctor
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { preflightBinanceFapi, isBinanceApiBlocked } from '../binance-rate-limit.js';
import { getSmartMoneyOverview } from '../binance-smart-money.js';

const OK = '✅', BAD = '❌', WARN = '⚠️ ';
const rows: string[] = [];
const add = (icon: string, label: string, detail = '') => rows.push(`  ${icon} ${label}${detail ? '  — ' + detail : ''}`);

// 1. Node version
const major = parseInt(process.versions.node.split('.')[0]!, 10);
add(major >= 20 ? OK : BAD, `Node ${process.versions.node}`, major >= 20 ? '' : 'needs >= 20');

// 2. Native / optional deps
async function canImport(name: string): Promise<boolean> {
  try { await import(name); return true; } catch { return false; }
}
const hasSqlite = await canImport('better-sqlite3');
add(hasSqlite ? OK : WARN, 'better-sqlite3', hasSqlite ? '' : 'not built — tracker + time-series tools need it (see TROUBLESHOOTING.md)');
const hasExpress = await canImport('express');
add(hasExpress ? OK : WARN, 'express', hasExpress ? '' : 'not installed — only the dashboard needs it (npm install express)');

// 3. Binance reachability
const reachable = await preflightBinanceFapi();
add(reachable ? OK : BAD, 'Binance fapi reachable', reachable ? '' : 'ping failed — geo-blocked region or IP rate-limited (use a proxy / VPS)');
add(isBinanceApiBlocked() ? WARN : OK, 'circuit breaker', isBinanceApiBlocked() ? 'currently TRIPPED — wait for the TTL' : 'clear');

// 4. Live Smart Money sample
if (reachable) {
  const sm = await getSmartMoneyOverview('BTCUSDT');
  add(sm ? OK : WARN, 'live Smart Money (BTCUSDT)', sm ? `LSR ${sm.longShortRatio}` : 'empty — retry; if persistent, endpoint/region issue');
}

// 5. Local snapshot DB
const dbPath = process.env.SMART_MONEY_DB_PATH || path.join(process.cwd(), 'data', 'snapshots.db');
if (!fs.existsSync(dbPath)) {
  add(WARN, 'local DB', `${dbPath} not found — time-series tools (change/scan/chart) need the tracker (npm run track) first`);
} else if (hasSqlite) {
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const c: any = db.prepare('SELECT COUNT(*) n, COUNT(DISTINCT symbol) s, MAX(ts) t FROM ob_smart_money_snapshots').get();
    db.close();
    const ageMin = c.t ? Math.round((Date.now() - c.t) / 60000) : null;
    add(c.n > 0 ? OK : WARN, 'local DB', `${dbPath} — ${c.n} snapshots / ${c.s} symbols, newest ${ageMin == null ? '—' : ageMin + 'm ago'}`);
  } catch (e: any) {
    add(BAD, 'local DB', `unreadable: ${e?.message ?? e}`);
  }
}

console.log('\n  binance-smart-money-oi-monitor — doctor\n');
console.log(rows.join('\n'));
console.log('');
process.exit(0);
