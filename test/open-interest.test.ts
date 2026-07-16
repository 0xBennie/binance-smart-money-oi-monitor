import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOiChanges, type OiHistBar } from '../src/binance-open-interest.js';

// Helper: build an ascending (latest last) bar series from parallel coins/usd arrays.
function bars(coins: number[], usd: number[]): OiHistBar[] {
  return coins.map((c, i) => ({
    sumOpenInterest: String(c),
    sumOpenInterestValue: String(usd[i] ?? c),
  }));
}

// The whole point of the fix: OI velocity must track open CONTRACTS, not USD
// notional. A pure price move (USD rises) with flat open contracts is ~0 change.
test('flat coins + rising USD (price pump) → oiChg ≈ 0 (USD notional ignored)', () => {
  const n = 48;                       // full 4h window: -1,-3,-12,-47 all present
  const coins = Array.from({ length: n }, () => 1000);          // contracts flat
  const usd = Array.from({ length: n }, (_, i) => 1_000 * (1 + i * 0.05)); // price rips
  const c = computeOiChanges(bars(coins, usd));

  assert.equal(c.oiChg5m, 0, 'flat contracts → 0 over 5m despite USD move');
  assert.equal(c.oiChg15m, 0);
  assert.equal(c.oiChg1h, 0);
  assert.equal(c.oiChg4h, 0);
});

test('coins up 10% at the 1h reference → oiChg1h ≈ +10%', () => {
  // Build 13 bars so index -12 (1h ago) exists. Ref bar = 1000, latest = 1100.
  const coins = Array.from({ length: 13 }, (_, i) => (i === 0 ? 1000 : 1100));
  // USD deliberately does the OPPOSITE (falls) to prove it is not consulted.
  const usd = Array.from({ length: 13 }, (_, i) => (i === 0 ? 5_000_000 : 1_000_000));
  const c = computeOiChanges(bars(coins, usd));

  assert.ok(c.oiChg1h !== null, 'oiChg1h computed');
  assert.ok(Math.abs((c.oiChg1h as number) - 10) < 1e-9, `expected ~+10%, got ${c.oiChg1h}`);
});

test('coins down 20% at the 5m reference → oiChg5m ≈ -20%', () => {
  const coins = [1000, 800];          // prev=1000 (bar -1), latest=800
  const c = computeOiChanges(bars(coins, [1_000_000, 900_000]));
  assert.ok(c.oiChg5m !== null);
  assert.ok(Math.abs((c.oiChg5m as number) + 20) < 1e-9, `expected -20%, got ${c.oiChg5m}`);
});

test('missing reference bar → null (never substitute 0)', () => {
  // Only 2 bars: index -1 exists, but -3/-12/-47 do not.
  const coins = [1000, 1050];
  const c = computeOiChanges(bars(coins, [1_000_000, 1_050_000]));

  assert.ok(c.oiChg5m !== null, '5m ref present');
  assert.equal(c.oiChg15m, null, '15m ref bar absent → null, not 0');
  assert.equal(c.oiChg1h, null, '1h ref bar absent → null, not 0');
  assert.equal(c.oiChg4h, null, '4h ref bar absent → null, not 0');
});

test('empty series → all null', () => {
  const c = computeOiChanges([]);
  assert.equal(c.oiChg5m, null);
  assert.equal(c.oiChg15m, null);
  assert.equal(c.oiChg1h, null);
  assert.equal(c.oiChg4h, null);
});

test('reference bar of 0 or non-finite coins → null (guarded divide)', () => {
  // Two bars where the reference (bar -1) has 0 contracts.
  const zeroRef = computeOiChanges(bars([0, 1000], [0, 1_000_000]));
  assert.equal(zeroRef.oiChg5m, null, 'prev=0 → null (no divide-by-zero)');

  // Non-finite current value → null.
  const nanCurr = computeOiChanges([
    { sumOpenInterest: '1000', sumOpenInterestValue: '1000000' },
    { sumOpenInterest: 'not-a-number', sumOpenInterestValue: '1100000' },
  ]);
  assert.equal(nanCurr.oiChg5m, null, 'curr NaN → null');
});
