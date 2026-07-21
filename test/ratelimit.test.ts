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
  markBinanceNetworkError,
  clearBinanceNetworkError,
  wasBinanceUnreachable,
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

// Regression: a failed fetch (timeout / 503 / geo-edge block) must be reported as a
// reachability problem, NOT as "symbol unsupported". The response interceptor marks the
// flag on EVERY rejection and clears it only on a 2xx; noData() reads it to pick the
// message. (Bug: a 503 from a geo-restricted region was misreported as an unsupported
// symbol, sending exactly the users who need HTTPS_PROXY the wrong way.)
test('reachability flag: set on a failed fetch, cleared by a usable 2xx response', () => {
  clearBinanceNetworkError();
  assert.equal(wasBinanceUnreachable(), false);
  markBinanceNetworkError();   // interceptor onRejected: no response OR non-2xx (503/451/…)
  assert.equal(wasBinanceUnreachable(), true, 'a failed fetch flags Binance as unreachable');
  clearBinanceNetworkError();  // interceptor onFulfilled: a 2xx proves reachability
  assert.equal(
    wasBinanceUnreachable(),
    false,
    'a 2xx clears it — an empty 2xx body then means unsupported symbol, not unreachable',
  );
});

test('reachability failure never trips the rate-limit circuit breaker (distinct concepts)', () => {
  clearBinanceApiBlocked();
  clearBinanceNetworkError();
  markBinanceNetworkError();
  assert.equal(wasBinanceUnreachable(), true);
  assert.equal(isBinanceApiBlocked(), false, 'a timeout/503 must not freeze all calls like a 418/429 does');
  clearBinanceNetworkError();
});
