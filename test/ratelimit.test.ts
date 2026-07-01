import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectBinanceBlockStatus,
  detectBinanceBlockDetails,
  isBinanceApiBlocked,
  markBinanceApiBlockedWithRetry,
  clearBinanceApiBlocked,
  updateBinanceUsedWeight,
  getBinanceWeightUtilization,
} from '../src/binance-rate-limit.js';

test('detectBinanceBlockStatus maps HTTP codes to severity', () => {
  assert.equal(detectBinanceBlockStatus({ response: { status: 403 } }), 'hard');
  assert.equal(detectBinanceBlockStatus({ response: { status: 418 } }), 'soft');
  assert.equal(detectBinanceBlockStatus({ response: { status: 429 } }), 'soft');
  assert.equal(detectBinanceBlockStatus({ response: { status: 200 } }), null);
  assert.equal(detectBinanceBlockStatus({}), null);
});

test('detectBinanceBlockDetails parses Retry-After header', () => {
  assert.deepEqual(
    detectBinanceBlockDetails({ response: { status: 429, headers: { 'retry-after': '120' } } }),
    { sev: 'soft', retryAfterSec: 120 },
  );
  assert.deepEqual(
    detectBinanceBlockDetails({ response: { status: 418 } }),
    { sev: 'soft', retryAfterSec: 0 },
  );
  assert.deepEqual(detectBinanceBlockDetails({ response: { status: 200 } }), { sev: null, retryAfterSec: 0 });
});

test('weight utilization tracks the used-weight header (and keeps the max in a window)', () => {
  updateBinanceUsedWeight('1680');   // 1680/2400 = exactly the 70% headroom line
  assert.ok(getBinanceWeightUtilization() >= 0.7, 'reflects the header value');
  updateBinanceUsedWeight('60');     // a lower reading inside the same window is ignored
  assert.ok(getBinanceWeightUtilization() >= 0.7, 'keeps the window peak');
  updateBinanceUsedWeight('not-a-number');  // garbage is ignored, never NaN
  assert.ok(Number.isFinite(getBinanceWeightUtilization()));
});

test('circuit breaker trips on a soft hit and clears', () => {
  clearBinanceApiBlocked();
  assert.equal(isBinanceApiBlocked(), false);
  markBinanceApiBlockedWithRetry('soft', 60);  // honor a 60s Retry-After
  assert.equal(isBinanceApiBlocked(), true);
  clearBinanceApiBlocked();
  assert.equal(isBinanceApiBlocked(), false);
});
