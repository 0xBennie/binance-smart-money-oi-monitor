import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fundingCost } from '../src/funding.js';

test('fundingCost: 0.01%/8h on $10k → +$1 per settlement, 10.95% APR', () => {
  const c = fundingCost(0.0001, 8, 10_000);
  assert.equal(c.ratePct, 0.01);
  assert.equal(c.intervalHours, 8);
  assert.equal(c.settlementsPerDay, 3);
  assert.equal(c.annualizedPct, 10.95);       // 0.01% × 3 × 365
  assert.equal(c.perSettlementUsd, 1);        // longs pay $1
  assert.equal(c.dailyUsd, 3);
  assert.equal(c.annualUsd, 1095);
  assert.equal(c.longPays, true);
});

test('fundingCost: a 4h interval doubles the annualized vs 8h', () => {
  const c = fundingCost(0.0001, 4, 10_000);
  assert.equal(c.settlementsPerDay, 6);
  assert.equal(c.annualizedPct, 21.9);        // twice the 8h case
  assert.equal(c.dailyUsd, 6);
  assert.equal(c.annualUsd, 2190);
});

test('fundingCost: negative rate → shorts pay, longs receive (signed)', () => {
  const c = fundingCost(-0.0002, 8, 10_000);
  assert.equal(c.ratePct, -0.02);
  assert.equal(c.perSettlementUsd, -2);       // longs receive $2
  assert.equal(c.annualizedPct, -21.9);
  assert.equal(c.longPays, false);
});

test('fundingCost: defaults notional to $10k and interval to 8h on bad input', () => {
  assert.equal(fundingCost(0.0001).notionalUsd, 10_000);
  assert.equal(fundingCost(0.0001, 0, 10_000).intervalHours, 8);   // bad interval → 8
  assert.equal(fundingCost(0.0001, -1, 10_000).intervalHours, 8);
});

test('fundingCost: non-finite rate is treated as zero (no funding)', () => {
  const c = fundingCost(NaN, 8, 10_000);
  assert.equal(c.perSettlementUsd, 0);
  assert.equal(c.annualizedPct, 0);
  assert.equal(c.longPays, false);
});

test('fundingCost: custom notional scales linearly', () => {
  const c = fundingCost(0.0001, 8, 50_000);
  assert.equal(c.perSettlementUsd, 5);        // 50k × 0.01%
  assert.equal(c.annualUsd, 5475);
});
