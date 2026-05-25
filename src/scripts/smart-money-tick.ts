/**
 * Smart Money overview snapshot cron entry point.
 *
 * Usage:
 *   tsx src/scripts/smart-money-tick.ts
 *
 * Symbol pool: derived from fapi exchangeInfo (all TRADING USDT PERPETUAL).
 *
 * Env vars (all optional):
 *   SMART_MONEY_POOL_MAX     hard cap on symbols (default 0 = unlimited / all)
 *   SMART_MONEY_SHARD_INDEX  0-based shard (default 0)
 *   SMART_MONEY_SHARD_TOTAL  total shards (default 1 = no sharding)
 *
 * Sizing reference (12s spacing, no jitter applied to math):
 *   100 symbols ~  20 min
 *   200 symbols ~  40 min
 *   300 symbols ~  60 min  ← upper bound for hourly cron
 *   500 symbols ~ 100 min  ← needs 2h cron OR 2-way sharding
 *
 * Cron recommendations:
 *   - All symbols, hourly cron: not recommended (will overlap)
 *   - All symbols, 2-hour cron: `0 *\/2 * * *`
 *   - All symbols, hourly cron + 2-way sharding:
 *       cron A: `7 * * * *`  env SMART_MONEY_SHARD_INDEX=0 SMART_MONEY_SHARD_TOTAL=2
 *       cron B: `37 * * * *` env SMART_MONEY_SHARD_INDEX=1 SMART_MONEY_SHARD_TOTAL=2
 */
import 'dotenv/config';
import axios from 'axios';
import { storage } from '../storage';
import { getSmartMoneyOverviewBatch } from '../binance-smart-money';
import { preflightBinanceFapi } from '../binance-rate-limit';
import { installGracefulShutdown } from '../cron-utils';

const POOL_MAX    = parseInt(process.env.SMART_MONEY_POOL_MAX    || '0', 10); // 0 = unlimited
const SHARD_INDEX = parseInt(process.env.SMART_MONEY_SHARD_INDEX || '0', 10);
const SHARD_TOTAL = Math.max(1, parseInt(process.env.SMART_MONEY_SHARD_TOTAL || '1', 10));

const SPACING_MS = 12_000;
const JITTER_MS = 3_000;

async function getAllUsdtPerpetuals(): Promise<string[]> {
  try {
    const exInfo = await axios.get(
      'https://fapi.binance.com/fapi/v1/exchangeInfo',
      { timeout: 10_000 }
    );
    let list: string[] = (exInfo.data.symbols || [])
      .filter((s: any) =>
        s.status === 'TRADING' &&
        s.contractType === 'PERPETUAL' &&
        s.quoteAsset === 'USDT'
      )
      .map((s: any) => s.symbol as string)
      .sort();

    // POOL_MAX = 0 means unlimited
    if (POOL_MAX > 0) list = list.slice(0, POOL_MAX);

    // Sharding: deterministic round-robin so each symbol is assigned to exactly one shard
    if (SHARD_TOTAL > 1) {
      list = list.filter((_, i) => i % SHARD_TOTAL === SHARD_INDEX);
    }

    return list;
  } catch (e: any) {
    console.warn(`[smart-money-tick] exchangeInfo failed (${e?.response?.status || e.message})`);
    return [];
  }
}

async function main(): Promise<void> {
  installGracefulShutdown('smart-money-tick');
  const startedAt = Date.now();
  storage.init();

  // Preflight: fapi ping, fail-fast on 418/403 — do not slam a blocked IP
  const healthy = await preflightBinanceFapi();
  if (!healthy) {
    console.log('[smart-money-tick] preflight failed, abort');
    storage.stop();
    return;
  }

  const pool = await getAllUsdtPerpetuals();
  if (pool.length === 0) {
    console.log('[smart-money-tick] no symbols, skip');
    storage.stop();
    return;
  }

  const shardTag = SHARD_TOTAL > 1 ? ` shard=${SHARD_INDEX}/${SHARD_TOTAL}` : '';
  const etaSec = Math.round(pool.length * SPACING_MS / 1000);
  console.log(
    `[smart-money-tick] start pool=${pool.length}${shardTag} ` +
    `(${SPACING_MS / 1000}s±${JITTER_MS / 1000}s jitter → eta ~${etaSec}s = ${(etaSec / 60).toFixed(1)}min)`
  );

  // Warn if estimated time exceeds an hour without sharding
  if (etaSec > 3600 && SHARD_TOTAL === 1) {
    console.warn(
      `[smart-money-tick] WARNING: estimated ${(etaSec / 60).toFixed(0)}min exceeds 1h. ` +
      `Consider SMART_MONEY_SHARD_TOTAL=${Math.ceil(etaSec / 3600)} or a longer cron interval.`
    );
  }

  const snapshots = await getSmartMoneyOverviewBatch(pool, SPACING_MS, JITTER_MS);

  let written = 0;
  for (const snap of snapshots.values()) {
    storage.recordSmartMoney(snap);
    written++;
  }

  // Opportunistic cleanup (cheap, single DELETE)
  const cleaned = storage.cleanup();

  const elapsedS = (Date.now() - startedAt) / 1000;
  console.log(
    `[smart-money-tick] done${shardTag} requested=${pool.length} captured=${snapshots.size} ` +
    `written=${written} cleaned(sm/tt/oi)=${cleaned.smartMoney}/${cleaned.topTrader}/${cleaned.oi} elapsed=${elapsedS.toFixed(1)}s`
  );

  storage.stop();
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('[smart-money-tick] fatal:', e);
    process.exit(1);
  });
