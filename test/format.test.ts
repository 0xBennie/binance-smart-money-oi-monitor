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

test("lang='en' renders English labels and no Chinese jargon", () => {
  const html = formatSmartMoneyPush({ symbol: 'BEATUSDT', sm, oi, price: 2.9 }, 'en');
  assert.match(html, /Whale Overview/);
  assert.match(html, /Total Position/);
  assert.match(html, /Notional L\/S Ratio/);
  assert.match(html, /\bLong\b/);
  assert.match(html, /\bShort\b/);
  assert.match(html, /whales/);
  assert.match(html, /Avg Entry/);
  assert.match(html, /Unrealized PnL/);
  assert.match(html, /In-Profit %/);
  assert.match(html, /24h Volume/);
  assert.match(html, /Open Interest/);
  assert.match(html, /Funding Rate/);
  assert.match(html, /in profit/);
  assert.match(html, /in loss/);
  assert.ok(!html.includes('巨鲸总览'));
  assert.ok(!html.includes('总持仓'));
  assert.ok(!html.includes('多头') && !html.includes('空头'));
  assert.ok(!html.includes('盈利中') && !html.includes('亏损中'));
  assert.ok(!html.includes('均价') && !html.includes('仓位'));
  assert.doesNotMatch(html, /\bFR\b/);
  assert.ok(html.includes('x.com/0xBenniee'));
  assert.ok(html.includes('not financial advice'));
});

test('default language stays Chinese and explicit language overrides env', () => {
  const input = { symbol: 'BEATUSDT', sm, oi, price: 2.9 };
  const prev = process.env.SMART_MONEY_CARD_LANG;
  try {
    delete process.env.SMART_MONEY_CARD_LANG;
    assert.equal(formatSmartMoneyPush(input), formatSmartMoneyPush(input, 'zh'));
    process.env.SMART_MONEY_CARD_LANG = 'en';
    assert.match(formatSmartMoneyPush(input), /Whale Overview/);
    assert.match(formatSmartMoneyPush(input, 'zh'), /巨鲸总览/);
  } finally {
    if (prev === undefined) delete process.env.SMART_MONEY_CARD_LANG;
    else process.env.SMART_MONEY_CARD_LANG = prev;
  }
});

test("plain variant honours lang='en'", () => {
  const plain = formatSmartMoneyPushPlain({ symbol: 'BEATUSDT', sm, oi, price: 2.9 }, 'en');
  assert.match(plain, /Whale Overview/);
  assert.ok(!plain.includes('<b>'));
  assert.ok(!plain.includes('巨鲸总览'));
});
