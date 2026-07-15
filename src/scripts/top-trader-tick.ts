/**
 * Top-Trader snapshot cron entry point (fapi/futures/data).
 *
 * Usage:
 *   tsx src/scripts/top-trader-tick.ts [period=5m]
 *
 * Env vars (all optional):
 *   TOP_TRADER_POOL_MAX     hard cap on symbols (default 0 = unlimited / all)
 *   TOP_TRADER_SHARD_INDEX  0-based shard (default 0)
 *   TOP_TRADER_SHARD_TOTAL  total shards (default 1 = no sharding)
 *
 * Sizing reference (1s spacing × 3 API calls/symbol, no jitter applied to math):
 *   100 symbols ~  100s (1.7 min)
 *   300 symbols ~  300s (5 min)
 *   500 symbols ~  500s (8.3 min)
 *
 * Cron recommendations:
 *   - All symbols, every 30 min: `*\/30 * * * *`  (default, comfortably fits)
 *   - Sharding usually unnecessary for top-trader (fapi is faster than web bapi)
 */
import 'dotenv/config';
import { storage } from '../storage.js';
import { getTopTraderSnapshotsBatch, type TopTraderPeriod } from '../binance-top-trader.js';
import { preflightBinanceFapi, binanceHttp } from '../binance-rate-limit.js';
import { getUsdtPerpetuals } from '../symbol-list.js';
import { installGracefulShutdown } from '../cron-utils.js';

const POOL_MAX    = parseInt(process.env.TOP_TRADER_POOL_MAX    || '0', 10);
const SHARD_INDEX = parseInt(process.env.TOP_TRADER_SHARD_INDEX || '0', 10);
const SHARD_TOTAL = Math.max(1, parseInt(process.env.TOP_TRADER_SHARD_TOTAL || '1', 10));

const VALID_PERIODS = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'] as const;

function parsePeriod(arg: string | undefined): TopTraderPeriod {
  const p = (arg || '5m') as TopTraderPeriod;
  return (VALID_PERIODS as readonly string[]).includes(p) ? p : '5m';
}

async function main(): Promise<void> {
  installGracefulShutdown('top-trader-tick');
  const period = parsePeriod(process.argv[2]);
  const startedAt = Date.now();

  storage.init();

  const healthy = await preflightBinanceFapi();
  if (!healthy) {
    console.log('[top-trader-tick] preflight failed, abort');
    storage.stop();
    return;
  }

  const pool = await getUsdtPerpetuals(binanceHttp, { poolMax: POOL_MAX, shardIndex: SHARD_INDEX, shardTotal: SHARD_TOTAL });
  if (pool.length === 0) {
    console.log('[top-trader-tick] no symbols, skip');
    storage.stop();
    return;
  }

  const shardTag = SHARD_TOTAL > 1 ? ` shard=${SHARD_INDEX}/${SHARD_TOTAL}` : '';
  console.log(
    `[top-trader-tick] start period=${period} pool=${pool.length}${shardTag} ` +
    `(1s±200ms jitter × 3 endpoints → eta ~${pool.length}s)`
  );

  const snapshots = await getTopTraderSnapshotsBatch(pool, period, 1_000, 200);

  let written = 0;
  for (const snap of snapshots.values()) {
    storage.recordTopTrader({
      symbol: snap.symbol,
      ts: snap.ts,
      period: snap.period,
      topAccountLongPct: snap.topAccountLongPct,
      topAccountShortPct: snap.topAccountShortPct,
      topAccountLsr: snap.topAccountLSR,
      topPositionLongPct: snap.topPositionLongPct,
      topPositionShortPct: snap.topPositionShortPct,
      topPositionLsr: snap.topPositionLSR,
      takerBuyVol: snap.takerBuyVol,
      takerSellVol: snap.takerSellVol,
      takerBsr: snap.takerBSR,
    });
    written++;
  }

  const elapsedS = (Date.now() - startedAt) / 1000;
  console.log(
    `[top-trader-tick] done period=${period}${shardTag} requested=${pool.length} ` +
    `captured=${snapshots.size} written=${written} elapsed=${elapsedS.toFixed(1)}s`
  );

  storage.stop();
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('[top-trader-tick] fatal:', e);
    process.exit(1);
  });
