"""Minimal, dependency-light Telegram Bot API client for the setup wizard.

Uses only the standard library (urllib) so `python setup.py` works before the
user has pip-installed the monitor's runtime deps. The long-running monitor uses
the richer aiohttp client in notifier.py; this is just for one-shot onboarding.
"""
import json
import ssl
import urllib.parse
import urllib.request

import env_io


def _ssl_context() -> ssl.SSLContext:
    """certifi CA bundle when available (fixes python.org-on-macOS missing CAs),
    else the system default."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def _api(token: str, method: str, params: dict | None = None, timeout: int = 30):
    """POST to the Bot API. Returns parsed JSON dict, or None on any failure."""
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = urllib.parse.urlencode(params).encode() if params else None
    req = urllib.request.Request(url, data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as r:
            return json.loads(r.read())
    except Exception:  # noqa: BLE001 — network/JSON/HTTP errors all mean "no result"
        return None


def get_me(token: str):
    """Validate the token. Returns the bot's user object (has 'username') or None."""
    r = _api(token, "getMe")
    if r and r.get("ok"):
        return r["result"]
    return None


def clear_backlog(token: str) -> int:
    """Discard any pending updates so we only react to a fresh message. Returns
    the offset to poll from next."""
    r = _api(token, "getUpdates", {"offset": -1, "timeout": 0})
    if r and r.get("result"):
        return r["result"][-1]["update_id"] + 1
    return 0


def poll_for_chat(token: str, offset: int, timeout: int = 25):
    """Long-poll getUpdates once. Returns (chat|None, new_offset). chat is the
    dict from env_io.extract_chat (id/type/title)."""
    r = _api(token, "getUpdates", {"offset": offset, "timeout": timeout}, timeout=timeout + 5)
    if not r or not r.get("ok"):
        return None, offset
    results = r.get("result", [])
    if results:
        offset = results[-1]["update_id"] + 1
    return env_io.extract_chat(r), offset


def send_message(token: str, chat_id: str, text: str) -> bool:
    """Send a plain-text message. Returns True on success."""
    r = _api(token, "sendMessage", {"chat_id": chat_id, "text": text})
    return bool(r and r.get("ok"))
