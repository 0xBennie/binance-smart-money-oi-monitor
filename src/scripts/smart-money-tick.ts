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
import { getUsdtPerpetuals } from '../symbol-list.js';
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

// Takes the ALREADY-resolved watchlist (resolved once per sweep in runOnce) so a
// single sweep doesn't parse watchlist.json twice (here + again for alerts).
async function getAllUsdtPerpetuals(watchlist: string[]): Promise<string[]> {
  if (watchlist.length) {
    console.log(`[smart-money-tick] watchlist mode: ${watchlist.length} symbols`);
    return watchlist;
  }
  // Full-market mode: shared resolver (binanceHttp pool + weight accounting + 6h cache).
  return getUsdtPerpetuals(binanceHttp, { poolMax: POOL_MAX, shardIndex: SHARD_INDEX, shardTotal: SHARD_TOTAL });
}

/** Fetch the whole fapi MARK-price table in ONE request → symbol→price map, so
 * each snapshot can store the price at capture (needed for the 现价 vs 庄家均价
 * chart panel). Best-effort: on failure returns an empty map (price → null).
 *
 * Source = /fapi/v1/premiumIndex `markPrice` — the SAME field the push card
 * (format.ts) and the MCP tools (mcp-core.ts) render 现价/P&L from (funding.markPrice).
 * The old /fapi/v1/ticker/price returns LAST price, so the stored 现价 diverged from
 * every other surface. One source of truth: mark price everywhere. */
async function fetchPriceMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const resp = await binanceHttp.get('https://fapi.binance.com/fapi/v1/premiumIndex', { timeout: 10_000 });
    updateBinanceUsedWeight(resp.headers['x-mbx-used-weight-1m'] as string | undefined);
    for (const t of (resp.data as any[]) || []) {
      const p = parseFloat(t.markPrice);
      if (t.symbol && Number.isFinite(p) && p > 0) map.set(t.symbol, p);
    }
  } catch (e: any) {
    console.warn(`[smart-money-tick] mark price fetch failed (${e?.response?.status || e.message}) — snapshots store price=null this sweep`);
  }
  return map;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Daemon liveness: count consecutive sweeps that wrote 0 snapshots so a stuck
// state (permanent block / dead proxy) is visible in logs instead of looping
// silently while the supervisor still sees the process "online".
let unproductiveSweeps = 0;
// Partial-outage liveness: a sweep can WRITE a few rows yet still be badly degraded
// (e.g. 1/400 symbols captured). unproductiveSweeps (wrote===0) never catches that,
// so also track sweeps whose fresh-capture yield stayed below LOW_YIELD_RATIO.
let lowYieldSweeps = 0;
const STUCK_SWEEPS = 3;
const LOW_YIELD_RATIO = 0.25;

/** One full sweep (assumes storage is already initialized). Returns rows written +
 * the fresh-capture count and pool size so the daemon can judge liveness (a partial
 * outage that still writes a few rows must escalate too — see main's STUCK checks). */
async function runOnce(): Promise<{ written: number; captured: number; pool: number }> {
  const startedAt = Date.now();

  // Preflight: fapi ping, fail-fast on 418/403 — do not slam a blocked IP
  const healthy = await preflightBinanceFapi();
  if (!healthy) {
    console.log('[smart-money-tick] preflight failed, skip this sweep');
    return { written: 0, captured: 0, pool: 0 };
  }

  // Resolve the watchlist ONCE per sweep (used for both the symbol pool and the
  // alert list below) so watchlist.json isn't parsed twice.
  const watchlist = resolveWatchlist();
  // Symbol pool and the mark-price table are independent — fetch them concurrently.
  const [pool, priceMap] = await Promise.all([
    getAllUsdtPerpetuals(watchlist),
    fetchPriceMap(),
  ]);
  if (pool.length === 0) {
    console.log('[smart-money-tick] no symbols, skip');
    return { written: 0, captured: 0, pool: 0 };
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

  // (priceMap was pulled in parallel with the pool above — one batch request so
  // each snapshot records the mark price at capture for the 现价 vs 庄家均价 panel.)

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

  // Opt-in alerts: only for a bounded watchlist, only when BOTH a TG token AND a
  // chat id are configured (otherwise a no-op — never sends without the user's own
  // bot token + chat). Reuses the watchlist resolved once at the top of the sweep.
  if (watchlist.length && process.env.SMART_MONEY_ALERT_TG_TOKEN && process.env.SMART_MONEY_ALERT_TG_CHAT_ID) {
    const { maybeAlert } = await import('../alerts.js');
    for (const sym of watchlist) {
      try {
        const r = await maybeAlert(sym);
        if (r.fired && r.sent) console.log(`[smart-money-tick] alert sent: ${sym}`);
        else if (r.fired && !r.sent) console.warn(`[smart-money-tick] alert NOT sent: ${sym} — ${r.reason ?? 'unknown reason'}`);
      } catch (e: any) { console.warn(`[smart-money-tick] alert(${sym}) failed:`, e?.message ?? e); }
      // Small spacing between sends → avoid Telegram 429 on a burst of alerts.
      await sleep(350);
    }
  }

  const elapsedS = (Date.now() - startedAt) / 1000;
  console.log(
    `[smart-money-tick] done${shardTag} requested=${pool.length} captured=${snapshots.size} ` +
    `written=${written} cleaned(sm/tt/oi)=${cleaned.smartMoney}/${cleaned.topTrader}/${cleaned.oi} elapsed=${elapsedS.toFixed(1)}s`
  );
  return { written, captured: snapshots.size, pool: pool.length };
}

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
      let result = { written: 0, captured: 0, pool: 0 };
      try { result = await runOnce(); } catch (e: any) { console.error('[smart-money-tick] sweep error:', e?.message ?? e); }
      const { written: wrote, captured, pool } = result;
      // Liveness signal 1 — TOTAL outage: a permanently blocked IP / dead proxy loops
      // forever writing nothing while the supervisor still shows "online". Escalate
      // after 3 consecutive empty sweeps so ops can tell "stuck" from "healthy and idle".
      if (wrote > 0) { unproductiveSweeps = 0; }
      else if (++unproductiveSweeps >= STUCK_SWEEPS) {
        console.error(
          `[smart-money-tick] ⚠️ STUCK: ${unproductiveSweeps} consecutive sweeps wrote 0 snapshots ` +
          `(~${unproductiveSweeps * INTERVAL_MIN}min no new data). Likely a blocked IP / dead proxy / geo-restriction — check HTTPS_PROXY & circuit breaker.`
        );
      }
      // Liveness signal 2 — PARTIAL outage: a sweep that captures only a small fraction
      // of the pool (e.g. a flaky proxy dropping most requests) still writes a few rows,
      // so signal 1 never fires. Escalate when the fresh-capture yield stays low.
      const yieldRatio = pool > 0 ? captured / pool : 1;
      if (pool === 0 || yieldRatio >= LOW_YIELD_RATIO) { lowYieldSweeps = 0; }
      else if (++lowYieldSweeps >= STUCK_SWEEPS) {
        console.error(
          `[smart-money-tick] ⚠️ STUCK (degraded): ${lowYieldSweeps} consecutive sweeps captured ` +
          `<${Math.round(LOW_YIELD_RATIO * 100)}% of the pool (last ${captured}/${pool}). Partial outage — ` +
          `likely a flaky proxy / intermittent block dropping most requests. Check HTTPS_PROXY & circuit breaker.`
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
