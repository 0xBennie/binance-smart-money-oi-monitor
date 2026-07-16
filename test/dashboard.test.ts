import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { storage } from '../src/storage.js';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function startDashboard(dbPath: string): Promise<{ child: ChildProcess; base: string }> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/scripts/smart-money-dashboard.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SMART_MONEY_DB_PATH: dbPath,
      SMART_MONEY_DASHBOARD_HOST: '127.0.0.1',
      SMART_MONEY_DASHBOARD_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dashboard did not start')), 10_000);
    const onData = (chunk: Buffer) => {
      if (!chunk.toString().includes('listening on')) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout!.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`dashboard exited before listening (${code})`));
    });
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

test('fresh install with a missing DB parent renders tracker guidance', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-dashboard-missing-'));
  const { child, base } = await startDashboard(path.join(tmp, 'missing', 'snapshots.db'));
  try {
    const response = await fetch(base + '/');
    const html = await response.text();
    assert.equal(response.status, 503);
    assert.match(html, /先把 tracker 跑起来|run the tracker/i);
    assert.doesNotMatch(html, /internal error|directory does not exist/i);
  } finally {
    await stop(child);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dashboard HTML includes compact search, legend, load time, and mobile overflow', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-dashboard-data-'));
  const dbPath = path.join(tmp, 'snapshots.db');
  storage.init(dbPath);
  const ts = Date.now();
  storage.recordSmartMoney({
    symbol: 'BEATUSDT', ts, totalPositions: 100, totalTraders: 30, longShortRatio: 1.2,
    longTraders: 20, longTradersQty: 1000, longTradersAvgEntryPrice: 2,
    shortTraders: 10, shortTradersQty: 500, shortTradersAvgEntryPrice: 2.2,
    longWhales: 3, longWhalesQty: 100, longWhalesAvgEntryPrice: 2,
    shortWhales: 2, shortWhalesQty: 50, shortWhalesAvgEntryPrice: 2.2,
    longProfitTraders: 12, shortProfitTraders: 3, longProfitWhales: 2, shortProfitWhales: 1,
    price: 2.1,
  });
  storage.recordOI({ symbol: 'BEATUSDT', ts, oiNowUsd: 1_000_000, oiNowCoins: 500_000, oiChg5m: 1, oiChg15m: 2, oiChg1h: 3, oiChg4h: 4 });
  storage.stop();

  const { child, base } = await startDashboard(dbPath);
  try {
    const response = await fetch(base + '/');
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /id="symbol-search"/);
    assert.match(html, /图例|Legend/);
    assert.match(html, /加载时间|Loaded/);
    assert.match(html, /class="table-wrap"/);
    assert.match(html, /overflow-x:auto/);
    assert.match(html, /BEATUSDT/);
  } finally {
    await stop(child);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
