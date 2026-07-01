"""Configuration loaded from environment / .env file."""
import os
import ssl

from dotenv import load_dotenv

load_dotenv()


def ssl_context() -> ssl.SSLContext:
    """TLS context backed by certifi's CA bundle when available.

    Avoids the python.org-on-macOS missing-CA issue; on Linux/VPS this just
    works with the bundled roots too.
    """
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def _f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _i(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


# --- Telegram ---
TG_BOT_TOKEN = os.getenv("TG_BOT_TOKEN", "").strip()
TG_CHAT_ID = os.getenv("TG_CHAT_ID", "").strip()

# --- Trigger thresholds (percent) ---
PUMP_THRESHOLD = _f("PUMP_THRESHOLD", 3.0)    # 1min change >= +3.0%  -> PUMP
DUMP_THRESHOLD = _f("DUMP_THRESHOLD", -3.0)   # 1min change <= -3.0%  -> DUMP

# --- Anti-spam ---
COOLDOWN_SEC = _i("COOLDOWN_SEC", 180)        # per-symbol cooldown between alerts

# --- OI surge thresholds (percent; 0 disables that window) ---
OI_SURGE_PCT_1M = _f("OI_SURGE_PCT_1M", 3.0)  # |OI change| over ~1min >= this -> alert
OI_SURGE_PCT_5M = _f("OI_SURGE_PCT_5M", 6.0)  # |OI change| over ~5min >= this -> alert

# --- Volume burst (爆量) — a just-closed 1m candle's quote volume (USDT) vs its
#     own trailing baseline. 0 multiplier disables. ---
VOL_BURST_MULT = _f("VOL_BURST_MULT", 5.0)             # candle vol >= MULT x trailing median
VOL_BURST_LOOKBACK = _i("VOL_BURST_LOOKBACK", 20)      # candles used for the baseline
VOL_BURST_MIN_USDT = _f("VOL_BURST_MIN_USDT", 50_000)  # ignore illiquid noise below this

# --- Telegram command access / send pacing ---
# Comma-separated chat ids allowed to issue commands. Empty -> only TG_CHAT_ID.
ALLOWED_CHAT_IDS = [
    c.strip() for c in os.getenv("ALLOWED_CHAT_IDS", "").split(",") if c.strip()
]
TG_MIN_SEND_INTERVAL = _f("TG_MIN_SEND_INTERVAL", 3.2)  # seconds between sends (~18/min)

# --- Extra metrics ---
LSR_PERIOD = os.getenv("LSR_PERIOD", "5m")   # long/short ratio granularity

# --- Cross-link each alert to the Smart Money view (the TS half of this repo) ---
SMART_MONEY_LINK = os.getenv("SMART_MONEY_LINK", "true").lower() in ("1", "true", "yes")

# --- Persisted runtime state & history ---
STATE_FILE = os.getenv("STATE_FILE", "state.json")
HISTORY_ENABLED = os.getenv("HISTORY_ENABLED", "true").lower() in ("1", "true", "yes")
DB_FILE = os.getenv("DB_FILE", "alerts.db")

# --- OI polling ---
OI_POLL_SEC = _i("OI_POLL_SEC", 60)           # full-market OI sweep interval
OI_CONCURRENCY = _i("OI_CONCURRENCY", 15)     # concurrent OI requests

# --- Symbol list refresh ---
SYMBOLS_REFRESH_SEC = _i("SYMBOLS_REFRESH_SEC", 3600)

# --- Binance endpoints (USDⓈ-M futures) ---
FAPI_BASE = "https://fapi.binance.com"
WS_BASE = "wss://fstream.binance.com/ws"


def allowed_chat_ids() -> set[str]:
    ids = set(ALLOWED_CHAT_IDS)
    if TG_CHAT_ID:
        ids.add(TG_CHAT_ID)
    return ids


def missing_required() -> list:
    """Names of required env vars that are not set (empty list = good to go)."""
    missing = []
    if not TG_BOT_TOKEN:
        missing.append("TG_BOT_TOKEN")
    if not TG_CHAT_ID:
        missing.append("TG_CHAT_ID")
    return missing


def validate() -> None:
    missing = missing_required()
    if missing:
        raise SystemExit(
            "缺少必填配置:%s\n"
            "最快的方式:运行交互式向导  python setup.py\n"
            "(它会引导你连接 Telegram 并自动写好 .env)\n"
            "或手动:cp .env.example .env 后填入这些变量。"
            % ", ".join(missing)
        )
