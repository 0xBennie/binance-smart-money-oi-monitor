"""Binance full-market 1-minute price-move + OI monitor -> Telegram alerts."""
import asyncio
import json
import logging
import sys
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
from symbols import base_asset, fetch_usdt_perpetuals
from volume import VolumeTracker

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


def _fmt_usd(v: float) -> str:
    if v >= 1e9:
        return f"${v / 1e9:.2f}B"
    if v >= 1e6:
        return f"${v / 1e6:.2f}M"
    if v >= 1e3:
        return f"${v / 1e3:.1f}K"
    return f"${v:.0f}"


def build_oi_msg(symbol: str, window: str, pct: float, price: float | None) -> str:
    now = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    head = "📈 OI 异动 · 仓位骤增" if pct >= 0 else "📉 OI 异动 · 仓位骤减"
    lines = [
        f"{head}  ({window})",
        f"📌 {base_asset(symbol)}  ({symbol})",
        f"📊 {window} OI 变化: {pct:+.1f}%",
    ]
    if price is not None:
        lines.append(f"💲 价格: {_fmt_price(price)}")
    lines.append(f"🕐 {now}")
    return "\n".join(lines)


def build_vol_msg(symbol: str, price: float, quote_vol: float, ratio: float) -> str:
    now = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    return "\n".join([
        "🔊 爆量 · VOLUME SURGE",
        f"📌 {base_asset(symbol)}  ({symbol})",
        f"💲 价格: {_fmt_price(price)}",
        f"📊 1min 成交额: {_fmt_usd(quote_vol)}  ≈ {ratio:.1f}× 近{config.VOL_BURST_LOOKBACK}根中位",
        f"🕐 {now}",
    ])


class Monitor:
    def __init__(self, session: aiohttp.ClientSession):
        self._rest = BinanceREST(session)
        self._tg = Telegram(session)
        self._settings = RuntimeSettings()
        self._oi = OITracker(self._rest)
        self._oi.set_on_sweep(self._check_oi_surges)
        self._vol = VolumeTracker()
        self._history = History() if config.HISTORY_ENABLED else None
        self._cmds = CommandHandler(self._tg, self._settings, self._history)
        self._symbols: list[str] = []
        self._last_alert: dict[str, float] = {}
        self._alerted_candle: dict[str, int] = {}
        self._last_fire: dict[tuple[str, str], float] = {}  # (symbol, kind) -> monotonic
        self._last_price: dict[str, float] = {}             # latest close per symbol

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

    def _should_fire(self, symbol: str, kind: str) -> bool:
        """Per-(symbol, kind) cooldown so OI/volume alerts don't spam or collide
        with price alerts."""
        last = self._last_fire.get((symbol, kind))
        now = time.monotonic()
        if last is not None and (now - last) < self._settings.cooldown_sec:
            return False
        self._last_fire[(symbol, kind)] = now
        return True

    def _fire_volume(self, symbol: str, price: float, quote_vol: float, ratio: float) -> None:
        text = build_vol_msg(symbol, price, quote_vol, ratio)
        log.info("VOL %s %.1fx (%.0f USDT)", symbol, ratio, quote_vol)
        if self._history:
            self._history.record_event(
                ts=time.time(), symbol=symbol, kind="vol", direction="UP",
                price=price, metric=ratio, note=f"{quote_vol:.0f} USDT",
            )
        self._tg.enqueue_text(text)

    def _fire_oi(self, symbol: str, window: str, pct: float) -> None:
        price = self._last_price.get(symbol)
        text = build_oi_msg(symbol, window, pct, price)
        log.info("OI %s %s %+.1f%%", symbol, window, pct)
        if self._history:
            self._history.record_event(
                ts=time.time(), symbol=symbol, kind="oi",
                direction="UP" if pct >= 0 else "DOWN",
                price=price, oi_change=pct, metric=pct, note=window,
            )
        self._tg.enqueue_text(text)

    def _check_oi_surges(self) -> None:
        """Run after each OI sweep: flag symbols whose OI moved past the 1m/5m
        thresholds. Prefer the 5m signal (stronger) when both trip.

        1m and 5m deliberately share ONE cooldown kind ("oi"): a single ongoing
        OI surge trips both windows, and we want one alert for it, not two — the
        `continue` dedupes within a sweep, the shared cooldown dedupes across
        sweeps. (Price/volume alerts use their own kinds, so they're unaffected.)"""
        s = self._settings
        for symbol in self._oi.latest_symbols():
            if not s.is_watched(symbol):
                continue
            if s.oi_surge_5m > 0:
                p5 = self._oi.change_over(symbol, 300)
                if p5 is not None and abs(p5) >= s.oi_surge_5m and self._should_fire(symbol, "oi"):
                    self._fire_oi(symbol, "5m", p5)
                    continue
            if s.oi_surge_1m > 0:
                p1 = self._oi.change_over(symbol, 60)
                if p1 is not None and abs(p1) >= s.oi_surge_1m and self._should_fire(symbol, "oi"):
                    self._fire_oi(symbol, "1m", p1)

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
        self._last_price[symbol] = close_p

        # Volume burst (爆量): only on a just-closed 1m candle, independent of the
        # price move. record_and_check always updates the baseline; alert is gated
        # by its own per-symbol cooldown.
        if k.get("x"):
            try:
                qv = float(k.get("q", 0))
            except (TypeError, ValueError):
                qv = 0.0
            ratio = self._vol.record_and_check(symbol, qv, self._settings.vol_burst_mult)
            if ratio is not None and self._should_fire(symbol, "vol"):
                self._fire_volume(symbol, close_p, qv, ratio)

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
        oi1 = f"{s.oi_surge_1m:.1f}%" if s.oi_surge_1m > 0 else "关"
        oi5 = f"{s.oi_surge_5m:.1f}%" if s.oi_surge_5m > 0 else "关"
        vol = f"{s.vol_burst_mult:.1f}x" if s.vol_burst_mult > 0 else "关"
        await self._tg.send_text(
            f"✅ 异动监控已启动\n"
            f"监控 {len(self._symbols)} 个 USDT 永续\n"
            f"价格: +{s.pump_threshold:.1f}% / {s.dump_threshold:.1f}% (1min)\n"
            f"OI异动: 1m {oi1} / 5m {oi5}\n"
            f"爆量: {vol}\n"
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


def _handle_missing_config() -> None:
    """Friendly onboarding when Telegram isn't configured yet — no hard crash."""
    missing = config.missing_required()
    print(f"⚠️  还没配置 Telegram({', '.join(missing)})。")
    if sys.stdin.isatty():
        ans = input("现在运行配置向导吗? [Y/n] ").strip().lower()
        if ans in ("", "y", "yes"):
            import setup
            setup.main()
        else:
            print("好的。随时运行 python setup.py 来配置。")
    else:
        print("请运行 python setup.py 配置,或填好 altmonitor/.env(参考 .env.example)。")
    sys.exit(0)


if __name__ == "__main__":
    if "--setup" in sys.argv:
        import setup
        setup.main()
        sys.exit(0)
    if config.missing_required():
        _handle_missing_config()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
