import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeChange, scanExtreme } from '../src/tracking.js';
import { renderChartHtml } from '../src/chart.js';
import { storage } from '../src/storage.js';
import type { SmartMoneyHistoryRow } from '../src/storage.js';

const row = (ts: number, lq: number, sq: number, la = 1, sa = 1): SmartMoneyHistoryRow => ({
  ts, longShortRatio: sq ? lq / sq : 0,
  longTraders: 100, longQty: lq, longAvg: la,
  shortTraders: 100, shortQty: sq, shortAvg: sa,
  longProfitTraders: 50, shortProfitTraders: 50, longWhales: 10, shortWhales: 10,
});

test('computeChange: qty delta per side (added / reduced), sign + pct', () => {
  const from = row(1000, 1000, 800);
  const to = row(2000, 1200, 600);          // long +200, short -200
  const { long, short } = computeChange(from, to);
  assert.equal(long.qtyChange, 200);
  assert.equal(long.qtyChangePct, 20);
  assert.equal(short.qtyChange, -200);
  assert.equal(short.qtyChangePct, -25);
});

test('computeChange: null pct when starting from zero', () => {
  const { long } = computeChange(row(1000, 0, 500), row(2000, 300, 500));
  assert.equal(long.qtyChange, 300);
  assert.equal(long.qtyChangePct, null);
});

test('renderChartHtml: self-contained html, no external assets', () => {
  const rows = [
    row(1_700_000_000_000, 1000, 900, 0.5, 0.4),
    row(1_700_000_900_000, 1100, 850, 0.51, 0.4),
    row(1_700_000_1800_000, 1250, 800, 0.52, 0.41),
  ];
  const html = renderChartHtml({ symbol: 'BEATUSDT', rows });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /BEAT/);
  assert.match(html, /<svg/);
  assert.match(html, /多头持仓/);
  // no external asset loads (the only http(s) allowed is the SVG xmlns namespace)
  assert.ok(!/(?:src|href)\s*=\s*["']https?:/i.test(html), 'no external src/href');
  assert.ok(!/url\(\s*['"]?https?:/i.test(html), 'no external url() assets');
});

test('renderChartHtml: graceful when too few points', () => {
  const html = renderChartHtml({ symbol: 'XUSDT', rows: [row(1, 1, 1)] });
  assert.match(html, /暂无足够/);
});

test('scanExtreme: mostLong and mostShort never share a symbol (small universe)', () => {
  // 15-symbol synthetic set: universe (15) < 2*limit (20), the overlap case.
  const now = Date.now();
  const synthetic: SmartMoneyHistoryRow[] = Array.from({ length: 15 }, (_, i) => ({
    symbol: `SYM${i}USDT`, ts: now, longShortRatio: i + 1,   // distinct LSRs 1..15
    longTraders: 50, longQty: 100, longAvg: 1,
    shortTraders: 50, shortQty: 100, shortAvg: 1,
    longProfitTraders: 25, shortProfitTraders: 25, longWhales: 5, shortWhales: 5,
  }));
  const orig = storage.latestSmartMoney;
  (storage as any).latestSmartMoney = () => synthetic;
  try {
    const res = scanExtreme({ limit: 10 }) as { mostLong: { symbol: string }[]; mostShort: { symbol: string }[] };
    const longSet = new Set(res.mostLong.map((e) => e.symbol));
    const shared = res.mostShort.filter((e) => longSet.has(e.symbol));
    assert.equal(shared.length, 0, `mostLong/mostShort overlap: ${shared.map((e) => e.symbol).join(',')}`);
    assert.equal(res.mostLong.length, 10);   // top 10 by LSR
    assert.equal(res.mostShort.length, 5);   // remaining 15-10, no double-count
  } finally {
    (storage as any).latestSmartMoney = orig;
  }
});
