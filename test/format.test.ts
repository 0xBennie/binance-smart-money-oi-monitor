import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSmartMoneyPush, formatSmartMoneyPushPlain } from '../src/format.js';

const sm: any = {
  symbol: 'BEATUSDT', ts: 0, signalDay: 0, totalPositions: 0, totalTraders: 544, longShortRatio: 1.1,
  longTraders: 347, longTradersQty: 3_369_000, longTradersAvgEntryPrice: 2.556,
  shortTraders: 197, shortTradersQty: 3_387_000, shortTradersAvgEntryPrice: 2.365,
  longWhales: 108, longWhalesQty: 500_000, longWhalesAvgEntryPrice: 2.5,
  shortWhales: 67, shortWhalesQty: 300_000, shortWhalesAvgEntryPrice: 2.8,
  longProfitTraders: 295, shortProfitTraders: 47, longProfitWhales: 90, shortProfitWhales: 20,
};
const oi: any = {
  symbol: 'BEATUSDT', ts: 0, oiNowUsd: 18_000_000, oiNowCoins: 6_200_000,
  oiChg5m: 0, oiChg15m: 0, oiChg1h: 1.8, oiChg4h: 4.0,
};

test('formatSmartMoneyPush renders the whale card as Telegram HTML', () => {
  const html = formatSmartMoneyPush({ symbol: 'BEATUSDT', sm, oi, price: 2.9 });
  assert.match(html, /BEAT/);
  assert.match(html, /巨鲸总览/);
  assert.match(html, /多头 108 个鲸鱼/);
  assert.match(html, /空头 67 个鲸鱼/);
  assert.match(html, /均价/);
  assert.match(html, /<b>/);                 // it is HTML (parse_mode: HTML)
  assert.ok(!html.includes('NaN'));
});

test('PNL status reflects price vs each side avg entry', () => {
  const html = formatSmartMoneyPush({ symbol: 'BEATUSDT', sm, oi, price: 2.9 });
  // longs entered at 2.5 (< 2.9) → in profit; shorts at 2.8 (< 2.9) → losing
  assert.ok(html.includes('盈利中'), 'longs should show 盈利中');
  assert.ok(html.includes('亏损中'), 'shorts should show 亏损中');
});

test('plain variant strips every HTML tag', () => {
  const plain = formatSmartMoneyPushPlain({ symbol: 'BEATUSDT', sm, oi, price: 2.9 });
  assert.ok(!plain.includes('<b>') && !plain.includes('</b>'));
  assert.ok(!plain.includes('<code>') && !plain.includes('<i>'));
  assert.match(plain, /巨鲸总览/);
});

test('missing price does not crash or emit NaN (derives from OI)', () => {
  const html = formatSmartMoneyPush({ symbol: 'BEATUSDT', sm, oi });   // no explicit price
  assert.match(html, /BEAT/);
  assert.ok(!html.includes('NaN'));
});

test('push card footer carries the X promo + not-advice disclaimer', () => {
  const html = formatSmartMoneyPush({ symbol: 'BEATUSDT', sm, oi, price: 2.9 });
  assert.ok(html.includes('x.com/0xBenniee'), 'X/Twitter promo on the shared TG card');
  assert.ok(html.includes('非投资建议') || html.includes('not financial advice'), 'disclaimer on the TG card');
});
