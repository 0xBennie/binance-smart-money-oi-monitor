"""Background poller for full-market Open Interest, with 1m / 5m change windows."""
import asyncio
import logging
import time
from collections import deque

import config
from binance_rest import BinanceREST

log = logging.getLogger("oi")

# Keep ~12 minutes of 60s snapshots so both the 1m and 5m lookbacks resolve.
_HISTORY_LEN = 12


class OITracker:
    """Polls full-market OI every OI_POLL_SEC and exposes %change over a window."""

    def __init__(self, rest: BinanceREST):
        self._rest = rest
        self._symbols: list[str] = []
        self._sem = asyncio.Semaphore(config.OI_CONCURRENCY)
        # ring buffer of (wall_ts, {symbol: oi}); newest is last
        self._history: deque[tuple[float, dict[str, float]]] = deque(maxlen=_HISTORY_LEN)
        self._on_sweep = None  # optional no-arg callback run after each completed sweep

    def set_symbols(self, symbols: list[str]) -> None:
        self._symbols = symbols

    def set_on_sweep(self, cb) -> None:
        """Register a callback fired right after each OI sweep lands."""
        self._on_sweep = cb

    def latest_symbols(self) -> list[str]:
        return list(self._history[-1][1].keys()) if self._history else []

    def change_pct(self, symbol: str) -> float | None:
        """~1-min OI change (latest vs ~OI_POLL_SEC ago), or None if not resolvable."""
        return self.change_over(symbol, config.OI_POLL_SEC)

    def change_over(self, symbol: str, window_sec: float, tol_frac: float = 0.5) -> float | None:
        """OI %change from ~`window_sec` ago to now, or None.

        Picks the historical snapshot whose age is closest to `window_sec` and only
        returns a value when that age is within ±`tol_frac`·`window_sec`. So a stalled
        poller (e.g. during a 429 backoff) reports N/A instead of a wrong window.
        """
        if not self._history:
            return None
        now_ts, now_snap = self._history[-1]
        curr = now_snap.get(symbol)
        if curr is None or curr == 0:
            return None
        tol = window_sec * tol_frac
        best = None
        best_err = None
        for ts, snap in self._history:
            if ts >= now_ts:                 # skip the latest point itself
                continue
            past = snap.get(symbol)
            if past is None or past == 0:
                continue
            err = abs((now_ts - ts) - window_sec)
            if err <= tol and (best_err is None or err < best_err):
                best, best_err = past, err
        if best is None:
            return None
        return (curr - best) / best * 100.0

    async def _fetch_one(self, symbol: str) -> tuple[str, float | None]:
        async with self._sem:
            data = await self._rest.get_json("/fapi/v1/openInterest", {"symbol": symbol})
        if not data:
            return symbol, None
        try:
            return symbol, float(data["openInterest"])
        except (KeyError, ValueError):
            return symbol, None

    async def run(self) -> None:
        """Sweep OI forever, appending each snapshot and firing the sweep callback."""
        while True:
            start = time.monotonic()
            if self._symbols:
                results = await asyncio.gather(*(self._fetch_one(s) for s in self._symbols))
                snapshot = {s: oi for s, oi in results if oi is not None}
                if snapshot:
                    self._history.append((time.time(), snapshot))
                    log.debug("OI sweep: %d symbols", len(snapshot))
                    if self._on_sweep:
                        try:
                            self._on_sweep()
                        except Exception as e:  # noqa: BLE001
                            log.warning("on_sweep callback failed: %s", e)
            elapsed = time.monotonic() - start
            # Floor of 5s: if a sweep ever runs past OI_POLL_SEC, don't immediately
            # fire another full-market sweep back-to-back.
            await asyncio.sleep(max(5.0, config.OI_POLL_SEC - elapsed))
