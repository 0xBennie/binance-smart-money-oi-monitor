"""Fetch and cache the list of tradable USDT-margined perpetual symbols."""
import logging

import aiohttp

import config

log = logging.getLogger("symbols")


async def fetch_usdt_perpetuals(session: aiohttp.ClientSession) -> list[str]:
    """Return raw Binance symbols like ['BTCUSDT', 'ETHUSDT', ...]."""
    url = f"{config.FAPI_BASE}/fapi/v1/exchangeInfo"
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        resp.raise_for_status()
        data = await resp.json()

    symbols = [
        s["symbol"]
        for s in data.get("symbols", [])
        if s.get("contractType") == "PERPETUAL"
        and s.get("quoteAsset") == "USDT"
        and s.get("status") == "TRADING"
    ]
    log.info("Loaded %d USDT perpetual symbols", len(symbols))
    return sorted(symbols)


def base_asset(symbol: str) -> str:
    """SWARMSUSDT -> SWARMS (display name)."""
    return symbol[:-4] if symbol.endswith("USDT") else symbol
