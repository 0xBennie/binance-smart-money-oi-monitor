"""Pure helpers for the setup wizard: .env read/merge/write, token redaction,
Telegram getUpdates chat extraction, token shape validation.

No network, no interactivity — everything here is unit-tested. All I/O side
effects are confined to write_env_file (file read/write + backup).
"""
import os
import re

_KEY_LINE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")
_TOKEN_RE = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{30,}$")


def parse_env(text: str) -> dict:
    """Parse KEY=VALUE lines into a dict. Skips blanks and # comments.
    Value is everything after the first '=' (so values may contain '=')."""
    out: dict = {}
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, _, val = s.partition("=")
        # Drop an inline comment (this tool's values are tokens/ids/numbers/
        # symbols and never contain '#'), matching python-dotenv's behavior.
        out[key.strip()] = val.split("#", 1)[0].strip()
    return out


def merge_env(existing_text: str, updates: dict) -> str:
    """Return existing_text with `updates` applied: matching keys rewritten in
    place (whole line -> KEY=value), every other line preserved verbatim
    (comments, inline notes, unrelated keys). Missing keys are appended.
    Idempotent. Matches whole keys only (not substrings)."""
    applied = set()
    out_lines = []
    for line in existing_text.splitlines():
        m = _KEY_LINE_RE.match(line)
        if m and m.group(1) in updates:
            key = m.group(1)
            out_lines.append(f"{key}={updates[key]}")
            applied.add(key)
        else:
            out_lines.append(line)
    for key, val in updates.items():
        if key not in applied:
            out_lines.append(f"{key}={val}")
    result = "\n".join(out_lines)
    if not existing_text or existing_text.endswith("\n"):
        result += "\n"
    return result


def redact_token(tok: str) -> str:
    """Mask a bot token for display/logs: '1234…abcd'. Short/empty -> '***'."""
    if not tok or len(tok) < 12:
        return "***"
    return f"{tok[:4]}…{tok[-4:]}"


def extract_chat(updates_json: dict):
    """From a Telegram getUpdates response, return the most recent chat as
    {'id': str, 'type': str, 'title': str}, or None if no usable update."""
    results = (updates_json or {}).get("result") or []
    for upd in reversed(results):
        msg = upd.get("message") or upd.get("channel_post")
        if not msg:
            continue
        chat = msg.get("chat")
        if not chat or "id" not in chat:
            continue
        title = (
            chat.get("title")
            or chat.get("first_name")
            or chat.get("username")
            or ""
        )
        return {"id": str(chat["id"]), "type": chat.get("type", ""), "title": title}
    return None


def valid_token_shape(tok: str) -> bool:
    """Cheap client-side sanity check for a bot token '<digits>:<secret>'."""
    return bool(_TOKEN_RE.match(tok or ""))


def write_env_file(path: str, updates: dict) -> None:
    """Merge `updates` into the .env at `path` and write it back. If the file
    exists, its previous content is backed up to `<path>.bak` first. The file
    is chmod 600 (best effort) since it holds secrets."""
    existing = ""
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            existing = f.read()
        with open(path + ".bak", "w", encoding="utf-8") as f:
            f.write(existing)
    merged = merge_env(existing, updates)
    with open(path, "w", encoding="utf-8") as f:
        f.write(merged)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
