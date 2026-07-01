import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePanel, renderPanelHtml } from '../src/panel.js';

const sm: any = {
  symbol: 'BEATUSDT', ts: 0, signalDay: 0, totalPositions: 0, totalTraders: 544,
  longShortRatio: 1.07,
  longTraders: 347, longTradersQty: 3_369_000, longTradersAvgEntryPrice: 2.556,
  shortTraders: 197, shortTradersQty: 3_387_000, shortTradersAvgEntryPrice: 2.365,
  longWhales: 108, longWhalesQty: 0, longWhalesAvgEntryPrice: 0,
  shortWhales: 67, shortWhalesQty: 0, shortWhalesAvgEntryPrice: 0,
  longProfitTraders: 312, shortProfitTraders: 35,
  longProfitWhales: 0, shortProfitWhales: 0,
};

test('computePanel derives sides, ratio and PNL sign', () => {
  const d = computePanel(sm, 2.90);   // price above long avg, above short avg
  assert.equal(d.long.traders, 347);
  assert.equal(d.long.whales, 108);
  assert.ok(Math.abs(d.long.profitPct - 312 / 347) < 1e-9);
  assert.ok(d.long.pnlUsd! > 0, 'longs profit when price > their avg');
  assert.ok(d.short.pnlUsd! < 0, 'shorts lose when price > their avg');
  assert.ok(d.longShareOfTotal > 0 && d.longShareOfTotal < 1);
  assert.ok(d.longShortNotionalRatio! > 0);
});

test('computePanel handles missing price (pnl null)', () => {
  const d = computePanel(sm, null);
  assert.equal(d.long.pnlUsd, null);
  assert.equal(d.short.pnlUsd, null);
});

test('renderPanelHtml is self-contained html for the symbol', () => {
  const html = renderPanelHtml(computePanel(sm, 2.90));
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /BEAT/);
  assert.match(html, /聪明钱总览/);
  // no external assets (CSP-free, screenshot-ready)
  assert.ok(!/https?:\/\//.test(html), 'must not reference external URLs');
});
