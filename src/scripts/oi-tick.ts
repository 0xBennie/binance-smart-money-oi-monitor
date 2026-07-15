/**
 * Open Interest snapshot cron entry point.
 *
 * Usage:
 *   tsx src/scripts/oi-tick.ts
 *
 * Env vars (all optional):
 *   OI_POOL_MAX     hard cap on symbols (default 0 = unlimited / all)
 *   OI_SHARD_INDEX  0-based shard (default 0)
 *   OI_SHARD_TOTAL  total shards (default 1 = no sharding)
 *
 * Pulls one openInterestHist call per symbol (5m × 48 bars = 4h window).
 * 1 req/sec spacing → ~500 symbols in ~8 min. Cron every 30 min.
 *
 * Bonus design: combining with top-trader-tick lets you compute
 * "Smart Money's share of total market OI" — see dashboard for the join.
 */
import 'dotenv/config';
import { storage } from '../storage.js';
import { getOpenInterestBatch } from '../binance-open-interest.js';
import { preflightBinanceFapi, binanceHttp } from '../binance-rate-limit.js';
import { getUsdtPerpetuals } from '../symbol-list.js';
import { installGracefulShutdown } from '../cron-utils.js';

const POOL_MAX    = parseInt(process.env.OI_POOL_MAX    || '0', 10);
const SHARD_INDEX = parseInt(process.env.OI_SHARD_INDEX || '0', 10);
const SHARD_TOTAL = Math.max(1, parseInt(process.env.OI_SHARD_TOTAL || '1', 10));

async function main(): Promise<void> {
  installGracefulShutdown('oi-tick');
  const startedAt = Date.now();

  storage.init();

  const healthy = await preflightBinanceFapi();
  if (!healthy) {
    console.log('[oi-tick] preflight failed, abort');
    storage.stop();
    return;
  }

  const pool = await getUsdtPerpetuals(binanceHttp, { poolMax: POOL_MAX, shardIndex: SHARD_INDEX, shardTotal: SHARD_TOTAL });
  if (pool.length === 0) {
    console.log('[oi-tick] no symbols, skip');
    storage.stop();
    return;
  }

  const shardTag = SHARD_TOTAL > 1 ? ` shard=${SHARD_INDEX}/${SHARD_TOTAL}` : '';
  console.log(
    `[oi-tick] start pool=${pool.length}${shardTag} ` +
    `(1s±200ms jitter → eta ~${pool.length}s)`
  );

  const snapshots = await getOpenInterestBatch(pool, 1_000, 200);

  let written = 0;
  for (const snap of snapshots.values()) {
    storage.recordOI(snap);
    written++;
  }

  const elapsedS = (Date.now() - startedAt) / 1000;
  console.log(
    `[oi-tick] done${shardTag} requested=${pool.length} captured=${snapshots.size} ` +
    `written=${written} elapsed=${elapsedS.toFixed(1)}s`
  );

  storage.stop();
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('[oi-tick] fatal:', e);
    process.exit(1);
  });
