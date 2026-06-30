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

# --- Telegram command access / send pacing ---
# Comma-separated chat ids allowed to issue commands. Empty -> only TG_CHAT_ID.
ALLOWED_CHAT_IDS = [
    c.strip() for c in os.getenv("ALLOWED_CHAT_IDS", "").split(",") if c.strip()
]
TG_MIN_SEND_INTERVAL = _f("TG_MIN_SEND_INTERVAL", 3.2)  # seconds between sends (~18/min)

# --- Extra metrics ---
LSR_PERIOD = os.getenv("LSR_PERIOD", "5m")   # long/short ratio granularity

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


def validate() -> None:
    missing = []
    if not TG_BOT_TOKEN:
        missing.append("TG_BOT_TOKEN")
    if not TG_CHAT_ID:
        missing.append("TG_CHAT_ID")
    if missing:
        raise SystemExit(
            "Missing required env vars: %s\n"
            "Copy .env.example to .env and fill them in." % ", ".join(missing)
        )
