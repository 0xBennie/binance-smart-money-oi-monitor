"""Binance full-market 1-minute price-move + OI monitor -> Telegram alerts."""
import asyncio
import json
import logging
import time

import aiohttp
import websockets

import config
import metrics
from binance_rest import BinanceREST
from commands import CommandHandler
from history import History
from models import Alert
from notifier import Telegram
from oi_tracker import OITracker
from state import RuntimeSettings
from symbols import fetch_usdt_perpetuals

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
log = logging.getLogger("monitor")

SUBSCRIBE_CHUNK = 200


def _fmt_price(p: float) -> str:
    """Show enough significant digits for small-cap tokens."""
    if p >= 1:
        return f"{p:,.4f}".rstrip("0").rstrip(".")
    return f"{p:.8f}".rstrip("0").rstrip(".")


def quadrant(price_up: bool, oi_change: float | None) -> str:
    if oi_change is None:
        return "价↑仓N/A" if price_up else "价↓仓N/A"
    oi_up = oi_change >= 0
    if price_up and oi_up:
        return "价↑仓↑ 多头进场"
    if price_up and not oi_up:
        return "价↑仓↓ 空头回补/逼空"
    if not price_up and oi_up:
        return "价↓仓↑ 空头进场"
    return "价↓仓↓ 多头平仓"


def build_message(a: Alert, quad: str) -> str:
    price_up = a.change_pct >= 0
    head = "🟢 PUMP ALERT" if price_up else "🔴 DUMP ALERT"
    now = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(a.ts))
    oi_line = f"{a.oi_change:+.1f}%" if a.oi_change is not None else "N/A"
    chg_label = "涨幅" if price_up else "跌幅"
    lines = [
        f"{head} · {quad}",
        f"📌 {a.base}  ({a.symbol})",
        f"💲 价格: {_fmt_price(a.price)}",
        f"📈 1min {chg_label}: {a.change_pct:+.1f}%",
        f"📊 1min OI: {oi_line}",
    ]
    if a.amplitude is not None:
        lines.append(f"📐 振幅: {a.amplitude:.1f}%")
    if a.lsr is not None:
        lines.append(f"⚖️ 多空比: {a.lsr:.2f} ({'偏多' if a.lsr >= 1 else '偏空'})")
    lines.append(f"🕐 {now}")
    return "\n".join(lines)


class Monitor:
    def __init__(self, session: aiohttp.ClientSession):
        self._rest = BinanceREST(session)
        self._tg = Telegram(session)
        self._settings = RuntimeSettings()
        self._oi = OITracker(self._rest)
        self._history = History() if config.HISTORY_ENABLED else None
        self._cmds = CommandHandler(self._tg, self._settings, self._history)
        self._symbols: list[str] = []
        self._last_alert: dict[str, float] = {}
        self._alerted_candle: dict[str, int] = {}

    async def _load_symbols(self) -> None:
        self._symbols = await fetch_usdt_perpetuals(self._rest._session)
        self._oi.set_symbols(self._symbols)

    async def _symbol_refresher(self) -> None:
        while True:
            await asyncio.sleep(config.SYMBOLS_REFRESH_SEC)
            try:
                await self._load_symbols()
            except Exception as e:  # noqa: BLE001
                log.warning("symbol refresh failed: %s", e)

    def _should_alert(self, symbol: str, candle_start: int) -> bool:
        if self._alerted_candle.get(symbol) == candle_start:
            return False
        last = self._last_alert.get(symbol)
        if last is not None and (time.monotonic() - last) < self._settings.cooldown_sec:
            return False
        return True

    async def _handle_kline(self, msg: dict) -> None:
        k = msg.get("k")
        symbol = msg.get("s")
        if not k or not symbol:
            return
        if not self._settings.is_watched(symbol):
            return
        try:
            open_p = float(k["o"])
            close_p = float(k["c"])
            high_p = float(k["h"])
            low_p = float(k["l"])
        except (KeyError, ValueError):
            return
        if open_p == 0:
            return
        change = (close_p - open_p) / open_p * 100.0

        if not (change >= self._settings.pump_threshold
                or change <= self._settings.dump_threshold):
            return

        candle_start = int(k["t"])
        if not self._should_alert(symbol, candle_start):
            return

        self._alerted_candle[symbol] = candle_start
        self._last_alert[symbol] = time.monotonic()

        oi_change = self._oi.change_pct(symbol)
        amplitude = (high_p - low_p) / open_p * 100.0
        lsr = await metrics.fetch_lsr(self._rest, symbol)
        alert = Alert(
            ts=time.time(), symbol=symbol, price=close_p, change_pct=change,
            oi_change=oi_change, amplitude=amplitude, lsr=lsr,
        )
        quad = quadrant(change >= 0, oi_change)
        text = build_message(alert, quad)
        log.info("ALERT %s %+.2f%% oi=%s lsr=%s", symbol, change, oi_change, lsr)
        if self._history:
            self._history.record(alert, quad)

        self._tg.enqueue_text(text)

    async def _ws_loop(self) -> None:
        backoff = 1
        while True:
            try:
                async with websockets.connect(
                    config.WS_BASE,
                    ping_interval=20,
                    ping_timeout=20,
                    max_queue=None,
                    ssl=config.ssl_context(),
                ) as ws:
                    await self._subscribe(ws)
                    backoff = 1
                    log.info("WS connected, subscribed %d streams", len(self._symbols))
                    async for raw in ws:
                        # Never let one malformed frame or a handler error tear
                        # down the socket — that would force a full resubscribe
                        # of every stream. Isolate per-message failures instead.
                        try:
                            msg = json.loads(raw)
                        except (ValueError, TypeError):
                            continue
                        if msg.get("e") == "kline":
                            try:
                                await self._handle_kline(msg)
                            except Exception as e:  # noqa: BLE001
                                log.warning("handle_kline error: %s", e)
            except Exception as e:  # noqa: BLE001
                log.warning("WS dropped (%s), reconnect in %ds", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    async def _subscribe(self, ws) -> None:
        streams = [f"{s.lower()}@kline_1m" for s in self._symbols]
        req_id = 1
        for i in range(0, len(streams), SUBSCRIBE_CHUNK):
            chunk = streams[i : i + SUBSCRIBE_CHUNK]
            await ws.send(json.dumps({"method": "SUBSCRIBE", "params": chunk, "id": req_id}))
            req_id += 1
            await asyncio.sleep(0.25)

    async def run(self) -> None:
        await self._load_symbols()
        s = self._settings
        await self._tg.send_text(
            f"✅ 异动监控已启动\n"
            f"监控 {len(self._symbols)} 个 USDT 永续\n"
            f"阈值: +{s.pump_threshold:.1f}% / {s.dump_threshold:.1f}% (1min)\n"
            f"冷却: {s.cooldown_sec}s\n"
            f"发送 /help 查看命令"
        )
        await asyncio.gather(
            self._ws_loop(),
            self._oi.run(),
            self._symbol_refresher(),
            self._tg.run_sender(),
            self._cmds.run(),
        )


async def main() -> None:
    config.validate()
    connector = aiohttp.TCPConnector(ssl=config.ssl_context())
    async with aiohttp.ClientSession(connector=connector) as session:
        await Monitor(session).run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
