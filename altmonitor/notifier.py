"""Telegram I/O: paced send queue (text + photo), plus low-level API used by commands."""
import asyncio
import logging
import time

import aiohttp

import config

log = logging.getLogger("notifier")


class Telegram:
    def __init__(self, session: aiohttp.ClientSession):
        self._session = session
        self._base = f"https://api.telegram.org/bot{config.TG_BOT_TOKEN}"
        self._queue: asyncio.Queue = asyncio.Queue()
        self._last_send = 0.0

    # ---------------- low-level ----------------
    async def api(self, method: str, payload: dict | None = None,
                  data: aiohttp.FormData | None = None) -> dict | None:
        url = f"{self._base}/{method}"
        for attempt in range(3):
            try:
                kw = {"timeout": aiohttp.ClientTimeout(total=30)}
                if data is not None:
                    kw["data"] = data
                else:
                    kw["json"] = payload or {}
                async with self._session.post(url, **kw) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    body = await resp.text()
                    if resp.status == 429:
                        try:
                            retry = (await resp.json())["parameters"]["retry_after"]
                        except Exception:  # noqa: BLE001
                            retry = 3 * (attempt + 1)
                        log.warning("Telegram 429, wait %ss", retry)
                        await asyncio.sleep(float(retry) + 0.5)
                        continue
                    log.warning("Telegram %s %s: %s", method, resp.status, body[:200])
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                log.warning("Telegram %s failed (%s), retry %d", method, e, attempt + 1)
            await asyncio.sleep(1.5 * (attempt + 1))
        log.error("Telegram %s gave up", method)
        return None

    async def send_text(self, text: str, chat_id: str | None = None) -> None:
        await self.api("sendMessage", {
            "chat_id": chat_id or config.TG_CHAT_ID,
            "text": text,
            "disable_web_page_preview": True,
        })

    # ---------------- paced queue (for alerts) ----------------
    def enqueue_text(self, text: str) -> None:
        self._queue.put_nowait(text)

    async def _pace(self) -> None:
        gap = config.TG_MIN_SEND_INTERVAL - (time.monotonic() - self._last_send)
        if gap > 0:
            await asyncio.sleep(gap)
        self._last_send = time.monotonic()

    async def run_sender(self) -> None:
        """Drain the alert queue, pacing sends to respect Telegram per-chat limits."""
        while True:
            text = await self._queue.get()
            try:
                await self._pace()
                await self.send_text(text)
            except Exception as e:  # noqa: BLE001
                log.warning("send job failed: %s", e)
            finally:
                self._queue.task_done()
