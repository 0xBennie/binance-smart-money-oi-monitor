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
const FUNDING_INFO_URL = 'https://fapi.binance.com/fapi/v1/fundingInfo';
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
import { capSet } from './cache.js';

const tickerCache = new Map<string, CachedTicker>();
const fundingCache = new Map<string, CachedFunding>();

// Funding interval (hours) per symbol. /fapi/v1/fundingInfo lists ONLY symbols
// whose interval/caps differ from the 8h default, so we cache the whole map once
// and treat any symbol not in it as the standard 8h. Getting this wrong makes the
// annualized funding off by 2×/8× for 4h/1h symbols.
let _intervalMap: Map<string, number> | null = null;
let _intervalFetchedAt = 0;
const INTERVAL_TTL_MS = 60 * 60_000;   // 1h — funding intervals rarely change

export async function getFundingIntervalHours(symbol: string): Promise<number> {
  const now = Date.now();
  if (_intervalMap && now - _intervalFetchedAt < INTERVAL_TTL_MS) {
    return _intervalMap.get(symbol) ?? 8;
  }
  if (isBinanceApiBlocked()) return _intervalMap?.get(symbol) ?? 8;
  try {
    await waitForBinanceWeightHeadroom();
    const resp = await binanceHttp.get(FUNDING_INFO_URL, { timeout: REQ_TIMEOUT_MS });
    updateBinanceUsedWeight(resp.headers['x-mbx-used-weight-1m'] as string | undefined);
    if (Array.isArray(resp.data)) {
      const map = new Map<string, number>();
      for (const it of resp.data) {
        const h = parseInt(it?.fundingIntervalHours, 10);
        if (it?.symbol && Number.isFinite(h) && h > 0) map.set(it.symbol, h);
      }
      _intervalMap = map;
      _intervalFetchedAt = now;
      return map.get(symbol) ?? 8;
    }
  } catch (error) {
    const { sev, retryAfterSec } = detectBinanceBlockDetails(error);
    if (sev) markBinanceApiBlockedWithRetry(sev, retryAfterSec);
  }
  return _intervalMap?.get(symbol) ?? 8;   // default 8h (standard) on any failure
}

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
    const lastPrice = parseFloat(d.lastPrice);
    // Drop a malformed payload rather than caching/returning a NaN price
    // (a NaN price silently fabricates PNL/state downstream, e.g. in the panel).
    if (!Number.isFinite(lastPrice)) return cached?.snap ?? null;
    const snap: TickerInfo = {
      symbol: d.symbol,
      ts: Date.now(),
      lastPrice,
      priceChangePct24h: parseFloat(d.priceChangePercent),
      quoteVolume24hUsd: parseFloat(d.quoteVolume),
    };
    capSet(tickerCache, symbol, { snap, fetchedAt: Date.now() });
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
    capSet(fundingCache, symbol, { snap, fetchedAt: Date.now() });
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
