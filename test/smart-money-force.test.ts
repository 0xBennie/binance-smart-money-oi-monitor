import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSmartMoneyOverview } from '../src/binance-smart-money.js';
import { binanceHttp, markBinanceApiBlockedWithRetry, clearBinanceApiBlocked } from '../src/binance-rate-limit.js';

// A1: a force fetch (the tracker path) must return FRESH-or-null. When the circuit
// breaker is open it must NOT hand back the cached snapshot — that snap has a STALE
// ts, and the tracker's INSERT OR REPLACE would rewrite the existing row and freeze
// the time series. The non-force (live) path may still fall back to the cache.
test('A1: force returns null when blocked, non-force returns the cached snap', async () => {
  const origGet = binanceHttp.get;
  clearBinanceApiBlocked();
  // Seed the positive cache with one successful (unblocked) fetch.
  (binanceHttp as any).get = async () => ({
    headers: {},
    data: { code: '000000', data: { longTraders: 123, longTradersQty: 1000, longTradersAvgEntryPrice: 2 } },
  });

  try {
    const seeded = await getSmartMoneyOverview('FORCEUSDT', { force: true });
    assert.ok(seeded, 'seed fetch should populate the cache');
    assert.equal(seeded!.longTraders, 123);

    // Open the circuit breaker.
    markBinanceApiBlockedWithRetry('soft', 60);

    // Force path: fresh-or-nothing → null (NOT the stale cached snap).
    const forced = await getSmartMoneyOverview('FORCEUSDT', { force: true });
    assert.equal(forced, null, 'force must return null when blocked, never the stale snap');

    // Non-force path: still serves the cached snap (live tools want best-effort data).
    const live = await getSmartMoneyOverview('FORCEUSDT');
    assert.ok(live, 'non-force should still return the cached snap');
    assert.equal(live!.longTraders, 123);
  } finally {
    (binanceHttp as any).get = origGet;
    clearBinanceApiBlocked();
  }
});
