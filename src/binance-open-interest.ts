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
  oiNowUsd: number;            // sumOpenInterestValue, USD notional (contracts × mark price)
  oiNowCoins: number;          // sumOpenInterest, base-asset units (open contracts)
  // oiChg* = % change in open CONTRACTS (sumOpenInterest / position quantity),
  // NOT USD notional. Measuring velocity in coins decouples it from price: a pure
  // price move with flat open contracts registers as ~0 change, which is the point —
  // Open Interest is a position quantity, so its rate-of-change belongs in coins.
  /** % change in open contracts vs ~5min ago. null = history bar missing, NOT zero change. */
  oiChg5m: number | null;
  /** % change in open contracts vs ~15min ago. null = history bar missing, NOT zero change. */
  oiChg15m: number | null;
  /** % change in open contracts vs ~1h ago. null = history bar missing, NOT zero change. */
  oiChg1h: number | null;
  /** % change in open contracts vs ~4h ago (47 × 5min bars back). null = history bar missing. */
  oiChg4h: number | null;
}

import { capSet } from './cache.js';

interface CachedOI { snap: OpenInterestSnapshot; fetchedAt: number; }
const cache = new Map<string, CachedOI>();

/** Minimal shape of a Binance openInterestHist bar (ascending by timestamp). */
export interface OiHistBar {
  sumOpenInterest: string;       // coins / open contracts
  sumOpenInterestValue: string;  // USD notional (contracts × mark price)
}

interface HistBar extends OiHistBar {
  symbol: string;
  timestamp: number;
}

/** The four OI velocities, each null when its reference bar is absent/invalid. */
export interface OiChanges {
  oiChg5m: number | null;
  oiChg15m: number | null;
  oiChg1h: number | null;
  oiChg4h: number | null;
}

/** Returns null when prev is missing/invalid — caller should NOT substitute 0. */
function pctChange(curr: number, prev: number | null): number | null {
  if (prev == null || !Number.isFinite(prev) || prev <= 0) return null;
  if (!Number.isFinite(curr)) return null;
  return ((curr - prev) / prev) * 100;
}

/**
 * Compute the 5m/15m/1h/4h OI velocities from the COINS series (sumOpenInterest),
 * NOT the USD notional series. Bars are ascending by timestamp (latest last).
 * Reference bars at -1 (~5m ago), -3 (~15m ago), -12 (~1h ago), -47 (~4h ago).
 * Each field is null when the reference bar is absent/invalid (never substitute 0);
 * this is the same null-on-missing-bar semantics as pctChange.
 */
export function computeOiChanges(bars: readonly OiHistBar[]): OiChanges {
  const coins = bars.map(b => parseFloat(b.sumOpenInterest));
  const n = coins.length;
  const curr = n > 0 ? coins[n - 1] : NaN;
  const ref = (idxFromEnd: number): number | null => {
    const i = n - 1 - idxFromEnd;
    if (i < 0) return null;
    const v = coins[i];
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  return {
    oiChg5m: pctChange(curr, ref(1)),
    oiChg15m: pctChange(curr, ref(3)),
    oiChg1h: pctChange(curr, ref(12)),
    oiChg4h: pctChange(curr, ref(47)),
  };
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

    // Velocities are computed from the COINS series (open contracts), not USD
    // notional, so a pure price move with flat contracts reads as ~0 change.
    const changes = computeOiChanges(data);

    const snap: OpenInterestSnapshot = {
      symbol,
      ts: Number(latest.timestamp ?? Date.now()),
      oiNowUsd,
      oiNowCoins,
      ...changes,
    };
    capSet(cache, symbol, { snap, fetchedAt: Date.now() });
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
