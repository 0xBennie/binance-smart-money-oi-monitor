import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtUsd, fmtPct, fmtChg, fmtPrice } from '../src/format-num.js';

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

test('fmtChg is signed', () => {
  assert.equal(fmtChg(0.05), '+5.00%');
  assert.equal(fmtChg(-0.0512), '-5.12%');
  assert.equal(fmtChg(null), '—');
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
