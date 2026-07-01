"""Cross-links tying an altmonitor alert (WHEN a symbol moves) to the Smart Money
view (WHO is positioned) — the TypeScript half of this repo. Keeps the two halves
one workflow: the alert points to the whale positioning for the same symbol."""

_SIGNAL_BASE = "https://www.binance.com/zh-CN/smart-money/signal"


def smart_money_link(symbol: str) -> str:
    """Binance Smart Signal (聪明钱) page URL for a symbol — the same data the
    TS tracker / MCP / panel in this repo surfaces."""
    s = (symbol or "").strip().upper()
    if s and not s.endswith("USDT"):
        s += "USDT"
    return f"{_SIGNAL_BASE}/{s}"
