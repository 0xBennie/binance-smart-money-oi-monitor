// Time-series reads over the local snapshot DB: how much each side ADDED/REDUCED
// over a window, and a market-wide long/short-imbalance scan. All position deltas
// use qty (contract count), NOT USD notional — notional moves with price and would
// mistake a price move for a position change.
import { storage, type SmartMoneyHistoryRow } from './storage.js';
import { normalizeSymbol } from './symbol.js';

const r2 = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

export interface SideChange {
  fromQty: number; toQty: number;
  qtyChange: number;          // >0 added, <0 reduced (contracts)
  qtyChangePct: number | null;
  fromAvg: number; toAvg: number;
}

export interface ChangeResult {
  symbol: string; fromTs: number; toTs: number; spanMinutes: number; samples: number;
  long: SideChange; short: SideChange;
  verdict: string;
}

/** Pure: per-side delta between two snapshots. */
export function computeChange(from: SmartMoneyHistoryRow, to: SmartMoneyHistoryRow): { long: SideChange; short: SideChange } {
  const side = (fq: number, tq: number, fa: number, ta: number): SideChange => ({
    fromQty: fq, toQty: tq,
    qtyChange: tq - fq,
    qtyChangePct: fq > 0 ? r2(((tq - fq) / fq) * 100) : null,
    fromAvg: fa, toAvg: ta,
  });
  return {
    long: side(from.longQty, to.longQty, from.longAvg, to.longAvg),
    short: side(from.shortQty, to.shortQty, from.shortAvg, to.shortAvg),
  };
}

function word(qtyChange: number, sideZh: string): string {
  const dir = qtyChange > 0 ? '加仓' : qtyChange < 0 ? '减仓' : '不变';
  return `${sideZh}${dir}${Math.abs(qtyChange) > 0 ? ' ' + Math.abs(r2(qtyChange, 0)).toLocaleString() : ''}`;
}

/** Change in long/short position (qty) over ~`minutes`, from local snapshots. */
export function getChange(symbol: string, minutes: number): ChangeResult | { symbol: string; error: string } {
  const sym = normalizeSymbol(symbol);
  const now = Date.now();
  const rows = storage.smartMoneyHistory(sym, now - minutes * 60_000 - 90_000);
  if (rows.length < 2) {
    return { symbol: sym, error: `not enough local history for ${sym} in the last ${minutes}m (need ≥2 snapshots). Run smart-money-tick (with ${sym} in the watchlist) and let it accumulate.` };
  }
  const from = rows[0]!;
  const to = rows[rows.length - 1]!;
  const { long, short } = computeChange(from, to);
  return {
    symbol: sym,
    fromTs: from.ts, toTs: to.ts,
    spanMinutes: Math.round((to.ts - from.ts) / 60_000),
    samples: rows.length,
    long, short,
    verdict: `${word(long.qtyChange, '多头')}，${word(short.qtyChange, '空头')}`,
  };
}

export interface ExtremeEntry {
  symbol: string; longShortRatio: number;
  longProfitPct: number | null; shortProfitPct: number | null;
  longTraders: number; shortTraders: number; ageMin: number;
}

/** Market-wide long/short-imbalance scan from the latest snapshot of each symbol. */
export function scanExtreme(opts: { limit?: number; maxAgeMin?: number; minTraders?: number } = {}):
  { scanned: number; mostLong: ExtremeEntry[]; mostShort: ExtremeEntry[] } | { scanned: 0; error: string } {
  const limit = opts.limit ?? 10;
  const maxAgeMs = (opts.maxAgeMin ?? 180) * 60_000;
  const minTraders = opts.minTraders ?? 20;
  const now = Date.now();
  const rows = storage.latestSmartMoney().filter(
    (row) => now - row.ts <= maxAgeMs
      && (row.longTraders + row.shortTraders) >= minTraders
      && row.longShortRatio > 0,
  );
  if (!rows.length) {
    return { scanned: 0, error: 'no fresh local snapshots — run smart-money-tick to populate the DB first (or widen maxAgeMin).' };
  }
  const map = (row: SmartMoneyHistoryRow): ExtremeEntry => ({
    symbol: row.symbol ?? '',
    longShortRatio: r2(row.longShortRatio, 4),
    longProfitPct: row.longTraders ? Math.round((row.longProfitTraders / row.longTraders) * 100) : null,
    shortProfitPct: row.shortTraders ? Math.round((row.shortProfitTraders / row.shortTraders) * 100) : null,
    longTraders: row.longTraders, shortTraders: row.shortTraders,
    ageMin: Math.round((now - row.ts) / 60_000),
  });
  const sorted = [...rows].sort((a, b) => b.longShortRatio - a.longShortRatio);
  // mostLong (top of the sort) and mostShort (bottom) must NEVER share a symbol.
  // `slice(-limit)` overlaps `slice(0,limit)` whenever rows.length <= 2*limit (the
  // usual case: watchlist ~11-19, default limit 10). Cut mostShort to start after
  // whatever mostLong already claimed. (Tiny DB → mostShort empty, acceptable.)
  const longCut = Math.min(limit, sorted.length);
  const mostLong = sorted.slice(0, longCut).map(map);                            // highest LSR = most long-heavy
  const mostShort = sorted.slice(Math.max(longCut, sorted.length - limit)).reverse().map(map); // lowest LSR = most short-heavy
  return {
    scanned: rows.length,
    mostLong,
    mostShort,
  };
}
