import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtUsd, fmtPct, fmtChg, fmtPrice, fmtQty } from '../src/format-num.js';

test('fmtUsd scales and guards', () => {
  assert.equal(fmtUsd(1.5e9), '$1.50B');
  assert.equal(fmtUsd(2.5e6), '$2.50M');
  assert.equal(fmtUsd(1500), '$1.5K');
  assert.equal(fmtUsd(500), '$500');
  assert.equal(fmtUsd(-2e6), '-$2.00M');
  assert.equal(fmtUsd(null), '—');
  assert.equal(fmtUsd(NaN), '—');
});

test('fmtPct guards non-finite', () => {
  assert.equal(fmtPct(0.1234), '12.34%');
  assert.equal(fmtPct(null), '—');
  assert.equal(fmtPct(NaN), '—');
});

test('fmtPct treats input as a 0..1 fraction; digits arg controls decimals', () => {
  // The canonical convention: fmtPct is for 0..1 fractions (it multiplies by 100).
  // A wrong merge that fed it an already-percent value would print e.g. 6200%.
  assert.equal(fmtPct(0.62, 0), '62%');
  assert.equal(fmtPct(0.62, 1), '62.0%');
  assert.equal(fmtPct(0.62), '62.00%');       // default 2 digits
  assert.ok(fmtPct(0.62).startsWith('62') && fmtPct(0.62).endsWith('%'));
  assert.equal(fmtPct(-0.05, 1), '-5.0%');    // dashboard whale-spread can be negative
});

test('E2: a 0..1 profit ratio vs an already-percent change use DIFFERENT functions', () => {
  // profitPct is a 0..1 ratio → fmtPct (×100). oiChg is already a percent → fmtChg (no ×100).
  const profitRatio = 55 / 100;   // 0.55
  const oiChangePct = 4.05;       // already %
  assert.equal(fmtPct(profitRatio, 0), '55%');   // NOT "0.55%" and NOT "5500%"
  assert.equal(fmtChg(oiChangePct), '+4.05%');   // NOT "+405.00%"
});

test('fmtQty compacts bare quantities (no $), guards non-finite', () => {
  assert.equal(fmtQty(1.5e9), '1.5B');
  assert.equal(fmtQty(2.5e6), '2.5M');
  assert.equal(fmtQty(1500), '1.5K');
  assert.equal(fmtQty(842), '842');
  assert.equal(fmtQty(null), '—');
  assert.equal(fmtQty(NaN), '—');
});

test('fmtChg formats an already-percent change, signed (no extra ×100)', () => {
  assert.equal(fmtChg(4.05), '+4.05%');   // oiChg values are already percents
  assert.equal(fmtChg(-5.12), '-5.12%');
  assert.equal(fmtChg(0), '+0.00%');
  assert.equal(fmtChg(null), '—');
  assert.equal(fmtChg(NaN), '—');
});

test('fmtPrice groups large, trims small, guards <=0', () => {
  assert.ok(fmtPrice(65432.1).startsWith('65,432'));  // thousands separator
  assert.equal(fmtPrice(2.556), '2.556');
  assert.equal(fmtPrice(2.0), '2');
  assert.ok(fmtPrice(0.00001234).startsWith('0.0000123'));
  assert.equal(fmtPrice(0), '—');
  assert.equal(fmtPrice(-5), '—');
  assert.equal(fmtPrice(NaN), '—');
});
