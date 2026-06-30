"""Lightweight SQLite alert history for 复盘 (single file, stdlib only)."""
import logging
import sqlite3
import time

import config
from models import Alert
from symbols import base_asset

log = logging.getLogger("history")


class History:
    def __init__(self):
        self._db = sqlite3.connect(config.DB_FILE, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS alerts (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                ts         REAL    NOT NULL,
                symbol     TEXT    NOT NULL,
                kind       TEXT    NOT NULL DEFAULT 'price',
                direction  TEXT    NOT NULL,
                price      REAL,
                change_pct REAL,
                oi_change  REAL,
                amplitude  REAL,
                lsr        REAL,
                metric     REAL,
                note       TEXT,
                quadrant   TEXT
            )
            """
        )
        # Migrate DBs created before the kind/metric/note columns existed.
        for ddl in ("kind TEXT NOT NULL DEFAULT 'price'", "metric REAL", "note TEXT"):
            try:
                self._db.execute(f"ALTER TABLE alerts ADD COLUMN {ddl}")
            except sqlite3.OperationalError:
                pass  # column already present
        self._db.execute("CREATE INDEX IF NOT EXISTS idx_ts ON alerts(ts)")
        self._db.execute("CREATE INDEX IF NOT EXISTS idx_symbol ON alerts(symbol)")
        self._db.commit()

    def record(self, a: Alert, quadrant: str) -> None:
        """Back-compat helper for price-move alerts."""
        self.record_event(
            ts=a.ts, symbol=a.symbol, kind="price", direction=a.direction,
            price=a.price, change_pct=a.change_pct, oi_change=a.oi_change,
            amplitude=a.amplitude, lsr=a.lsr, quadrant=quadrant,
        )

    def record_event(self, ts: float, symbol: str, kind: str, direction: str,
                     price=None, change_pct=None, oi_change=None, amplitude=None,
                     lsr=None, metric=None, note=None, quadrant=None) -> None:
        try:
            self._db.execute(
                "INSERT INTO alerts (ts,symbol,kind,direction,price,change_pct,"
                "oi_change,amplitude,lsr,metric,note,quadrant) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (ts, symbol, kind, direction, price, change_pct, oi_change,
                 amplitude, lsr, metric, note, quadrant),
            )
            self._db.commit()
        except sqlite3.Error as e:
            log.warning("history insert failed: %s", e)

    def recent(self, limit: int = 10, symbol: str | None = None,
               kind: str | None = None) -> str:
        q = "SELECT ts,symbol,kind,direction,change_pct,oi_change,metric FROM alerts"
        clauses, params = [], []
        if symbol:
            clauses.append("symbol=?"); params.append(symbol)
        if kind:
            clauses.append("kind=?"); params.append(kind)
        if clauses:
            q += " WHERE " + " AND ".join(clauses)
        q += " ORDER BY ts DESC LIMIT ?"
        params.append(limit)
        rows = self._db.execute(q, tuple(params)).fetchall()
        if not rows:
            return "暂无历史记录"
        lines = ["🕘 最近告警"]
        for ts, sym, knd, d, chg, oi, metric in rows:
            t = time.strftime("%m-%d %H:%M", time.localtime(ts))
            b = base_asset(sym)
            if knd == "oi":
                lines.append(f"📊 {t} {b} OI {(metric or 0):+.1f}% ({d})")
            elif knd == "vol":
                lines.append(f"🔊 {t} {b} 爆量 {(metric or 0):.1f}x")
            else:
                arrow = "🟢" if d == "PUMP" else "🔴"
                oi_s = f" OI{oi:+.1f}%" if oi is not None else ""
                chg_s = f"{chg:+.1f}%" if chg is not None else ""
                lines.append(f"{arrow} {t} {b} {chg_s}{oi_s}")
        return "\n".join(lines)

    def stats(self, hours: int = 24, limit: int = 10) -> str:
        since = time.time() - hours * 3600
        rows = self._db.execute(
            "SELECT symbol, COUNT(*) c FROM alerts WHERE ts>=? "
            "GROUP BY symbol ORDER BY c DESC LIMIT ?",
            (since, limit),
        ).fetchall()
        total = self._db.execute(
            "SELECT COUNT(*) FROM alerts WHERE ts>=?", (since,)
        ).fetchone()[0]
        if not rows:
            return f"近 {hours}h 无告警"
        lines = [f"📊 近 {hours}h 异动榜（共 {total} 条）"]
        for sym, c in rows:
            lines.append(f"{base_asset(sym)}: {c} 次")
        return "\n".join(lines)
