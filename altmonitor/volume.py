"""Volume-burst (爆量) detection: a just-closed 1m candle vs its trailing baseline.

Per symbol we keep a rolling window of recent *closed* 1-minute quote-volumes
(USDT). When a new candle's volume is >= MULT x the window's median (and above an
absolute floor, to ignore illiquid noise), it's a burst.
"""
import logging
from collections import deque
from statistics import median

import config

log = logging.getLogger("volume")

# Need a few candles of history before the baseline median is meaningful.
_MIN_SAMPLES = 5


class VolumeTracker:
    def __init__(self):
        self._buf: dict[str, deque[float]] = {}

    def record_and_check(self, symbol: str, quote_vol: float, mult: float) -> float | None:
        """Record this closed candle's quote volume; return the burst ratio or None.

        The ratio is computed against the *prior* window (the current candle is not
        in its own baseline), then the candle is appended. `mult` <= 0 disables.
        """
        buf = self._buf.get(symbol)
        if buf is None:
            buf = deque(maxlen=max(config.VOL_BURST_LOOKBACK, _MIN_SAMPLES))
            self._buf[symbol] = buf

        ratio = None
        if mult > 0 and len(buf) >= _MIN_SAMPLES and quote_vol >= config.VOL_BURST_MIN_USDT:
            base = median(buf)
            if base > 0:
                r = quote_vol / base
                if r >= mult:
                    ratio = r
        buf.append(quote_vol)
        return ratio
