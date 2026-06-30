"""Runtime-mutable settings, adjustable via Telegram commands and persisted to disk."""
import json
import logging
import os

import config
from symbols import base_asset

log = logging.getLogger("state")


def normalize_symbol(token: str) -> str:
    """'sol' / 'SOLUSDT' / 'sol/usdt' -> 'SOLUSDT'."""
    t = token.strip().upper().replace("/", "").replace(":USDT", "")
    if not t:
        return ""
    if not t.endswith("USDT"):
        t = t + "USDT"
    return t


class RuntimeSettings:
    """Holds live config. Single asyncio thread -> no locking needed."""

    def __init__(self):
        self.pump_threshold = config.PUMP_THRESHOLD
        self.dump_threshold = config.DUMP_THRESHOLD
        self.cooldown_sec = config.COOLDOWN_SEC
        self.watchlist: set[str] = set()   # empty == monitor ALL symbols
        self.muted: set[str] = set()
        self._load()

    # --- persistence ---
    def _load(self) -> None:
        if not os.path.exists(config.STATE_FILE):
            return
        try:
            with open(config.STATE_FILE, encoding="utf-8") as f:
                d = json.load(f)
            self.pump_threshold = float(d.get("pump_threshold", self.pump_threshold))
            self.dump_threshold = float(d.get("dump_threshold", self.dump_threshold))
            self.cooldown_sec = int(d.get("cooldown_sec", self.cooldown_sec))
            self.watchlist = set(d.get("watchlist", []))
            self.muted = set(d.get("muted", []))
            log.info("Loaded persisted state from %s", config.STATE_FILE)
        except (OSError, ValueError, KeyError) as e:
            log.warning("Could not load state (%s), using defaults", e)

    def save(self) -> None:
        d = {
            "pump_threshold": self.pump_threshold,
            "dump_threshold": self.dump_threshold,
            "cooldown_sec": self.cooldown_sec,
            "watchlist": sorted(self.watchlist),
            "muted": sorted(self.muted),
        }
        tmp = config.STATE_FILE + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(d, f, ensure_ascii=False, indent=2)
            os.replace(tmp, config.STATE_FILE)
        except OSError as e:
            log.warning("Could not save state: %s", e)

    # --- decisions ---
    def is_watched(self, symbol: str) -> bool:
        if symbol in self.muted:
            return False
        if self.watchlist and symbol not in self.watchlist:
            return False
        return True

    def status_text(self) -> str:
        wl = (
            ", ".join(base_asset(s) for s in sorted(self.watchlist))
            if self.watchlist
            else "全部币种"
        )
        mt = ", ".join(base_asset(s) for s in sorted(self.muted)) if self.muted else "无"
        return (
            "⚙️ 当前配置\n"
            f"涨幅阈值: +{self.pump_threshold:.1f}%\n"
            f"跌幅阈值: {self.dump_threshold:.1f}%\n"
            f"冷却: {self.cooldown_sec}s\n"
            f"关注列表: {wl}\n"
            f"屏蔽: {mt}"
        )
