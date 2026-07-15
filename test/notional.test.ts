import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartMoneyNotionalUsd, smartMoneyShareOfOI, smartMoneySide } from '../src/binance-smart-money.js';

test('smartMoneyNotionalUsd = long qty×avgEntry + short qty×avgEntry', () => {
  const sm = {
    longTradersQty: 10, longTradersAvgEntryPrice: 100,
    shortTradersQty: 5, shortTradersAvgEntryPrice: 200,
  };
  assert.equal(smartMoneyNotionalUsd(sm), 10 * 100 + 5 * 200); // 2000
});

test('smartMoneyShareOfOI = gross notional / (2×OI), clamped, with null guards', () => {
  const sm = {
    longTradersQty: 10, longTradersAvgEntryPrice: 100, // 1000 gross notional
    shortTradersQty: 0, shortTradersAvgEntryPrice: 0,
  };
  assert.equal(smartMoneyShareOfOI(sm, 4000), 0.125);        // 1000 / (2 × 4000) — not 0.25 (single-OI double-count)
  assert.equal(smartMoneyShareOfOI({ longTradersQty: 100, longTradersAvgEntryPrice: 100, shortTradersQty: 0, shortTradersAvgEntryPrice: 0 }, 1000), 1); // clamp: 10000/(2*1000)=5 → 1
  assert.equal(smartMoneyShareOfOI(sm, 0), null);            // OI 0 -> null
  assert.equal(smartMoneyShareOfOI(sm, null), null);         // OI missing -> null
  assert.equal(smartMoneyShareOfOI(sm, undefined), null);

  const zero = {
    longTradersQty: 0, longTradersAvgEntryPrice: 0,
    shortTradersQty: 0, shortTradersAvgEntryPrice: 0,
  };
  assert.equal(smartMoneyShareOfOI(zero, 1000), null);       // notional 0 -> null
});

test('C1: dashboard SM Share uses the helper — always ≤ 1, no ~2× double-count', () => {
  // Regression for the dashboard's old inline `smNotional / oi_now_usd` (no /2, no
  // clamp) which read ~2× every other surface and could exceed 100%. The dashboard
  // now calls smartMoneyShareOfOI, so it inherits the /2 + clamp.
  const row = {   // both sides sized so gross notional ≈ 3× a small OI
    longTradersQty: 1_000_000, longTradersAvgEntryPrice: 2,
    shortTradersQty: 1_000_000, shortTradersAvgEntryPrice: 2,
  };
  const oiNowUsd = 1_000_000;                       // gross = 4,000,000
  const share = smartMoneyShareOfOI(row, oiNowUsd);
  assert.ok(share != null && share <= 1, `SM Share must be ≤ 1, got ${share}`);
  assert.equal(share, 1);                           // 4e6 / (2×1e6) = 2 → clamped to 1
  // A moderate case lands strictly below 1 (and is HALF the old un-halved value).
  const moderate = smartMoneyShareOfOI(row, 8_000_000);   // 4e6 / (2×8e6) = 0.25
  assert.equal(moderate, 0.25);                            // old inline gave 0.5
});

test('smartMoneySide breaks out smart-money (traders) + whale positions per side', () => {
  const sm: any = {
    longTraders: 100, longTradersQty: 10, longTradersAvgEntryPrice: 50,
    longWhales: 20, longWhalesQty: 4, longWhalesAvgEntryPrice: 60,
    longProfitTraders: 55, longProfitWhales: 12,
    shortTraders: 40, shortTradersQty: 8, shortTradersAvgEntryPrice: 30,
    shortWhales: 10, shortWhalesQty: 0, shortWhalesAvgEntryPrice: 0,
    shortProfitTraders: 4, shortProfitWhales: 0,
  };
  const L = smartMoneySide(sm, 'long');
  assert.equal(L.smartMoneyUsd, 500);   // 10 × 50 (all smart-money traders)
  assert.equal(L.whalesUsd, 240);       // 4 × 60 (whales only)
  assert.equal(L.traders, 100);
  assert.equal(L.whales, 20);
  assert.equal(L.profitPct, 55);        // 55/100
  assert.equal(L.whaleProfitPct, 60);   // 12/20

  const S = smartMoneySide(sm, 'short');
  assert.equal(S.smartMoneyUsd, 240);   // 8 × 30
  assert.equal(S.whalesUsd, 0);         // whale qty 0 -> 0 (bapi gave no whale qty)
  assert.equal(S.profitPct, 10);        // 4/40
  assert.equal(S.whaleProfitPct, 0);    // 0/10
});
