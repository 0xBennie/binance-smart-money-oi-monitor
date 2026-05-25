/**
 * Smart Money overview snapshot cron entry point.
 *
 * Usage:
 *   tsx src/scripts/smart-money-tick.ts
 *
 * Symbol pool: derived from fapi exchangeInfo (all TRADING USDT PERPETUAL),
 * capped at SMART_MONEY_POOL_MAX (default 150).
 *
 * Cron recommendation: every 60 min, e.g. `7 * * * *`. With 12s spacing,
 * 150 symbols takes ~30 min, well inside the cron window.
 */
import 'dotenv/config';
import axios from 'axios';
import { storage } from '../storage';
import { getSmartMoneyOverviewBatch } from '../binance-smart-money';
import { preflightBinanceFapi } from '../binance-rate-limit';

const POOL_MAX = parseInt(process.env.SMART_MONEY_POOL_MAX || '150', 10);

async function getAllUsdtPerpetuals(): Promise<string[]> {
  try {
    const exInfo = await axios.get(
      'https://fapi.binance.com/fapi/v1/exchangeInfo',
      { timeout: 10_000 }
    );
    const list: string[] = (exInfo.data.symbols || [])
      .filter((s: any) =>
        s.status === 'TRADING' &&
        s.contractType === 'PERPETUAL' &&
        s.quoteAsset === 'USDT'
      )
      .map((s: any) => s.symbol as string)
      .sort();
    return list.slice(0, POOL_MAX);
  } catch (e: any) {
    console.warn(`[smart-money-tick] exchangeInfo failed (${e?.response?.status || e.message})`);
    return [];
  }
}

async function main(): Promise<void> {
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

  console.log(
    `[smart-money-tick] start pool=${pool.length} ` +
    `(12s±3s jitter → ~${Math.round(pool.length * 12)}s)`
  );

  const snapshots = await getSmartMoneyOverviewBatch(pool, 12_000, 3_000);

  let written = 0;
  for (const snap of snapshots.values()) {
    storage.recordSmartMoney(snap);
    written++;
  }

  // Opportunistic cleanup
  const cleaned = storage.cleanup();

  const elapsedS = (Date.now() - startedAt) / 1000;
  console.log(
    `[smart-money-tick] done requested=${pool.length} captured=${snapshots.size} ` +
    `written=${written} cleaned=${cleaned.smartMoney}+${cleaned.topTrader} elapsed=${elapsedS.toFixed(1)}s`
  );

  storage.stop();
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('[smart-money-tick] fatal:', e);
    process.exit(1);
  });
