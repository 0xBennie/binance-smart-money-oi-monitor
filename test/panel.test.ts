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

test('名义多空比 renders the ratio as a plain number, not a bogus percent', () => {
  const d = computePanel(sm, 2.90);
  const html = renderPanelHtml(d);
  const ratio = d.longShortNotionalRatio!.toFixed(2);   // e.g. "1.08"
  assert.ok(html.includes(ratio), `expected ratio ${ratio} in card`);
  assert.ok(!/1\d\d\.\d\d%/.test(html), 'must not render ratio*100 as a percent (e.g. 107.00%)');
});

test('missing/NaN price shows neither 盈利中 nor 亏损中 (no fabricated state)', () => {
  const d = computePanel(sm, NaN);
  assert.equal(d.price, null, 'NaN price normalized to null');
  assert.equal(d.long.pnlUsd, null);
  assert.equal(d.short.pnlUsd, null);
  const html = renderPanelHtml(d);
  assert.ok(!html.includes('盈利中') && !html.includes('亏损中'), 'no PNL state badge without a price');
  assert.ok(!html.includes('NaN'), 'never emit NaN');
});

test('profitPct is clamped to [0,1] even with dirty upstream counts', () => {
  const dirty = { ...sm, longProfitTraders: 999 };   // > longTraders (347)
  const d = computePanel(dirty, 2.90);
  assert.ok(d.long.profitPct <= 1, 'profitPct clamped');
  const html = renderPanelHtml(d);
  const widths = [...html.matchAll(/width:([\d.]+)%/g)].map((m) => parseFloat(m[1]));
  assert.ok(widths.every((w) => w <= 100), 'no bar width exceeds 100%');
});

test('symbol with HTML metacharacters is escaped (no injection)', () => {
  const d = computePanel({ ...sm, symbol: '<img src=x onerror=1>USDT' }, 2.90);
  const html = renderPanelHtml(d);
  assert.ok(html.includes('&lt;img'), 'metacharacters escaped');
  assert.ok(!html.includes('<img'), 'raw tag must not appear');
});

test('zero shorts → ratio null, avg-entry 0 → pnl null (no fabricated PNL)', () => {
  const d = computePanel({ ...sm, shortTradersQty: 0, shortTradersAvgEntryPrice: 0, longTradersAvgEntryPrice: 0, longTradersQty: 0 }, 2.90);
  assert.equal(d.longShortNotionalRatio, null);
  assert.equal(d.long.pnlUsd, null, 'no PNL when avg entry is 0');
});

test('footer carries a discoverable repo URL for shared screenshots', () => {
  const html = renderPanelHtml(computePanel(sm, 2.90));
  assert.ok(html.includes('github.com/0xBennie/binance-smart-money-oi-monitor'), 'repo URL in footer');
});

test('absurdly long ticker is capped, not rendered whole', () => {
  const html = renderPanelHtml(computePanel({ ...sm, symbol: 'A'.repeat(40) + 'USDT' }, null));
  assert.ok(!html.includes('A'.repeat(25)), 'over-long symbol truncated');
});

test('OI change footer treats oiChg as already-percent (no double ×100)', () => {
  const oi: any = { symbol: 'BEATUSDT', ts: 0, oiNowUsd: 1e7, oiNowCoins: 1, oiChg5m: 0, oiChg15m: 0, oiChg1h: 1.87, oiChg4h: 4.05 };
  const html = renderPanelHtml(computePanel(sm, 2.90, { oi }));
  assert.ok(html.includes('+4.05%'), 'OI 4h change shown as +4.05%');
  assert.ok(!html.includes('405'), 'not multiplied by 100 again');
});
