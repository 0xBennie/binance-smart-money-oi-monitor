// Minimal SQLite manager for Smart Money + Top Trader snapshots.
// Single file, two tables, 30-day retention, no external deps beyond better-sqlite3.

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
// Type-only import: erased at compile time, so it does NOT load the native module.
import type Database from 'better-sqlite3';

// better-sqlite3 is a NATIVE module and an *optional* dependency. Importing it at
// module load time would eagerly load the addon the moment anything re-exports
// storage (src/index.ts does), crashing library consumers whose optional build
// failed — even if they only call live (non-DB) functions. So load it LAZILY, on
// the FIRST DB op only, and cache the constructor.
const require = createRequire(import.meta.url);
let DatabaseCtor: typeof Database | null = null;
function loadDatabase(): typeof Database {
  if (!DatabaseCtor) DatabaseCtor = require('better-sqlite3') as typeof Database;
  return DatabaseCtor;
}

export interface SmartMoneySnapshotRow {
  symbol: string; ts: number;
  totalPositions: number; totalTraders: number; longShortRatio: number;
  longTraders: number; longTradersQty: number; longTradersAvgEntryPrice: number;
  shortTraders: number; shortTradersQty: number; shortTradersAvgEntryPrice: number;
  longWhales: number; longWhalesQty: number; longWhalesAvgEntryPrice: number;
  shortWhales: number; shortWhalesQty: number; shortWhalesAvgEntryPrice: number;
  longProfitTraders: number; shortProfitTraders: number;
  longProfitWhales: number; shortProfitWhales: number;
  price?: number | null;   // mark price at capture (added 1.9.4; null on pre-1.9.4 rows)
}

export interface TopTraderSnapshotRow {
  symbol: string; ts: number;
  period: string;
  topAccountLongPct: number; topAccountShortPct: number; topAccountLsr: number;
  topPositionLongPct: number; topPositionShortPct: number; topPositionLsr: number;
  takerBuyVol: number; takerSellVol: number; takerBsr: number;
}

export interface OISnapshotRow {
  symbol: string; ts: number;
  oiNowUsd: number; oiNowCoins: number;
  // nullable when the history bar at that lookback isn't available
  oiChg5m: number | null;
  oiChg15m: number | null;
  oiChg1h: number | null;
  oiChg4h: number | null;
}

/** A slim smart-money row for history / change / scan reads (camelCase). */
export interface SmartMoneyHistoryRow {
  symbol?: string; ts: number; longShortRatio: number;
  longTraders: number; longQty: number; longAvg: number;
  shortTraders: number; shortQty: number; shortAvg: number;
  longProfitTraders: number; shortProfitTraders: number;
  longProfitWhales: number; shortProfitWhales: number;
  longWhales: number; shortWhales: number;
  longWhalesQty: number; shortWhalesQty: number; // 庄家(鲸鱼)持仓张数 — for whale-level change
  longWhaleAvg: number; shortWhaleAvg: number;   // 庄家(鲸鱼)均价
  price: number | null;                          // mark price at capture (null on pre-1.9.4 rows)
}

const RETENTION_DAYS = 30;
// SMART_MONEY_DB_PATH lets the tracker and the MCP server / dashboard point at the
// SAME db regardless of their working directory — otherwise each defaults to its
// own cwd/data/snapshots.db and the time-series tools silently read an empty file.
//
// Resolved at CALL time (not module-load time): a library consumer that imports
// storage BEFORE its dotenv runs would otherwise bind the wrong path forever.
export function resolveDbPath(): string {
  return process.env.SMART_MONEY_DB_PATH || path.join(process.cwd(), 'data', 'snapshots.db');
}

/** Turn a raw DB/native-module error into an actionable hint. The time-series CLIs
 * (change/scan/chart) statically touch the DB layer, so a broken better-sqlite3
 * (ABI mismatch after a Node upgrade, or not installed) would otherwise dump a raw
 * stack — give the same guidance the MCP tools do. */
export function dbErrorHint(e: any): string {
  const msg = e?.message ?? String(e);
  if (/NODE_MODULE_VERSION|different Node\.js version|was compiled against/i.test(msg))
    return `本地 DB 读取失败:better-sqlite3 原生模块与当前 Node 版本不匹配(升级 Node 后常见)。修复:npm rebuild better-sqlite3(或 npm i better-sqlite3)。\n原始错误:${msg}`;
  if (/Cannot find module 'better-sqlite3'|ERR_MODULE_NOT_FOUND|Could not locate the bindings/i.test(msg))
    return `本地 DB 读取失败:缺少 better-sqlite3(时序工具 change/scan/chart 需要它)。安装:npm i better-sqlite3。\n原始错误:${msg}`;
  if (/no such column/i.test(msg))
    return `本地 DB 读取失败:数据库缺少某一列(通常是旧版本建的库、还没被新版本写过一次触发迁移)。修复:先跑一次 tracker(smart-money-tick)让它执行 schema 迁移,或删除旧库重建。\n原始错误:${msg}`;
  return `本地 DB 读取失败:${msg}`;
}

/** Thrown by getDbReadonly when the DB file doesn't exist yet. `code = 'ENOENT'`
 * so callers' generic missing-DB detectors (dashboard's isMissingDbError) match it. */
export class MissingDbError extends Error {
  readonly code = 'ENOENT';
  constructor(dbPath: string) {
    super(`no local DB at ${dbPath} — run the tracker (smart-money-tick) first`);
    this.name = 'MissingDbError';
  }
}

/** Does a table have a given column? (PRAGMA probe — cheap.) Used so a read on a
 * pre-1.9.4 DB that predates the `price` column doesn't throw "no such column". */
function tableHasColumn(db: Database.Database, table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

/** Smart-money read column list. `price` may be absent on a pre-1.9.4 DB whose
 * migration hasn't run (reads open their own connection and never call migrate()),
 * so select `NULL AS price` in that case. */
function smSelectCols(hasPrice: boolean): string {
  return `ts, long_short_ratio AS longShortRatio,
   long_traders AS longTraders, long_traders_qty AS longQty, long_traders_avg_entry_price AS longAvg,
   short_traders AS shortTraders, short_traders_qty AS shortQty, short_traders_avg_entry_price AS shortAvg,
   long_profit_traders AS longProfitTraders, short_profit_traders AS shortProfitTraders,
   long_profit_whales AS longProfitWhales, short_profit_whales AS shortProfitWhales,
   long_whales AS longWhales, short_whales AS shortWhales,
   long_whales_qty AS longWhalesQty, short_whales_qty AS shortWhalesQty,
   long_whales_avg_entry_price AS longWhaleAvg, short_whales_avg_entry_price AS shortWhaleAvg,
   ${hasPrice ? 'price' : 'NULL'} AS price`;
}

class Storage {
  private db: Database.Database | null = null;
  private stmtInsertSmartMoney!: Database.Statement;
  private stmtInsertTopTrader!: Database.Statement;
  private stmtInsertOI!: Database.Statement;
  // Cached read statements against the live `db` (D2): the alert hot path calls
  // smartMoneyHistory every sweep — re-preparing (and reopening a whole readonly
  // connection) per call is wasteful when a live connection is already open.
  private stmtHistory?: Database.Statement;
  private stmtLatest?: Database.Statement;

  init(dbPath?: string): void {
    if (this.db) return;
    const p = dbPath ?? resolveDbPath();
    const Database = loadDatabase();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    this.db = new Database(p);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.createTables();
    this.migrate();
    this.prepareStmts();
    console.log(`[Storage] initialized: ${p}`);
  }

  /** Additive schema migrations for DBs created by an older version (SQLite has no
   * ADD COLUMN IF NOT EXISTS, so probe table_info first). */
  private migrate(): void {
    const cols = this.db!.prepare(`PRAGMA table_info(ob_smart_money_snapshots)`).all() as { name: string }[];
    if (!cols.some((c) => c.name === 'price')) {
      this.db!.exec(`ALTER TABLE ob_smart_money_snapshots ADD COLUMN price REAL`);
    }
  }

  private createTables(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS ob_smart_money_snapshots (
        symbol TEXT NOT NULL, ts INTEGER NOT NULL,
        total_positions REAL, total_traders INTEGER, long_short_ratio REAL,
        long_traders INTEGER, long_traders_qty REAL, long_traders_avg_entry_price REAL,
        short_traders INTEGER, short_traders_qty REAL, short_traders_avg_entry_price REAL,
        long_whales INTEGER, long_whales_qty REAL, long_whales_avg_entry_price REAL,
        short_whales INTEGER, short_whales_qty REAL, short_whales_avg_entry_price REAL,
        long_profit_traders INTEGER, short_profit_traders INTEGER,
        long_profit_whales INTEGER, short_profit_whales INTEGER,
        price REAL,
        PRIMARY KEY (symbol, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_sm_ts ON ob_smart_money_snapshots(ts);

      CREATE TABLE IF NOT EXISTS ob_top_trader_snapshots (
        symbol TEXT NOT NULL, ts INTEGER NOT NULL,
        period TEXT NOT NULL,
        top_account_long_pct REAL, top_account_short_pct REAL, top_account_lsr REAL,
        top_position_long_pct REAL, top_position_short_pct REAL, top_position_lsr REAL,
        taker_buy_vol REAL, taker_sell_vol REAL, taker_bsr REAL,
        PRIMARY KEY (symbol, ts, period)
      );
      CREATE INDEX IF NOT EXISTS idx_tt_ts ON ob_top_trader_snapshots(ts);

      CREATE TABLE IF NOT EXISTS ob_oi_snapshots (
        symbol TEXT NOT NULL, ts INTEGER NOT NULL,
        oi_now_usd REAL, oi_now_coins REAL,
        oi_chg_5m REAL, oi_chg_15m REAL, oi_chg_1h REAL, oi_chg_4h REAL,
        PRIMARY KEY (symbol, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_oi_ts ON ob_oi_snapshots(ts);
    `);
  }

  private prepareStmts(): void {
    this.stmtInsertSmartMoney = this.db!.prepare(`
      INSERT OR REPLACE INTO ob_smart_money_snapshots
        (symbol, ts, total_positions, total_traders, long_short_ratio,
         long_traders, long_traders_qty, long_traders_avg_entry_price,
         short_traders, short_traders_qty, short_traders_avg_entry_price,
         long_whales, long_whales_qty, long_whales_avg_entry_price,
         short_whales, short_whales_qty, short_whales_avg_entry_price,
         long_profit_traders, short_profit_traders,
         long_profit_whales, short_profit_whales, price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtInsertTopTrader = this.db!.prepare(`
      INSERT OR REPLACE INTO ob_top_trader_snapshots
        (symbol, ts, period,
         top_account_long_pct, top_account_short_pct, top_account_lsr,
         top_position_long_pct, top_position_short_pct, top_position_lsr,
         taker_buy_vol, taker_sell_vol, taker_bsr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtInsertOI = this.db!.prepare(`
      INSERT OR REPLACE INTO ob_oi_snapshots
        (symbol, ts, oi_now_usd, oi_now_coins,
         oi_chg_5m, oi_chg_15m, oi_chg_1h, oi_chg_4h)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  recordSmartMoney(row: SmartMoneySnapshotRow): void {
    if (!this.db) return;
    this.stmtInsertSmartMoney.run([
      row.symbol, row.ts,
      row.totalPositions, row.totalTraders, row.longShortRatio,
      row.longTraders, row.longTradersQty, row.longTradersAvgEntryPrice,
      row.shortTraders, row.shortTradersQty, row.shortTradersAvgEntryPrice,
      row.longWhales, row.longWhalesQty, row.longWhalesAvgEntryPrice,
      row.shortWhales, row.shortWhalesQty, row.shortWhalesAvgEntryPrice,
      row.longProfitTraders, row.shortProfitTraders,
      row.longProfitWhales, row.shortProfitWhales, row.price ?? null,
    ]);
  }

  recordTopTrader(row: TopTraderSnapshotRow): void {
    if (!this.db) return;
    this.stmtInsertTopTrader.run([
      row.symbol, row.ts, row.period,
      row.topAccountLongPct, row.topAccountShortPct, row.topAccountLsr,
      row.topPositionLongPct, row.topPositionShortPct, row.topPositionLsr,
      row.takerBuyVol, row.takerSellVol, row.takerBsr,
    ]);
  }

  recordOI(row: OISnapshotRow): void {
    if (!this.db) return;
    this.stmtInsertOI.run([
      row.symbol, row.ts, row.oiNowUsd, row.oiNowCoins,
      row.oiChg5m, row.oiChg15m, row.oiChg1h, row.oiChg4h,
    ]);
  }

  cleanup(): { smartMoney: number; topTrader: number; oi: number } {
    if (!this.db) return { smartMoney: 0, topTrader: 0, oi: 0 };
    const expiry = Date.now() - RETENTION_DAYS * 86400_000;
    const sm = this.db.prepare('DELETE FROM ob_smart_money_snapshots WHERE ts < ?').run(expiry);
    const tt = this.db.prepare('DELETE FROM ob_top_trader_snapshots WHERE ts < ?').run(expiry);
    const oi = this.db.prepare('DELETE FROM ob_oi_snapshots WHERE ts < ?').run(expiry);
    return { smartMoney: sm.changes, topTrader: tt.changes, oi: oi.changes };
  }

  /** Force a WAL checkpoint (TRUNCATE) so a SIGKILL/OOM mid-write can't leave an
   * uncheckpointed WAL. No-op when the DB isn't open. */
  checkpoint(): void {
    this.db?.pragma('wal_checkpoint(TRUNCATE)');
  }

  /** Read-only handle for dashboards / queries. Throws MissingDbError (code ENOENT)
   * when the DB file doesn't exist yet — consistent with the array-returning read
   * methods below, and recognized by the dashboard's isMissingDbError. */
  getDbReadonly(dbPath?: string): Database.Database {
    const p = dbPath ?? resolveDbPath();
    if (!fs.existsSync(p)) throw new MissingDbError(p);
    const Database = loadDatabase();
    return new Database(p, { readonly: true });
  }

  /** Smart-money snapshots for one symbol since `sinceMs`, oldest first. */
  smartMoneyHistory(symbol: string, sinceMs: number, dbPath?: string): SmartMoneyHistoryRow[] {
    // Reuse the live connection (+ cached statement) when one is open and no explicit
    // path override was given — migrate() has already run so `price` is guaranteed.
    if (this.db && dbPath === undefined) {
      if (!this.stmtHistory) {
        this.stmtHistory = this.db.prepare(
          `SELECT ${smSelectCols(true)} FROM ob_smart_money_snapshots
           WHERE symbol = ? AND ts >= ? ORDER BY ts ASC`
        );
      }
      return this.stmtHistory.all(symbol, sinceMs) as SmartMoneyHistoryRow[];
    }
    const p = dbPath ?? resolveDbPath();
    if (!fs.existsSync(p)) return [];   // no local DB yet (e.g. ephemeral npx run)
    const Database = loadDatabase();
    const db = new Database(p, { readonly: true });
    try {
      const hasPrice = tableHasColumn(db, 'ob_smart_money_snapshots', 'price');
      return db.prepare(
        `SELECT ${smSelectCols(hasPrice)} FROM ob_smart_money_snapshots
         WHERE symbol = ? AND ts >= ? ORDER BY ts ASC`
      ).all(symbol, sinceMs) as SmartMoneyHistoryRow[];
    } finally { db.close(); }
  }

  /** Latest snapshot per symbol — for market-wide ranking / scans. */
  latestSmartMoney(dbPath?: string): SmartMoneyHistoryRow[] {
    if (this.db && dbPath === undefined) {
      if (!this.stmtLatest) {
        this.stmtLatest = this.db.prepare(
          `SELECT s.symbol AS symbol, ${smSelectCols(true)}
           FROM ob_smart_money_snapshots s
           JOIN (SELECT symbol, MAX(ts) AS mts FROM ob_smart_money_snapshots GROUP BY symbol) m
             ON s.symbol = m.symbol AND s.ts = m.mts`
        );
      }
      return this.stmtLatest.all() as SmartMoneyHistoryRow[];
    }
    const p = dbPath ?? resolveDbPath();
    if (!fs.existsSync(p)) return [];   // no local DB yet
    const Database = loadDatabase();
    const db = new Database(p, { readonly: true });
    try {
      const hasPrice = tableHasColumn(db, 'ob_smart_money_snapshots', 'price');
      return db.prepare(
        `SELECT s.symbol AS symbol, ${smSelectCols(hasPrice)}
         FROM ob_smart_money_snapshots s
         JOIN (SELECT symbol, MAX(ts) AS mts FROM ob_smart_money_snapshots GROUP BY symbol) m
           ON s.symbol = m.symbol AND s.ts = m.mts`
      ).all() as SmartMoneyHistoryRow[];
    } finally { db.close(); }
  }

  stop(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      // Cached statements belong to the now-closed connection — drop them so a
      // later init() re-prepares against the fresh handle.
      this.stmtHistory = undefined;
      this.stmtLatest = undefined;
      console.log('[Storage] stopped');
    }
  }
}

export const storage = new Storage();
