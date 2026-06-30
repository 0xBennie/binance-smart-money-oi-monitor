// Binance Smart Signal (Smart Money) overview client.
// Endpoint: /bapi/futures/v1/public/future/smart-money/signal/overview
//
// 17 fields including longWhalesAvgEntryPrice / longProfitTraders / longProfitWhales
// that the public fapi/data API does NOT expose. This is a binance.com internal
// web API with no official documentation; URL discovered via GitHub reverse
// engineering (see README credits).
//
// Rate limit: web bapi has no published weight. Empirically more sensitive than
// fapi. Use ≥12s spacing + ±3s jitter + 60-min cron + full circuit-breaker.

import {
  binanceHttp,
  isBinanceApiBlocked,
  markBinanceApiBlockedWithRetry,
  detectBinanceBlockDetails,
  updateBinanceUsedWeight,
  waitForBinanceWeightHeadroom,
} from './binance-rate-limit';

const SMART_MONEY_URL =
  'https://www.binance.com/bapi/futures/v1/public/future/smart-money/signal/overview';
const CACHE_TTL_MS = 10 * 60_000;
const REQ_TIMEOUT_MS = 8_000;

// Browser-style headers to look like a normal web client
const REQ_HEADERS = {
  accept: 'application/json',
  'accept-language': 'zh-CN,zh;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  clienttype: 'web',
  lang: 'zh-CN',
};

export interface SmartMoneyOverview {
  symbol: string;
  ts: number;                          // capture time (ms, Date.now() at fetch)
  signalDay: number;                   // Binance's `updateTime` — the daily signal-cohort
                                       // marker. It only advances once per UTC day and is
                                       // shared across all symbols, so it must NOT be used as
                                       // the snapshot timestamp (the position numbers below
                                       // refresh minute-to-minute under the same signalDay).
  totalPositions: number;
  totalTraders: number;
  longShortRatio: number;              // = longTraders / shortTraders
  // All traders
  longTraders: number;
  longTradersQty: number;
  longTradersAvgEntryPrice: number;
  shortTraders: number;
  shortTradersQty: number;
  shortTradersAvgEntryPrice: number;
  // Whales (top 20% margin balance)
  longWhales: number;
  longWhalesQty: number;
  longWhalesAvgEntryPrice: number;     // ★ not in public fapi
  shortWhales: number;
  shortWhalesQty: number;
  shortWhalesAvgEntryPrice: number;    // ★
  // Currently in-profit counts
  longProfitTraders: number;           // ★
  shortProfitTraders: number;          // ★
  longProfitWhales: number;            // ★
  shortProfitWhales: number;           // ★
}

interface CachedOverview { snap: SmartMoneyOverview; fetchedAt: number; }
const cache = new Map<string, CachedOverview>();

function parse(symbol: string, raw: any): SmartMoneyOverview | null {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v: any): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    symbol,
    ts: Date.now(),                       // capture time — see field doc above
    signalDay: Number(raw.updateTime ?? 0),
    totalPositions: num(raw.totalPositions),
    totalTraders: parseInt(raw.totalTraders, 10) || 0,
    longShortRatio: num(raw.longShortRatio),
    longTraders: parseInt(raw.longTraders, 10) || 0,
    longTradersQty: num(raw.longTradersQty),
    longTradersAvgEntryPrice: num(raw.longTradersAvgEntryPrice),
    shortTraders: parseInt(raw.shortTraders, 10) || 0,
    shortTradersQty: num(raw.shortTradersQty),
    shortTradersAvgEntryPrice: num(raw.shortTradersAvgEntryPrice),
    longWhales: parseInt(raw.longWhales, 10) || 0,
    longWhalesQty: num(raw.longWhalesQty),
    longWhalesAvgEntryPrice: num(raw.longWhalesAvgEntryPrice),
    shortWhales: parseInt(raw.shortWhales, 10) || 0,
    shortWhalesQty: num(raw.shortWhalesQty),
    shortWhalesAvgEntryPrice: num(raw.shortWhalesAvgEntryPrice),
    longProfitTraders: parseInt(raw.longProfitTraders, 10) || 0,
    shortProfitTraders: parseInt(raw.shortProfitTraders, 10) || 0,
    longProfitWhales: parseInt(raw.longProfitWhales, 10) || 0,
    shortProfitWhales: parseInt(raw.shortProfitWhales, 10) || 0,
  };
}

export async function getSmartMoneyOverview(
  symbol: string
): Promise<SmartMoneyOverview | null> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.snap;

  if (isBinanceApiBlocked()) return cached?.snap ?? null;

  await waitForBinanceWeightHeadroom();

  try {
    const resp = await binanceHttp.get(SMART_MONEY_URL, {
      params: { symbol },
      headers: REQ_HEADERS,
      timeout: REQ_TIMEOUT_MS,
    });
    updateBinanceUsedWeight(resp.headers['x-mbx-used-weight-1m'] as string | undefined);
    const data = resp.data;
    if (data?.code !== '000000' || !data?.data) return cached?.snap ?? null;
    const snap = parse(symbol, data.data);
    if (!snap) return cached?.snap ?? null;
    cache.set(symbol, { snap, fetchedAt: Date.now() });
    return snap;
  } catch (error) {
    const { sev, retryAfterSec } = detectBinanceBlockDetails(error);
    if (sev) markBinanceApiBlockedWithRetry(sev, retryAfterSec);
    return cached?.snap ?? null;
  }
}

/**
 * Compute Smart Money's notional position value in USD.
 *
 * Why this exists: binance's `totalPositions` field is undocumented and its
 * unit is inconsistent across symbols (sometimes base-coin units, sometimes
 * USD). Don't use it for math.
 *
 * Instead, derive USD notional from fields with known units:
 *   long_USD  = longTradersQty (base-coin) × longTradersAvgEntryPrice (USD)
 *   short_USD = shortTradersQty × shortTradersAvgEntryPrice
 *   total_USD = long_USD + short_USD
 *
 * This is the long-side + short-side gross notional, which is what you compare
 * against `openInterestHist.sumOpenInterestValue` (also gross notional in USD).
 */
// Only the four qty/avg-entry fields are needed — accept any object that has
// them (a full SmartMoneyOverview, or a row read back from the DB) so callers
// don't have to reconstruct the whole 17-field shape just to do the math.
type NotionalFields = Pick<
  SmartMoneyOverview,
  'longTradersQty' | 'longTradersAvgEntryPrice' | 'shortTradersQty' | 'shortTradersAvgEntryPrice'
>;

export function smartMoneyNotionalUsd(sm: NotionalFields): number {
  const long = sm.longTradersQty * sm.longTradersAvgEntryPrice;
  const short = sm.shortTradersQty * sm.shortTradersAvgEntryPrice;
  return long + short;
}

/**
 * Smart Money's share of total market Open Interest (0..1).
 * Returns null if OI snapshot is missing or invalid.
 *
 * Interpretation:
 *   < 0.05  : SM is a small player, signals lag the broader market
 *   0.05–0.20 : typical for liquid majors
 *   > 0.30  : SM dominates the orderbook, price discovery follows SM positioning
 */
export function smartMoneyShareOfOI(
  sm: NotionalFields,
  oiNowUsd: number | null | undefined
): number | null {
  if (!oiNowUsd || oiNowUsd <= 0) return null;
  const smUsd = smartMoneyNotionalUsd(sm);
  if (!Number.isFinite(smUsd) || smUsd <= 0) return null;
  return smUsd / oiNowUsd;
}

/**
 * Batch (cron use): serial + spacing + jitter, abort immediately on circuit-break.
 * 12s spacing × ±3s jitter is the empirical safe rate for web bapi.
 *
 * `onResult` fires as each symbol's snapshot lands, so callers can persist
 * incrementally. A full ~500-symbol pull takes ~100 min; writing only after the
 * whole batch resolves means a crash or 418 mid-run discards everything captured
 * so far. Stream each row to storage instead.
 */
export async function getSmartMoneyOverviewBatch(
  symbols: string[],
  spacingMs = 12_000,
  jitterMs = 3_000,
  onResult?: (symbol: string, snap: SmartMoneyOverview) => void
): Promise<Map<string, SmartMoneyOverview>> {
  const out = new Map<string, SmartMoneyOverview>();
  for (const sym of symbols) {
    if (isBinanceApiBlocked()) {
      console.warn(`[smart-money-batch] aborted at ${out.size}/${symbols.length} due to global block`);
      break;
    }
    const s = await getSmartMoneyOverview(sym);
    if (s) {
      out.set(sym, s);
      if (onResult) {
        try { onResult(sym, s); } catch (e) { console.warn(`[smart-money-batch] onResult(${sym}) failed:`, e); }
      }
    }
    if (spacingMs > 0) {
      const jitter = jitterMs ? (Math.random() * 2 - 1) * jitterMs : 0;
      await new Promise(r => setTimeout(r, Math.max(0, spacingMs + jitter)));
    }
  }
  return out;
}
