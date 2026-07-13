// Time-series reads over the local snapshot DB: how much each side ADDED/REDUCED
// over a window, and a market-wide long/short-imbalance scan. All position deltas
// use qty (contract count), NOT USD notional — notional moves with price and would
// mistake a price move for a position change.
import { storage, type SmartMoneyHistoryRow } from './storage.js';
import { normalizeSymbol } from './symbol.js';

const r2 = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

export interface QtyDelta {
  fromQty: number; toQty: number;
  qtyChange: number;          // >0 added, <0 reduced (contracts)
  qtyChangePct: number | null;
}

export interface SideChange {
  fromQty: number; toQty: number;
  qtyChange: number;          // >0 added, <0 reduced (contracts) — ALL smart-money traders
  qtyChangePct: number | null;
  fromAvg: number; toAvg: number;
  whaleAvg: number;           // latest 庄家(鲸鱼)均价 for this side — compare vs `price`
  whale: QtyDelta;            // 庄家(鲸鱼)-only 张数变化 — "看庄家在加还是减"
}

export interface ChangeResult {
  symbol: string; fromTs: number; toTs: number; spanMinutes: number; samples: number;
  price: number | null;       // latest mark price → 现价 vs 庄家均价 浮盈/浮亏
  long: SideChange; short: SideChange;
  verdict: string;
}

/** Pure: per-side delta between two snapshots. */
export function computeChange(from: SmartMoneyHistoryRow, to: SmartMoneyHistoryRow): { long: SideChange; short: SideChange } {
  const delta = (fq: number, tq: number): QtyDelta => ({
    fromQty: fq, toQty: tq,
    qtyChange: tq - fq,
    qtyChangePct: fq > 0 ? r2(((tq - fq) / fq) * 100) : null,
  });
  const side = (fq: number, tq: number, fa: number, ta: number, wAvg: number, wfq: number, wtq: number): SideChange => ({
    ...delta(fq, tq),
    fromAvg: fa, toAvg: ta,
    whaleAvg: wAvg,
    whale: delta(wfq, wtq),
  });
  return {
    long: side(from.longQty, to.longQty, from.longAvg, to.longAvg, to.longWhaleAvg, from.longWhalesQty, to.longWhalesQty),
    short: side(from.shortQty, to.shortQty, from.shortAvg, to.shortAvg, to.shortWhaleAvg, from.shortWhalesQty, to.shortWhalesQty),
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
    price: to.price ?? null,
    long, short,
    verdict: `${word(long.qtyChange, '多头')}，${word(short.qtyChange, '空头')}`,
  };
}

export interface ProfitSideTrend {
  fromPct: number | null; toPct: number | null; change: number | null;         // % of traders in profit
  whaleFromPct: number | null; whaleToPct: number | null; whaleChange: number | null; // % of whales in profit
}
export interface ProfitTrend {
  symbol: string; fromTs: number; toTs: number; spanMinutes: number; samples: number;
  long: ProfitSideTrend; short: ProfitSideTrend;
  verdict: string;
}

/** How the "% in profit" of each side (traders + whales) moved over `minutes`.
 * A side flipping from mostly-losing to mostly-winning (or vice-versa) is a
 * meaningful shift the raw qty deltas don't show. */
export function getProfitTrend(symbol: string, minutes: number): ProfitTrend | { symbol: string; error: string } {
  const sym = normalizeSymbol(symbol);
  const rows = storage.smartMoneyHistory(sym, Date.now() - minutes * 60_000 - 90_000);
  if (rows.length < 2) {
    return { symbol: sym, error: `not enough local history for ${sym} in the last ${minutes}m (need ≥2 snapshots).` };
  }
  const from = rows[0]!, to = rows[rows.length - 1]!;
  const pct = (profit: number, total: number): number | null => (total > 0 ? Math.round((profit / total) * 100) : null);
  const chg = (a: number | null, b: number | null): number | null => (a != null && b != null ? b - a : null);
  const trend = (fp: number, ft: number, tp: number, tt: number, fwp: number, fw: number, twp: number, tw: number): ProfitSideTrend => {
    const fromPct = pct(fp, ft), toPct = pct(tp, tt), whaleFromPct = pct(fwp, fw), whaleToPct = pct(twp, tw);
    return { fromPct, toPct, change: chg(fromPct, toPct), whaleFromPct, whaleToPct, whaleChange: chg(whaleFromPct, whaleToPct) };
  };
  const long = trend(from.longProfitTraders, from.longTraders, to.longProfitTraders, to.longTraders,
    from.longProfitWhales, from.longWhales, to.longProfitWhales, to.longWhales);
  const short = trend(from.shortProfitTraders, from.shortTraders, to.shortProfitTraders, to.shortTraders,
    from.shortProfitWhales, from.shortWhales, to.shortProfitWhales, to.shortWhales);
  const w = (t: ProfitSideTrend, zh: string) =>
    t.fromPct == null || t.toPct == null ? `${zh}盈利占比 —` : `${zh}盈利占比 ${t.fromPct}%→${t.toPct}%`;
  return {
    symbol: sym, fromTs: from.ts, toTs: to.ts,
    spanMinutes: Math.round((to.ts - from.ts) / 60_000), samples: rows.length,
    long, short, verdict: `${w(long, '多头')}，${w(short, '空头')}`,
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
      // NOT `longShortRatio > 0`: a legit all-short symbol has 0 long traders → LSR 0,
      // and that is exactly the most-short case `mostShort` should surface. The
      // minTraders check above already drops no-data rows. Just require a finite ratio.
      && Number.isFinite(row.longShortRatio),
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
