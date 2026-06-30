// Binance fapi/v1 ticker + funding-rate client.
//
// Pulls /fapi/v1/ticker/24hr and /fapi/v1/premiumIndex per-symbol (weight=1
// each when symbol is specified — DO NOT call them without `symbol`, that
// becomes weight=40 and is a fast track to 418/-1003).
//
// These live in the /fapi/v1/* bucket, which empirically gets banned harder
// than /futures/data/*. Use sparingly (per-symbol on demand, not in a tight
// scan loop) and let the shared circuit breaker do its job.

import {
  binanceHttp,
  isBinanceApiBlocked,
  markBinanceApiBlockedWithRetry,
  detectBinanceBlockDetails,
  updateBinanceUsedWeight,
  waitForBinanceWeightHeadroom,
} from './binance-rate-limit.js';

const TICKER_24H_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
const PREMIUM_INDEX_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex';
const REQ_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60_000;  // 1 min cache — ticker/funding don't move that fast

export interface TickerInfo {
  symbol: string;
  ts: number;
  lastPrice: number;
  priceChangePct24h: number;   // already in %, e.g. +19.14
  quoteVolume24hUsd: number;
}

export interface FundingInfo {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number;     // decimal, e.g. 0.0001 = 0.01%
  nextFundingTime: number;     // ms
}

interface CachedTicker { snap: TickerInfo; fetchedAt: number; }
interface CachedFunding { snap: FundingInfo; fetchedAt: number; }
const tickerCache = new Map<string, CachedTicker>();
const fundingCache = new Map<string, CachedFunding>();

export async function getTicker24h(symbol: string): Promise<TickerInfo | null> {
  const cached = tickerCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.snap;
  if (isBinanceApiBlocked()) return cached?.snap ?? null;
  await waitForBinanceWeightHeadroom();

  try {
    const resp = await binanceHttp.get(TICKER_24H_URL, {
      params: { symbol },
      timeout: REQ_TIMEOUT_MS,
    });
    updateBinanceUsedWeight(resp.headers['x-mbx-used-weight-1m'] as string | undefined);
    const d = resp.data;
    if (!d?.symbol) return cached?.snap ?? null;
    const snap: TickerInfo = {
      symbol: d.symbol,
      ts: Date.now(),
      lastPrice: parseFloat(d.lastPrice),
      priceChangePct24h: parseFloat(d.priceChangePercent),
      quoteVolume24hUsd: parseFloat(d.quoteVolume),
    };
    tickerCache.set(symbol, { snap, fetchedAt: Date.now() });
    return snap;
  } catch (error) {
    const { sev, retryAfterSec } = detectBinanceBlockDetails(error);
    if (sev) markBinanceApiBlockedWithRetry(sev, retryAfterSec);
    return cached?.snap ?? null;
  }
}

export async function getFundingInfo(symbol: string): Promise<FundingInfo | null> {
  const cached = fundingCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.snap;
  if (isBinanceApiBlocked()) return cached?.snap ?? null;
  await waitForBinanceWeightHeadroom();

  try {
    const resp = await binanceHttp.get(PREMIUM_INDEX_URL, {
      params: { symbol },
      timeout: REQ_TIMEOUT_MS,
    });
    updateBinanceUsedWeight(resp.headers['x-mbx-used-weight-1m'] as string | undefined);
    const d = resp.data;
    if (!d?.symbol) return cached?.snap ?? null;
    const snap: FundingInfo = {
      symbol: d.symbol,
      markPrice: parseFloat(d.markPrice),
      indexPrice: parseFloat(d.indexPrice),
      lastFundingRate: parseFloat(d.lastFundingRate),
      nextFundingTime: Number(d.nextFundingTime),
    };
    fundingCache.set(symbol, { snap, fetchedAt: Date.now() });
    return snap;
  } catch (error) {
    const { sev, retryAfterSec } = detectBinanceBlockDetails(error);
    if (sev) markBinanceApiBlockedWithRetry(sev, retryAfterSec);
    return cached?.snap ?? null;
  }
}

/**
 * "00:27:08" countdown to next funding settlement, given the nextFundingTime
 * from getFundingInfo(). Returns "—" if past or invalid.
 */
export function fundingCountdownString(nextFundingTime: number): string {
  const ms = nextFundingTime - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
