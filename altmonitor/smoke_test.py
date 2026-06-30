"""Smoke test: verify the data path + history + command logic (no Telegram needed)."""
import asyncio
import json
import os

import aiohttp
import websockets

import config
from binance_rest import BinanceREST
from commands import CommandHandler
from history import History
from metrics import fetch_lsr
from models import Alert
from monitor import build_message, quadrant
from oi_tracker import OITracker
from state import RuntimeSettings, normalize_symbol
from symbols import fetch_usdt_perpetuals


async def main() -> None:
    connector = aiohttp.TCPConnector(ssl=config.ssl_context())
    async with aiohttp.ClientSession(connector=connector) as session:
        rest = BinanceREST(session)

        # 1. symbols
        syms = await fetch_usdt_perpetuals(session)
        print(f"[1] symbols: {len(syms)} (sample: {syms[:5]})")
        assert len(syms) > 100

        # 2. OI fetch via shared REST client
        oi = OITracker(rest)
        s, val = await oi._fetch_one("BTCUSDT")
        print(f"[2] OI BTCUSDT: {val}")
        assert val and val > 0

        # 3. WS subscribe ack (data frames may be blocked in sandbox)
        async with websockets.connect(
            config.WS_BASE, ping_interval=20, ssl=config.ssl_context()
        ) as ws:
            await ws.send(json.dumps(
                {"method": "SUBSCRIBE", "params": ["btcusdt@kline_1m"], "id": 1}))
            ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            print(f"[3] WS subscribe ack: {ack}")
            assert "result" in ack

        # 5. command dispatch (pure logic, no network)
        config.STATE_FILE = "/tmp/altmonitor_test_state.json"
        if os.path.exists(config.STATE_FILE):
            os.remove(config.STATE_FILE)
        st = RuntimeSettings()
        ch = CommandHandler(tg=None, settings=st)
        print("[5a]", ch._dispatch("/set_pump", ["5"]))
        print("[5b]", ch._dispatch("/watch", ["sol", "doge"]))
        assert st.pump_threshold == 5.0
        assert normalize_symbol("sol") == "SOLUSDT"
        assert st.is_watched("SOLUSDT") and not st.is_watched("BTCUSDT")
        print("[5c]", ch._dispatch("/watch", []))   # clear
        assert st.is_watched("BTCUSDT")
        ch._dispatch("/mute", ["btc"])
        assert not st.is_watched("BTCUSDT")

        # 6. LSR (long/short ratio) live fetch
        lsr = await fetch_lsr(rest, "BTCUSDT")
        print(f"[6] BTCUSDT LSR: {lsr}")
        assert lsr and lsr > 0

        # 7. history store: insert + query
        config.DB_FILE = "/tmp/altmonitor_test.db"
        for p in (config.DB_FILE, config.DB_FILE + "-wal", config.DB_FILE + "-shm"):
            if os.path.exists(p):
                os.remove(p)
        hist = History()
        a1 = Alert(ts=1000.0, symbol="SWARMSUSDT", price=0.006, change_pct=3.2,
                   oi_change=1.9, amplitude=7.4, lsr=1.85)
        a2 = Alert(ts=2000.0, symbol="PLAYUSDT", price=0.029, change_pct=-14.9,
                   oi_change=-3.2, amplitude=20.9, lsr=0.7)
        hist.record(a1, quadrant(True, 1.9))
        hist.record(a2, quadrant(False, -3.2))
        print("[7] recent:\n" + hist.recent(limit=5))
        assert "SWARMS" in hist.recent() and "PLAY" in hist.recent()

        # 8. full message with all fields
        print("[8] sample:\n" + build_message(a1, quadrant(True, 1.9)))
        print("\nALL OK")


if __name__ == "__main__":
    asyncio.run(main())
