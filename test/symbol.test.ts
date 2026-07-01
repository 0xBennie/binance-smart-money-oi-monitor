import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol } from '../src/symbol.js';

test('normalizeSymbol upper-cases and appends USDT', () => {
  assert.equal(normalizeSymbol('btc'), 'BTCUSDT');
  assert.equal(normalizeSymbol('BTCUSDT'), 'BTCUSDT');
  assert.equal(normalizeSymbol('  eth '), 'ETHUSDT');
  assert.equal(normalizeSymbol('1000pepe'), '1000PEPEUSDT');
});

test('normalizeSymbol returns empty string for empty/nullish', () => {
  assert.equal(normalizeSymbol(''), '');
  assert.equal(normalizeSymbol(null), '');
  assert.equal(normalizeSymbol(undefined), '');
});
