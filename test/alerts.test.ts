import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maybeAlert, _resetAlertDedup } from '../src/alerts.js';
import { storage } from '../src/storage.js';
import type { SmartMoneyHistoryRow } from '../src/storage.js';

// A synthetic 2-snapshot window: long qty moves fromQty→toQty over 20 minutes.
function windowRows(fromQty: number, toQty: number): SmartMoneyHistoryRow[] {
  const now = Date.now();
  const base = {
    longShortRatio: 1, longTraders: 100, longAvg: 2, shortTraders: 100,
    shortQty: 1000, shortAvg: 2, longProfitTraders: 50, shortProfitTraders: 50,
    longProfitWhales: 5, shortProfitWhales: 5, longWhales: 10, shortWhales: 10,
    longWhalesQty: 100, shortWhalesQty: 100, longWhaleAvg: 2, shortWhaleAvg: 2, price: 2.5,
  };
  return [
    { ...base, ts: now - 20 * 60_000, longQty: fromQty },
    { ...base, ts: now, longQty: toQty },
  ];
}

test('B1: same fingerprint is suppressed within the cooldown; a new bucket re-fires', async () => {
  const origHistory = storage.smartMoneyHistory;
  const origFetch = globalThis.fetch;
  process.env.SMART_MONEY_ALERT_TG_TOKEN = 'test-token';
  process.env.SMART_MONEY_ALERT_TG_CHAT_ID = 'test-chat';
  delete process.env.SMART_MONEY_ALERT_WINDOW_MIN;
  delete process.env.SMART_MONEY_ALERT_QTY_PCT;

  let sends = 0;
  (globalThis as any).fetch = async () => {
    sends++;
    return { ok: true, status: 200, text: async () => '' } as any;
  };

  let rows = windowRows(1000, 1200);   // long +20% → trips the 5% threshold
  (storage as any).smartMoneyHistory = () => rows;
  _resetAlertDedup();

  try {
    const first = await maybeAlert('DEDUPUSDT');
    assert.equal(first.fired, true, 'first: threshold tripped');
    assert.equal(first.sent, true, 'first: sent');
    assert.equal(sends, 1);

    // Same window → same fingerprint (side+direction+bucket) → suppressed, no send.
    const second = await maybeAlert('DEDUPUSDT');
    assert.equal(second.fired, false, 'second: same fingerprint suppressed within cooldown');
    assert.equal(second.sent, undefined);
    assert.equal(sends, 1, 'no second Telegram send for the plateaued move');

    // A materially larger move crosses into a new % bucket → different fingerprint → fires.
    rows = windowRows(1000, 2000);   // long +100% → different bucket
    const third = await maybeAlert('DEDUPUSDT');
    assert.equal(third.fired, true, 'third: new bucket re-fires');
    assert.equal(third.sent, true);
    assert.equal(sends, 2);
  } finally {
    (storage as any).smartMoneyHistory = origHistory;
    globalThis.fetch = origFetch;
    delete process.env.SMART_MONEY_ALERT_TG_TOKEN;
    delete process.env.SMART_MONEY_ALERT_TG_CHAT_ID;
    _resetAlertDedup();
  }
});

test('B1: a from-zero position fires (0 → big), not blocked by null pct', async () => {
  const origHistory = storage.smartMoneyHistory;
  const origFetch = globalThis.fetch;
  process.env.SMART_MONEY_ALERT_TG_TOKEN = 'test-token';
  process.env.SMART_MONEY_ALERT_TG_CHAT_ID = 'test-chat';

  let sends = 0;
  (globalThis as any).fetch = async () => { sends++; return { ok: true, status: 200, text: async () => '' } as any; };
  (storage as any).smartMoneyHistory = () => windowRows(0, 500_000);   // brand-new long position
  _resetAlertDedup();

  try {
    const r = await maybeAlert('NEWPOSUSDT');
    assert.equal(r.fired, true, 'from-zero position should fire');
    assert.equal(r.sent, true);
    assert.ok(r.text && r.text.includes('新建仓'), 'renders 新建仓 for a 0→big move');
    assert.equal(sends, 1);
  } finally {
    (storage as any).smartMoneyHistory = origHistory;
    globalThis.fetch = origFetch;
    delete process.env.SMART_MONEY_ALERT_TG_TOKEN;
    delete process.env.SMART_MONEY_ALERT_TG_CHAT_ID;
    _resetAlertDedup();
  }
});
