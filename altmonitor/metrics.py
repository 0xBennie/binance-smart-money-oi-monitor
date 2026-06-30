"""On-demand extra metrics fetched only when an alert fires (keeps load tiny)."""
import logging

import config
from binance_rest import BinanceREST

log = logging.getLogger("metrics")


async def fetch_lsr(rest: BinanceREST, symbol: str) -> float | None:
    """Latest global long/short *account* ratio (>1 = more longs).

    Binance min granularity is 5m; we just grab the most recent point.
    """
    data = await rest.get_json(
        "/futures/data/globalLongShortAccountRatio",
        {"symbol": symbol, "period": config.LSR_PERIOD, "limit": 1},
    )
    if not data:
        return None
    try:
        return float(data[-1]["longShortRatio"])
    except (KeyError, ValueError, IndexError):
        return None
