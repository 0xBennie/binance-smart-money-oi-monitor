// Binance fapi/futures/data — public Top-Trader & Taker ratios.
// Same sample population (top 20% margin balance) as Smart Money's "whales",
// but reports ratios only (no AvgEntryPrice, no ProfitTraders count).
//
// Complements binance-smart-money.ts with Taker buy/sell ratio (overview lacks it).

import {
  binanceHttp,
  isBinanceApiBlocked,
  markBinanceApiBlockedWithRetry,
  detectBinanceBlockDetails,
  updateBinanceUsedWeight,
  waitForBinanceWeightHeadroom,
} from './binance-rate-limit.js';

export type TopTraderPeriod = '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d';

export interface TopTraderSnapshot {
  symbol: string;
  period: TopTraderPeriod;
  ts: number;
  // Top 20% accounts — by account count
  topAccountLongPct: number;
  topAccountShortPct: number;
  topAccountLSR: number;
  // Top 20% accounts — by position size (Smart Signal "whale position" equivalent)
  topPositionLongPct: number;
  topPositionShortPct: number;
  topPositionLSR: number;
  // Taker aggressor flow
  takerBuyVol: number;
  takerSellVol: number;
  takerBSR: number;
}

interface CachedSnap { snap: TopTraderSnapshot; fetchedAt: number; }
const FAPI = 'https://fapi.binance.com';
const CACHE_TTL_MS = 5 * 60_000;
const REQ_TIMEOUT_MS = 5_000;

const cache = new Map<string, CachedSnap>();
const cacheKey = (s: string, p: TopTraderPeriod) => `${s}|${p}`;

async function fetchOne(path: string, symbol: string, period: TopTraderPeriod): Promise<any | null> {
  try {
    const resp = await binanceHttp.get(`${FAPI}${path}`, {
      params: { symbol, period, limit: 1 },
      timeout: REQ_TIMEOUT_MS,
    });
    updateBinanceUsedWeight(resp.headers['x-mbx-used-weight-1m'] as string | undefined);
    if (!Array.isArray(resp.data) || resp.data.length === 0) return null;
    return resp.data[0];
  } catch (error) {
    const { sev, retryAfterSec } = detectBinanceBlockDetails(error);
    if (sev) markBinanceApiBlockedWithRetry(sev, retryAfterSec);
    return null;
  }
}

export async function getTopTraderSnapshot(
  symbol: string,
  period: TopTraderPeriod = '5m'
): Promise<TopTraderSnapshot | null> {
  const key = cacheKey(symbol, period);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.snap;

  if (isBinanceApiBlocked()) return cached?.snap ?? null;
  await waitForBinanceWeightHeadroom();

  const [acc, pos, taker] = await Promise.all([
    fetchOne('/futures/data/topLongShortAccountRatio', symbol, period),
    fetchOne('/futures/data/topLongShortPositionRatio', symbol, period),
    fetchOne('/futures/data/takerlongshortRatio', symbol, period),
  ]);

  if (!acc || !pos || !taker) return cached?.snap ?? null;

  // ⚠️ Binance reuses field names: topLongShortPositionRatio returns
  // `longAccount`/`shortAccount` which actually mean longPosition/shortPosition.
  const snap: TopTraderSnapshot = {
    symbol,
    period,
    ts: Number(taker.timestamp ?? pos.timestamp ?? acc.timestamp ?? Date.now()),
    topAccountLongPct: parseFloat(acc.longAccount),
    topAccountShortPct: parseFloat(acc.shortAccount),
    topAccountLSR: parseFloat(acc.longShortRatio),
    topPositionLongPct: parseFloat(pos.longAccount),
    topPositionShortPct: parseFloat(pos.shortAccount),
    topPositionLSR: parseFloat(pos.longShortRatio),
    takerBuyVol: parseFloat(taker.buyVol),
    takerSellVol: parseFloat(taker.sellVol),
    takerBSR: parseFloat(taker.buySellRatio),
  };

  // Drop a partial/garbage response rather than persisting NaN in the primary
  // fields (SQLite would silently store them as NULL).
  if (!Number.isFinite(snap.topPositionLSR) || !Number.isFinite(snap.takerBSR)) {
    return cached?.snap ?? null;
  }

  cache.set(key, { snap, fetchedAt: Date.now() });
  return snap;
}

export async function getTopTraderSnapshotsBatch(
  symbols: string[],
  period: TopTraderPeriod = '5m',
  spacingMs = 1_000,
  jitterMs = 200
): Promise<Map<string, TopTraderSnapshot>> {
  const out = new Map<string, TopTraderSnapshot>();
  for (const sym of symbols) {
    if (isBinanceApiBlocked()) {
      console.warn(`[top-trader-batch] aborted at ${out.size}/${symbols.length} due to global block`);
      break;
    }
    const s = await getTopTraderSnapshot(sym, period);
    if (s) out.set(sym, s);
    if (spacingMs > 0) {
      const jitter = jitterMs ? (Math.random() * 2 - 1) * jitterMs : 0;
      await new Promise(r => setTimeout(r, Math.max(0, spacingMs + jitter)));
    }
  }
  return out;
}
