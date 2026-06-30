"""Telegram command handler via getUpdates long-polling (no public IP / webhook needed)."""
import asyncio
import logging

import config
from notifier import Telegram
from state import RuntimeSettings, normalize_symbol

log = logging.getLogger("commands")

HELP = (
    "🤖 异动监控命令\n"
    "/status — 查看当前配置\n"
    "/set_pump <数> — 涨幅阈值%，如 /set_pump 5\n"
    "/set_dump <数> — 跌幅阈值%（负数），如 /set_dump -5\n"
    "/set_oi <1m%> [5m%] — OI异动阈值，如 /set_oi 3 6（0=关）\n"
    "/set_vol <倍> — 爆量阈值（成交额/中位），如 /set_vol 5（0=关）\n"
    "/cooldown <秒> — 同币告警冷却\n"
    "/watch <币...> — 只看这些币（留空=全部），如 /watch sol doge\n"
    "/unwatch <币...> — 移出关注列表\n"
    "/mute <币...> — 屏蔽某些币\n"
    "/unmute <币...> — 取消屏蔽\n"
    "/history [N] [币] — 最近 N 条告警，如 /history 20 sol\n"
    "/stats [小时] — 异动榜，如 /stats 24\n"
    "/help — 帮助"
)


class CommandHandler:
    def __init__(self, tg: Telegram, settings: RuntimeSettings, history=None):
        self._tg = tg
        self._settings = settings
        self._history = history
        self._allowed = config.allowed_chat_ids()
        self._offset = 0

    async def run(self) -> None:
        # discard backlog so we don't replay old commands on restart
        init = await self._tg.api("getUpdates", {"offset": -1, "timeout": 0})
        if init and init.get("result"):
            self._offset = init["result"][-1]["update_id"] + 1
        log.info("Command handler listening")
        while True:
            # Poll timeout (25s) stays below the client's 30s total timeout so the
            # server returns first instead of the request timing out client-side.
            resp = await self._tg.api("getUpdates", {"offset": self._offset, "timeout": 25})
            if not resp or not resp.get("ok"):
                await asyncio.sleep(3)   # avoid a busy-loop when the API is down
                continue
            for upd in resp.get("result", []):
                self._offset = upd["update_id"] + 1
                await self._handle(upd)

    async def _handle(self, upd: dict) -> None:
        msg = upd.get("message") or upd.get("channel_post")
        if not msg:
            return
        chat_id = str(msg.get("chat", {}).get("id", ""))
        text = (msg.get("text") or "").strip()
        if not text.startswith("/"):
            return
        if self._allowed and chat_id not in self._allowed:
            log.info("ignoring command from unauthorized chat %s", chat_id)
            return

        parts = text.split()
        cmd = parts[0].split("@")[0].lower()   # strip /cmd@BotName
        args = parts[1:]
        reply = self._dispatch(cmd, args)
        if reply:
            await self._tg.send_text(reply, chat_id=chat_id)

    def _dispatch(self, cmd: str, args: list[str]) -> str:
        s = self._settings
        try:
            if cmd in ("/start", "/help"):
                return HELP
            if cmd == "/status":
                return s.status_text()
            if cmd == "/set_pump":
                s.pump_threshold = abs(float(args[0]))
                s.save()
                return f"✅ 涨幅阈值 = +{s.pump_threshold:.1f}%"
            if cmd == "/set_dump":
                v = float(args[0])
                s.dump_threshold = -abs(v)
                s.save()
                return f"✅ 跌幅阈值 = {s.dump_threshold:.1f}%"
            if cmd == "/set_oi":
                s.oi_surge_1m = max(0.0, float(args[0]))
                if len(args) > 1:
                    s.oi_surge_5m = max(0.0, float(args[1]))
                s.save()
                oi1 = f"{s.oi_surge_1m:.1f}%" if s.oi_surge_1m > 0 else "关"
                oi5 = f"{s.oi_surge_5m:.1f}%" if s.oi_surge_5m > 0 else "关"
                return f"✅ OI异动: 1m {oi1} / 5m {oi5}"
            if cmd == "/set_vol":
                s.vol_burst_mult = max(0.0, float(args[0]))
                s.save()
                return f"✅ 爆量阈值 = {s.vol_burst_mult:.1f}x" if s.vol_burst_mult > 0 else "✅ 爆量监控已关闭"
            if cmd == "/cooldown":
                s.cooldown_sec = max(0, int(args[0]))
                s.save()
                return f"✅ 冷却 = {s.cooldown_sec}s"
            if cmd == "/watch":
                if not args:
                    s.watchlist.clear()
                    s.save()
                    return "✅ 关注列表已清空 → 监控全部币种"
                added = {normalize_symbol(a) for a in args if normalize_symbol(a)}
                s.watchlist |= added
                s.save()
                return f"✅ 关注列表: {', '.join(sorted(s.watchlist))}"
            if cmd == "/unwatch":
                rem = {normalize_symbol(a) for a in args}
                s.watchlist -= rem
                s.save()
                wl = ", ".join(sorted(s.watchlist)) if s.watchlist else "全部币种"
                return f"✅ 关注列表: {wl}"
            if cmd == "/mute":
                s.muted |= {normalize_symbol(a) for a in args if normalize_symbol(a)}
                s.save()
                return f"✅ 已屏蔽: {', '.join(sorted(s.muted)) or '无'}"
            if cmd == "/unmute":
                s.muted -= {normalize_symbol(a) for a in args}
                s.save()
                return f"✅ 屏蔽列表: {', '.join(sorted(s.muted)) or '无'}"
            if cmd == "/history":
                if self._history is None:
                    return "历史记录未开启"
                limit, sym = 10, None
                for a in args:
                    if a.isdigit():
                        limit = min(int(a), 50)
                    else:
                        sym = normalize_symbol(a)
                return self._history.recent(limit=limit, symbol=sym)
            if cmd == "/stats":
                if self._history is None:
                    return "历史记录未开启"
                hours = int(args[0]) if args and args[0].isdigit() else 24
                return self._history.stats(hours=hours)
        except (IndexError, ValueError):
            return f"参数错误，看 /help"
        return None
