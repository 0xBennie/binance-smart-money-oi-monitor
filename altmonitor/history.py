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
                direction  TEXT    NOT NULL,
                price      REAL,
                change_pct REAL,
                oi_change  REAL,
                amplitude  REAL,
                lsr        REAL,
                quadrant   TEXT
            )
            """
        )
        self._db.execute("CREATE INDEX IF NOT EXISTS idx_ts ON alerts(ts)")
        self._db.execute("CREATE INDEX IF NOT EXISTS idx_symbol ON alerts(symbol)")
        self._db.commit()

    def record(self, a: Alert, quadrant: str) -> None:
        try:
            self._db.execute(
                "INSERT INTO alerts (ts,symbol,direction,price,change_pct,"
                "oi_change,amplitude,lsr,quadrant) VALUES (?,?,?,?,?,?,?,?,?)",
                (a.ts, a.symbol, a.direction, a.price, a.change_pct,
                 a.oi_change, a.amplitude, a.lsr, quadrant),
            )
            self._db.commit()
        except sqlite3.Error as e:
            log.warning("history insert failed: %s", e)

    def recent(self, limit: int = 10, symbol: str | None = None) -> str:
        q = "SELECT ts,symbol,direction,change_pct,oi_change FROM alerts"
        params: tuple = ()
        if symbol:
            q += " WHERE symbol=?"
            params = (symbol,)
        q += " ORDER BY ts DESC LIMIT ?"
        params += (limit,)
        rows = self._db.execute(q, params).fetchall()
        if not rows:
            return "暂无历史记录"
        lines = ["🕘 最近告警"]
        for ts, sym, d, chg, oi in rows:
            t = time.strftime("%m-%d %H:%M", time.localtime(ts))
            arrow = "🟢" if d == "PUMP" else "🔴"
            oi_s = f" OI{oi:+.1f}%" if oi is not None else ""
            lines.append(f"{arrow} {t} {base_asset(sym)} {chg:+.1f}%{oi_s}")
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
