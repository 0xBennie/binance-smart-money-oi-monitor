#!/usr/bin/env node
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
import { existsSync, readFileSync } from 'node:fs';
import { storage } from '../storage.js';
import { getSmartMoneyOverviewBatch } from '../binance-smart-money.js';
import { preflightBinanceFapi, binanceHttp, updateBinanceUsedWeight } from '../binance-rate-limit.js';
import { installGracefulShutdown } from '../cron-utils.js';
import { normalizeSymbol } from '../symbol.js';

const POOL_MAX    = parseInt(process.env.SMART_MONEY_POOL_MAX    || '0', 10); // 0 = unlimited
const SHARD_INDEX = parseInt(process.env.SMART_MONEY_SHARD_INDEX || '0', 10);
const SHARD_TOTAL = Math.max(1, parseInt(process.env.SMART_MONEY_SHARD_TOTAL || '1', 10));
// Daemon mode: if > 0, keep running a fresh sweep every N minutes (no external
// cron needed). 0 = run once and exit (classic cron entry).
const INTERVAL_MIN = parseInt(process.env.SMART_MONEY_INTERVAL_MIN || '0', 10);

const SPACING_MS = 12_000;
const JITTER_MS = 3_000;

// Cache the resolved full-market symbol list — a daemon full-market sweep would
// otherwise re-download the entire exchangeInfo payload every interval. The set of
// TRADING USDT perps changes slowly, so a 6h TTL is plenty.
const EXCHANGE_INFO_TTL_MS = 6 * 3_600_000;
let cachedPerps: { symbols: string[]; at: number } | null = null;

/**
 * Explicit watchlist to track at high cadence: env SMART_MONEY_WATCHLIST
 * ("BEAT,BIRB,MAGMA") or a watchlist.json (["BEAT",...] or {"symbols":[...]}).
 * When set, only these symbols are swept (POOL_MAX / sharding are ignored) — so a
 * small list can refresh every 15 min. Empty = full market (old behavior).
 */
function resolveWatchlist(): string[] {
  const raw = new Set<string>();
  for (const t of (process.env.SMART_MONEY_WATCHLIST || '').split(',')) {
    const s = normalizeSymbol(t);
    if (s) raw.add(s);
  }
  const file = process.env.SMART_MONEY_WATCHLIST_FILE || 'watchlist.json';
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8'));
      const arr: unknown[] = Array.isArray(parsed) ? parsed : parsed?.symbols ?? [];
      for (const t of arr) { const s = normalizeSymbol(String(t)); if (s) raw.add(s); }
    } catch (e: any) {
      console.warn(`[smart-money-tick] bad ${file}: ${e?.message ?? e}`);
    }
  }
  return [...raw].sort();
}

async function getAllUsdtPerpetuals(): Promise<string[]> {
  const watchlist = resolveWatchlist();
  if (watchlist.length) {
    console.log(`[smart-money-tick] watchlist mode: ${watchlist.length} symbols`);
    return watchlist;
  }
  // Full-market mode: reuse a recent resolved list instead of re-fetching every sweep.
  if (cachedPerps && Date.now() - cachedPerps.at < EXCHANGE_INFO_TTL_MS) {
    return cachedPerps.symbols;
  }
  try {
    // Use the shared keep-alive pool (not bare axios) so this call rides the same
    // socket pool + weight accounting as the rest of the client.
    const exInfo = await binanceHttp.get(
      'https://fapi.binance.com/fapi/v1/exchangeInfo',
      { timeout: 10_000 }
    );
    updateBinanceUsedWeight(exInfo.headers['x-mbx-used-weight-1m'] as string | undefined);
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

    if (list.length) cachedPerps = { symbols: list, at: Date.now() };   // don't cache an empty/garbage payload
    return list;
  } catch (e: any) {
    console.warn(`[smart-money-tick] exchangeInfo failed (${e?.response?.status || e.message})`);
    return [];
  }
}

/** Fetch the whole fapi mark-price table in ONE request → symbol→price map, so
 * each snapshot can store the price at capture (needed for the 现价 vs 庄家均价
 * chart panel). Best-effort: on failure returns an empty map (price → null). */
async function fetchPriceMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const resp = await binanceHttp.get('https://fapi.binance.com/fapi/v1/ticker/price', { timeout: 10_000 });
    updateBinanceUsedWeight(resp.headers['x-mbx-used-weight-1m'] as string | undefined);
    for (const t of (resp.data as any[]) || []) {
      const p = parseFloat(t.price);
      if (t.symbol && Number.isFinite(p)) map.set(t.symbol, p);
    }
  } catch (e: any) {
    console.warn(`[smart-money-tick] price fetch failed (${e?.response?.status || e.message}) — snapshots store price=null this sweep`);
  }
  return map;
}

// Daemon liveness: count consecutive sweeps that wrote 0 snapshots so a stuck
// state (permanent block / dead proxy) is visible in logs instead of looping
// silently while the supervisor still sees the process "online".
let unproductiveSweeps = 0;

/** One full sweep (assumes storage is already initialized). Returns rows written. */
async function runOnce(): Promise<number> {
  const startedAt = Date.now();

  // Preflight: fapi ping, fail-fast on 418/403 — do not slam a blocked IP
  const healthy = await preflightBinanceFapi();
  if (!healthy) {
    console.log('[smart-money-tick] preflight failed, skip this sweep');
    return 0;
  }

  const pool = await getAllUsdtPerpetuals();
  if (pool.length === 0) {
    console.log('[smart-money-tick] no symbols, skip');
    return 0;
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
  // Daemon mode: warn if a sweep can't finish inside the interval → overlapping
  // sweeps contend on the SQLite WAL lock. Keep the watchlist small enough.
  if (INTERVAL_MIN > 0 && etaSec > INTERVAL_MIN * 60) {
    const fit = Math.floor((INTERVAL_MIN * 60) / (SPACING_MS / 1000));
    console.warn(
      `[smart-money-tick] WARNING: sweep ~${(etaSec / 60).toFixed(0)}min > interval ${INTERVAL_MIN}min ` +
      `→ sweeps will overlap. Trim the watchlist to ≤${fit} symbols or raise SMART_MONEY_INTERVAL_MIN.`
    );
  }

  // One batch price pull (all symbols, 1 request) so each snapshot records the
  // mark price at capture time for the 现价 vs 庄家均价 chart panel.
  const priceMap = await fetchPriceMap();

  // Write each snapshot the moment it lands — a mid-run crash/418 then keeps
  // everything captured so far instead of discarding the whole batch.
  // force=true: bypass the 10-min positive cache so every sweep gets a fresh ts
  // (a cache hit would rewrite the same (symbol, ts) row and collapse the series).
  let written = 0;
  const snapshots = await getSmartMoneyOverviewBatch(
    pool, SPACING_MS, JITTER_MS,
    (sym, snap) => { storage.recordSmartMoney({ ...snap, price: priceMap.get(sym) ?? null }); written++; },
    true
  );

  // Opportunistic cleanup (cheap, single DELETE)
  const cleaned = storage.cleanup();

  // Opt-in alerts: only for a bounded watchlist, only when a TG token is configured
  // (otherwise a no-op — never sends without the user's own bot token).
  const alertList = resolveWatchlist();
  if (alertList.length && process.env.SMART_MONEY_ALERT_TG_TOKEN) {
    const { maybeAlert } = await import('../alerts.js');
    for (const sym of alertList) {
      try {
        const r = await maybeAlert(sym);
        if (r.fired && r.sent) console.log(`[smart-money-tick] alert sent: ${sym}`);
      } catch (e: any) { console.warn(`[smart-money-tick] alert(${sym}) failed:`, e?.message ?? e); }
    }
  }

  const elapsedS = (Date.now() - startedAt) / 1000;
  console.log(
    `[smart-money-tick] done${shardTag} requested=${pool.length} captured=${snapshots.size} ` +
    `written=${written} cleaned(sm/tt/oi)=${cleaned.smartMoney}/${cleaned.topTrader}/${cleaned.oi} elapsed=${elapsedS.toFixed(1)}s`
  );
  return written;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  installGracefulShutdown('smart-money-tick');
  storage.init();

  if (INTERVAL_MIN > 0) {
    // Self-scheduling daemon: no external cron needed. Runs a sweep, then waits
    // INTERVAL_MIN before the next. Graceful shutdown closes storage on SIGTERM.
    console.log(`[smart-money-tick] daemon mode: sweeping every ${INTERVAL_MIN} min`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const start = Date.now();
      let wrote = 0;
      try { wrote = await runOnce(); } catch (e: any) { console.error('[smart-money-tick] sweep error:', e?.message ?? e); }
      // Liveness signal: a permanently blocked IP / dead proxy loops forever writing
      // nothing while the supervisor still shows "online". Escalate to ERROR after 3
      // consecutive empty sweeps so ops can tell "stuck" from "healthy and idle".
      if (wrote > 0) { unproductiveSweeps = 0; }
      else if (++unproductiveSweeps >= 3) {
        console.error(
          `[smart-money-tick] ⚠️ STUCK: ${unproductiveSweeps} consecutive sweeps wrote 0 snapshots ` +
          `(~${unproductiveSweeps * INTERVAL_MIN}min no new data). Likely a blocked IP / dead proxy / geo-restriction — check HTTPS_PROXY & circuit breaker.`
        );
      }
      // Long-lived daemon: checkpoint the WAL after each sweep so a SIGKILL/OOM
      // mid-write can't strand an uncheckpointed WAL. Cheap (TRUNCATE).
      try { storage.checkpoint(); } catch (e: any) { console.warn('[smart-money-tick] checkpoint failed:', e?.message ?? e); }
      const waitMs = Math.max(5_000, INTERVAL_MIN * 60_000 - (Date.now() - start));
      await sleep(waitMs);
    }
  }

  await runOnce();
  storage.stop();
}

main()
  .then(() => { if (INTERVAL_MIN <= 0) process.exit(0); })
  .catch((e) => {
    console.error('[smart-money-tick] fatal:', e);
    process.exit(1);
  });
