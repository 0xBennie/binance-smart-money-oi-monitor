/**
 * Top-Trader snapshot cron entry point (fapi/futures/data).
 *
 * Usage:
 *   tsx src/scripts/top-trader-tick.ts [period=5m]
 *
 * Cron recommendation: every 30 min, e.g. `0,30 * * * *`.
 * 150 symbols × 1s spacing ≈ 2.5 min, well inside the cron window.
 */
import 'dotenv/config';
import axios from 'axios';
import { storage } from '../storage';
import { getTopTraderSnapshotsBatch, type TopTraderPeriod } from '../binance-top-trader';
import { preflightBinanceFapi } from '../binance-rate-limit';

const POOL_MAX = parseInt(process.env.TOP_TRADER_POOL_MAX || '150', 10);
const VALID_PERIODS = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'] as const;

function parsePeriod(arg: string | undefined): TopTraderPeriod {
  const p = (arg || '5m') as TopTraderPeriod;
  return (VALID_PERIODS as readonly string[]).includes(p) ? p : '5m';
}

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
    console.warn(`[top-trader-tick] exchangeInfo failed (${e?.response?.status || e.message})`);
    return [];
  }
}

async function main(): Promise<void> {
  const period = parsePeriod(process.argv[2]);
  const startedAt = Date.now();

  storage.init();

  const healthy = await preflightBinanceFapi();
  if (!healthy) {
    console.log('[top-trader-tick] preflight failed, abort');
    storage.stop();
    return;
  }

  const pool = await getAllUsdtPerpetuals();
  if (pool.length === 0) {
    console.log('[top-trader-tick] no symbols, skip');
    storage.stop();
    return;
  }

  console.log(
    `[top-trader-tick] start period=${period} pool=${pool.length} ` +
    `(1s±200ms jitter → ~${Math.round(pool.length * 1)}s)`
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
    `[top-trader-tick] done period=${period} requested=${pool.length} ` +
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
