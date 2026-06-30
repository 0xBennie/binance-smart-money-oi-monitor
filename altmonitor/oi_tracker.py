"""Background poller that maintains the 1-minute Open-Interest change per symbol."""
import asyncio
import logging
import time

import config
from binance_rest import BinanceREST

log = logging.getLogger("oi")


class OITracker:
    """Polls full-market OI every OI_POLL_SEC and exposes the 1-min % change."""

    def __init__(self, rest: BinanceREST):
        self._rest = rest
        self._prev: dict[str, float] = {}   # last sweep
        self._curr: dict[str, float] = {}   # latest sweep
        self._prev_ts = 0.0                 # wall time of the prev sweep
        self._curr_ts = 0.0                 # wall time of the curr sweep
        self._symbols: list[str] = []
        self._sem = asyncio.Semaphore(config.OI_CONCURRENCY)

    def set_symbols(self, symbols: list[str]) -> None:
        self._symbols = symbols

    def change_pct(self, symbol: str) -> float | None:
        """OI change in percent between the two most recent sweeps, or None.

        Returns None unless the two sweeps are spaced close to OI_POLL_SEC apart.
        A long sweep or a 429 backoff can stretch the gap to several minutes; in
        that case the delta is no longer a ~1-minute window, so we report N/A
        rather than a misleading number labelled "1min".
        """
        prev = self._prev.get(symbol)
        curr = self._curr.get(symbol)
        if prev is None or curr is None or prev == 0:
            return None
        gap = self._curr_ts - self._prev_ts
        if not (config.OI_POLL_SEC * 0.5 <= gap <= config.OI_POLL_SEC * 2.5):
            return None
        return (curr - prev) / prev * 100.0

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
        """Sweep OI forever. Each cycle shifts curr -> prev, then refetches."""
        while True:
            start = time.monotonic()
            if self._symbols:
                results = await asyncio.gather(
                    *(self._fetch_one(s) for s in self._symbols)
                )
                snapshot = {s: oi for s, oi in results if oi is not None}
                if snapshot:
                    self._prev, self._prev_ts = self._curr, self._curr_ts
                    self._curr, self._curr_ts = snapshot, time.time()
                    log.debug("OI sweep: %d symbols", len(snapshot))
            elapsed = time.monotonic() - start
            # Floor of 5s (not 1s): if a sweep ever runs past OI_POLL_SEC, don't
            # immediately fire another full-market sweep back-to-back.
            await asyncio.sleep(max(5.0, config.OI_POLL_SEC - elapsed))
