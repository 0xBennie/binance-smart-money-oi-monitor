"""Shared Binance futures REST client with 429/418 rate-limit backoff.

Binance escalates to a temporary IP ban (HTTP 418) only if you keep hammering
after a 429. We honor Retry-After and globally pause all callers so we never
cross that line.
"""
import asyncio
import logging
import time

import aiohttp

import config

log = logging.getLogger("rest")


class BinanceREST:
    def __init__(self, session: aiohttp.ClientSession):
        self._session = session
        self._pause_until = 0.0  # monotonic clock; all requests wait until this

    @property
    def paused(self) -> bool:
        return time.monotonic() < self._pause_until

    def _trip(self, retry_after: float, code: int) -> None:
        until = time.monotonic() + retry_after
        if until > self._pause_until:
            self._pause_until = until
            log.warning("Binance %s -> backing off %.0fs (all REST paused)", code, retry_after)

    async def get_json(self, path: str, params: dict | None = None, retries: int = 2):
        """GET JSON with backoff. Returns parsed JSON, or None on failure."""
        url = config.FAPI_BASE + path
        for attempt in range(retries + 1):
            wait = self._pause_until - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                async with self._session.get(
                    url, params=params, timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    if resp.status in (429, 418):
                        retry_after = float(resp.headers.get("Retry-After", 5))
                        # A 418 ban can carry a Retry-After of hours. Cap the LOCAL
                        # wait for BOTH 429 and 418 so a single call can't await the
                        # whole ban and stall the OITracker sweep; we stay paused
                        # regardless, we just re-check sooner.
                        self._trip(min(retry_after, 120), resp.status)
                        continue
                    # other errors (e.g. 400 bad symbol): don't retry forever
                    log.debug("%s -> HTTP %s", path, resp.status)
                    return None
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                log.debug("%s request error: %s", path, e)
                await asyncio.sleep(1.0 * (attempt + 1))
        return None
