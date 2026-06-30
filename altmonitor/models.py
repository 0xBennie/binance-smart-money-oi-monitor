"""Shared data model for a single alert."""
from dataclasses import dataclass

from symbols import base_asset


@dataclass
class Alert:
    ts: float                    # epoch seconds
    symbol: str                  # raw, e.g. SWARMSUSDT
    price: float
    change_pct: float            # 1-min price change %
    oi_change: float | None      # 1-min OI change %
    amplitude: float | None      # 1-min (high-low)/open %
    lsr: float | None            # long/short account ratio (>1 = 偏多)

    @property
    def direction(self) -> str:
        return "PUMP" if self.change_pct >= 0 else "DUMP"

    @property
    def base(self) -> str:
        return base_asset(self.symbol)
