import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartMoneyNotionalUsd, smartMoneyShareOfOI } from '../src/binance-smart-money.js';

test('smartMoneyNotionalUsd = long qty×avgEntry + short qty×avgEntry', () => {
  const sm = {
    longTradersQty: 10, longTradersAvgEntryPrice: 100,
    shortTradersQty: 5, shortTradersAvgEntryPrice: 200,
  };
  assert.equal(smartMoneyNotionalUsd(sm), 10 * 100 + 5 * 200); // 2000
});

test('smartMoneyShareOfOI = notional / OI, with null guards', () => {
  const sm = {
    longTradersQty: 10, longTradersAvgEntryPrice: 100, // 1000 notional
    shortTradersQty: 0, shortTradersAvgEntryPrice: 0,
  };
  assert.equal(smartMoneyShareOfOI(sm, 4000), 0.25);
  assert.equal(smartMoneyShareOfOI(sm, 0), null);            // OI 0 -> null
  assert.equal(smartMoneyShareOfOI(sm, null), null);         // OI missing -> null
  assert.equal(smartMoneyShareOfOI(sm, undefined), null);

  const zero = {
    longTradersQty: 0, longTradersAvgEntryPrice: 0,
    shortTradersQty: 0, shortTradersAvgEntryPrice: 0,
  };
  assert.equal(smartMoneyShareOfOI(zero, 1000), null);       // notional 0 -> null
});
