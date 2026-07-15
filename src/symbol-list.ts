// Shared "all TRADING USDT-PERPETUAL symbols" resolver for the three tick scripts
// (smart-money / oi / top-trader). Previously each had its own copy — two of them
// used a bare `axios.get(exchangeInfo)`, bypassing the shared keep-alive pool, the
// used-weight accounting, and the 6h cache that smart-money-tick got in 1.9.2. Now
// all three ride the SAME binanceHttp pool + updateBinanceUsedWeight + TTL cache.

import type { AxiosInstance } from 'axios';
import { updateBinanceUsedWeight } from './binance-rate-limit.js';

const EXCHANGE_INFO_URL = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
// The set of TRADING USDT perps changes slowly; a 6h TTL avoids re-downloading the
// whole exchangeInfo payload every sweep in a long-lived daemon.
const EXCHANGE_INFO_TTL_MS = 6 * 3_600_000;

// Cache the FULL sorted list; sharding/cap is applied per-read so different callers
// (each with its own POOL_MAX / shard env) share one cached fetch.
let cached: { symbols: string[]; at: number } | null = null;

export interface PoolOpts {
  poolMax?: number;     // hard cap on symbols (0 = unlimited)
  shardIndex?: number;  // 0-based shard
  shardTotal?: number;  // total shards (1 = no sharding)
}

/** Apply POOL_MAX slice then round-robin shard (cap first, matching prior behavior). */
function applyShard(list: string[], poolMax: number, shardIndex: number, shardTotal: number): string[] {
  let out = list;
  if (poolMax > 0) out = out.slice(0, poolMax);
  if (shardTotal > 1) out = out.filter((_, i) => i % shardTotal === shardIndex);
  return out;
}

/** All TRADING USDT-PERPETUAL symbols (sorted), via the shared keep-alive pool +
 * weight accounting + 6h cache. Returns [] on failure (caller decides to skip). */
export async function getUsdtPerpetuals(http: AxiosInstance, opts: PoolOpts = {}): Promise<string[]> {
  const poolMax = opts.poolMax ?? 0;
  const shardIndex = opts.shardIndex ?? 0;
  const shardTotal = Math.max(1, opts.shardTotal ?? 1);

  if (cached && Date.now() - cached.at < EXCHANGE_INFO_TTL_MS) {
    return applyShard(cached.symbols, poolMax, shardIndex, shardTotal);
  }
  try {
    const exInfo = await http.get(EXCHANGE_INFO_URL, { timeout: 10_000 });
    updateBinanceUsedWeight(exInfo.headers['x-mbx-used-weight-1m'] as string | undefined);
    const list: string[] = (exInfo.data.symbols || [])
      .filter((s: any) =>
        s.status === 'TRADING' &&
        s.contractType === 'PERPETUAL' &&
        s.quoteAsset === 'USDT'
      )
      .map((s: any) => s.symbol as string)
      .sort();
    if (list.length) cached = { symbols: list, at: Date.now() };   // don't cache an empty/garbage payload
    return applyShard(list, poolMax, shardIndex, shardTotal);
  } catch (e: any) {
    console.warn(`[symbol-list] exchangeInfo failed (${e?.response?.status || e.message})`);
    return [];
  }
}
