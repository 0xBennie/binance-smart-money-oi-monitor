import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { storage } from '../src/storage.js';

function run(script: 'change' | 'trend', args: string[]) {
  return spawnSync('npm', ['run', script, '--', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function runDirect(script: 'change' | 'trend', args: string[], dbPath: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', `src/scripts/${script}.ts`, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, SMART_MONEY_DB_PATH: dbPath, NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function runSilentJson(script: 'change' | 'trend', args: string[], dbPath: string) {
  return spawnSync('npm', ['run', '--silent', script, '--', ...args, '--json'], {
    cwd: process.cwd(),
    env: { ...process.env, SMART_MONEY_DB_PATH: dbPath, NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

for (const script of ['change', 'trend'] as const) {
  test(`${script} --help exits 0 without opening the local DB`, () => {
    const result = run(script, ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`npm run ${script} -- <SYMBOL>`));
    assert.doesNotMatch(result.stderr, /local DB|better-sqlite3|snapshot/i);
  });

  test(`${script} missing symbol exits non-zero with usage`, () => {
    const result = run(script, []);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /usage:/i);
  });
}

test('doctor verdict fails only when blocking checks exist', async () => {
  const helpers: any = await import('../src/scripts/cli-help.js');
  assert.equal(typeof helpers.doctorVerdict, 'function');
  assert.deepEqual(helpers.doctorVerdict([]), { exitCode: 0, line: '  ✅ READY — no blocking issues' });
  assert.deepEqual(helpers.doctorVerdict(['Node', 'Binance fapi reachable']), {
    exitCode: 1,
    line: '  ❌ NOT READY — 2 blocking issue(s): Node, Binance fapi reachable',
  });
});

test('change and trend emit readable tables by default and clean JSON on request', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-cli-'));
  const dbPath = path.join(tmp, 'snapshots.db');
  const now = Date.now();
  const snapshot = {
    symbol: 'BEATUSDT', totalPositions: 100, totalTraders: 30, longShortRatio: 1.2,
    longTraders: 20, longTradersQty: 1000, longTradersAvgEntryPrice: 2,
    shortTraders: 10, shortTradersQty: 500, shortTradersAvgEntryPrice: 2.2,
    longWhales: 4, longWhalesQty: 100, longWhalesAvgEntryPrice: 2,
    shortWhales: 2, shortWhalesQty: 50, shortWhalesAvgEntryPrice: 2.2,
    longProfitTraders: 8, shortProfitTraders: 7, longProfitWhales: 1, shortProfitWhales: 2,
    price: 2.1,
  };
  storage.init(dbPath);
  storage.recordSmartMoney({ ...snapshot, ts: now - 30 * 60_000 });
  storage.recordSmartMoney({
    ...snapshot, ts: now, longTradersQty: 1200, shortTradersQty: 450,
    longWhalesQty: 130, shortWhalesQty: 40, longProfitTraders: 14,
    shortProfitTraders: 4, longProfitWhales: 3, shortProfitWhales: 1,
  });
  storage.stop();

  try {
    const changeHuman = runDirect('change', ['BEAT', '60'], dbPath);
    assert.equal(changeHuman.status, 0, changeHuman.stderr);
    assert.match(changeHuman.stdout, /BEAT\s+仓位变化/);
    assert.match(changeHuman.stdout, /多头 ▲/);

    const trendHuman = runDirect('trend', ['BEAT', '60'], dbPath);
    assert.equal(trendHuman.status, 0, trendHuman.stderr);
    assert.match(trendHuman.stdout, /BEAT\s+盈利占比趋势/);

    for (const script of ['change', 'trend'] as const) {
      const result = runSilentJson(script, ['BEAT', '60'], dbPath);
      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.symbol, 'BEATUSDT');
      assert.equal(parsed.samples, 2);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
