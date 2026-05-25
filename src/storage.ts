// Minimal SQLite manager for Smart Money + Top Trader snapshots.
// Single file, two tables, 30-day retention, no external deps beyond better-sqlite3.

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export interface SmartMoneySnapshotRow {
  symbol: string; ts: number;
  totalPositions: number; totalTraders: number; longShortRatio: number;
  longTraders: number; longTradersQty: number; longTradersAvgEntryPrice: number;
  shortTraders: number; shortTradersQty: number; shortTradersAvgEntryPrice: number;
  longWhales: number; longWhalesQty: number; longWhalesAvgEntryPrice: number;
  shortWhales: number; shortWhalesQty: number; shortWhalesAvgEntryPrice: number;
  longProfitTraders: number; shortProfitTraders: number;
  longProfitWhales: number; shortProfitWhales: number;
}

export interface TopTraderSnapshotRow {
  symbol: string; ts: number;
  period: string;
  topAccountLongPct: number; topAccountShortPct: number; topAccountLsr: number;
  topPositionLongPct: number; topPositionShortPct: number; topPositionLsr: number;
  takerBuyVol: number; takerSellVol: number; takerBsr: number;
}

const RETENTION_DAYS = 30;
const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'snapshots.db');

class Storage {
  private db: Database.Database | null = null;
  private stmtInsertSmartMoney!: Database.Statement;
  private stmtInsertTopTrader!: Database.Statement;

  init(dbPath = DEFAULT_DB_PATH): void {
    if (this.db) return;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.createTables();
    this.prepareStmts();
    console.log(`[Storage] initialized: ${dbPath}`);
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
         long_profit_whales, short_profit_whales)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtInsertTopTrader = this.db!.prepare(`
      INSERT OR REPLACE INTO ob_top_trader_snapshots
        (symbol, ts, period,
         top_account_long_pct, top_account_short_pct, top_account_lsr,
         top_position_long_pct, top_position_short_pct, top_position_lsr,
         taker_buy_vol, taker_sell_vol, taker_bsr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      row.longProfitWhales, row.shortProfitWhales,
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

  cleanup(): { smartMoney: number; topTrader: number } {
    if (!this.db) return { smartMoney: 0, topTrader: 0 };
    const expiry = Date.now() - RETENTION_DAYS * 86400_000;
    const sm = this.db.prepare('DELETE FROM ob_smart_money_snapshots WHERE ts < ?').run(expiry);
    const tt = this.db.prepare('DELETE FROM ob_top_trader_snapshots WHERE ts < ?').run(expiry);
    return { smartMoney: sm.changes, topTrader: tt.changes };
  }

  /** Read-only handle for dashboards / queries. */
  getDbReadonly(dbPath = DEFAULT_DB_PATH): Database.Database {
    return new Database(dbPath, { readonly: true });
  }

  stop(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[Storage] stopped');
    }
  }
}

export const storage = new Storage();
