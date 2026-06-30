// Binance Futures Open Interest client.
//
// Endpoint: /futures/data/openInterestHist  (NOT /fapi/v1/openInterest)
//   - fapi/v1/openInterest is weight=1 but bucketed in the fapi/v1 ban group,
//     which gets nuked quickly during 418/-1003 events
//   - futures/data/openInterestHist is weight=1, lives in a separate ban
//     bucket, and bonus: returns BOTH current value AND history in one call
//
// By requesting `period=5m&limit=48` we get a 4-hour OI window in a single
// request, then compute 5m/15m/1h/4h velocities client-side. One API call
// per symbol, ~1s spacing, ~500 symbols ≈ 8 minutes.

import {
  binanceHttp,
  isBinanceApiBlocked,
  markBinanceApiBlockedWithRetry,
  detectBinanceBlockDetails,
  updateBinanceUsedWeight,
  waitForBinanceWeightHeadroom,
} from './binance-rate-limit.js';

const OI_HIST_URL = 'https://fapi.binance.com/futures/data/openInterestHist';
const CACHE_TTL_MS = 5 * 60_000;
const REQ_TIMEOUT_MS = 5_000;

export interface OpenInterestSnapshot {
  symbol: string;
  ts: number;
  oiNowUsd: number;            // sumOpenInterestValue, USD
  oiNowCoins: number;          // sumOpenInterest, base-asset units
  /** % change vs ~5min ago. null = history bar missing, NOT zero change. */
  oiChg5m: number | null;
  oiChg15m: number | null;
  oiChg1h: number | null;
  oiChg4h: number | null;      // 4h = 47 × 5min bars back
}

interface CachedOI { snap: OpenInterestSnapshot; fetchedAt: number; }
const cache = new Map<string, CachedOI>();

interface HistBar {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
}

/** Returns null when prev is missing/invalid — caller should NOT substitute 0. */
function pctChange(curr: number, prev: number | null): number | null {
  if (prev == null || !Number.isFinite(prev) || prev <= 0) return null;
  if (!Number.isFinite(curr)) return null;
  return ((curr - prev) / prev) * 100;
}

export async function getOpenInterest(symbol: string): Promise<OpenInterestSnapshot | null> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.snap;

  if (isBinanceApiBlocked()) return cached?.snap ?? null;
  await waitForBinanceWeightHeadroom();

  try {
    const resp = await binanceHttp.get(OI_HIST_URL, {
      params: { symbol, period: '5m', limit: 48 },  // 48 × 5min = 4h
      timeout: REQ_TIMEOUT_MS,
    });
    updateBinanceUsedWeight(resp.headers['x-mbx-used-weight-1m'] as string | undefined);

    const data = resp.data as HistBar[];
    if (!Array.isArray(data) || data.length === 0) return cached?.snap ?? null;

    // Bars are ascending by timestamp; latest is data[length-1]
    const latest = data[data.length - 1];
    if (!latest) return cached?.snap ?? null;
    const oiNowUsd = parseFloat(latest.sumOpenInterestValue);
    const oiNowCoins = parseFloat(latest.sumOpenInterest);
    if (!Number.isFinite(oiNowUsd) || oiNowUsd <= 0) return cached?.snap ?? null;

    // Reference bars at -1 (5m ago), -3 (15m ago), -12 (1h ago), -47 (~4h ago)
    const refUsd = (idxFromEnd: number): number | null => {
      const i = data.length - 1 - idxFromEnd;
      if (i < 0) return null;
      const bar = data[i];
      if (!bar) return null;
      const v = parseFloat(bar.sumOpenInterestValue);
      return Number.isFinite(v) && v > 0 ? v : null;
    };

    const snap: OpenInterestSnapshot = {
      symbol,
      ts: Number(latest.timestamp ?? Date.now()),
      oiNowUsd,
      oiNowCoins,
      // pass refUsd() result through unchanged — pctChange returns null on missing
      oiChg5m: pctChange(oiNowUsd, refUsd(1)),
      oiChg15m: pctChange(oiNowUsd, refUsd(3)),
      oiChg1h: pctChange(oiNowUsd, refUsd(12)),
      oiChg4h: pctChange(oiNowUsd, refUsd(47)),
    };
    cache.set(symbol, { snap, fetchedAt: Date.now() });
    return snap;
  } catch (error) {
    const { sev, retryAfterSec } = detectBinanceBlockDetails(error);
    if (sev) markBinanceApiBlockedWithRetry(sev, retryAfterSec);
    return cached?.snap ?? null;
  }
}

/**
 * Batch (cron use): serial + spacing + jitter. fapi/futures/data is permissive
 * but still rate-limited, so 1s ± 200ms keeps a ~1 req/s cadence.
 */
export async function getOpenInterestBatch(
  symbols: string[],
  spacingMs = 1_000,
  jitterMs = 200
): Promise<Map<string, OpenInterestSnapshot>> {
  const out = new Map<string, OpenInterestSnapshot>();
  for (const sym of symbols) {
    if (isBinanceApiBlocked()) {
      console.warn(`[oi-batch] aborted at ${out.size}/${symbols.length} due to global block`);
      break;
    }
    const s = await getOpenInterest(sym);
    if (s) out.set(sym, s);
    if (spacingMs > 0) {
      const jitter = jitterMs ? (Math.random() * 2 - 1) * jitterMs : 0;
      await new Promise(r => setTimeout(r, Math.max(0, spacingMs + jitter)));
    }
  }
  return out;
}
