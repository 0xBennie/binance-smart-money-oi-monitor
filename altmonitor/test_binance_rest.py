"""Unit tests for BinanceREST rate-limit back-off (no network).

Uses a tiny fake aiohttp session so we can assert how a 429/418 Retry-After maps
onto the shared pause, without ever touching the wire.
"""
import asyncio
import time
import unittest

from binance_rest import BinanceREST


class _FakeResp:
    """Stands in for the aiohttp response context manager returned by session.get."""

    def __init__(self, status: int, headers: dict | None = None, payload=None):
        self.status = status
        self.headers = headers or {}
        self._payload = payload

    async def json(self):
        return self._payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeSession:
    def __init__(self, responses):
        # last response repeats if we run out (so extra retries just re-trip)
        self._responses = list(responses)
        self.calls = 0

    def get(self, url, params=None, timeout=None):
        resp = self._responses[min(self.calls, len(self._responses) - 1)]
        self.calls += 1
        return resp


class TestBackoffCap(unittest.TestCase):
    def _run(self, responses, retries=0):
        rest = BinanceREST(_FakeSession(responses))
        result = asyncio.run(rest.get_json("/whatever", retries=retries))
        return rest, result

    def test_418_large_retry_after_is_clamped(self):
        # Binance can hand a 418 a Retry-After measured in hours; the LOCAL pause
        # must be capped at 120s so one call can't await the whole ban.
        rest, result = self._run([_FakeResp(418, {"Retry-After": "100000"})])
        self.assertIsNone(result)
        self.assertTrue(rest.paused)
        remaining = rest._pause_until - time.monotonic()
        self.assertLessEqual(remaining, 120.0 + 1.0)
        self.assertGreater(remaining, 60.0)  # genuinely paused, near the 120s cap

    def test_429_large_retry_after_is_clamped(self):
        rest, result = self._run([_FakeResp(429, {"Retry-After": "100000"})])
        self.assertIsNone(result)
        remaining = rest._pause_until - time.monotonic()
        self.assertLessEqual(remaining, 120.0 + 1.0)
        self.assertGreater(remaining, 60.0)

    def test_missing_retry_after_defaults_to_5s(self):
        rest, result = self._run([_FakeResp(418)])  # no header
        self.assertIsNone(result)
        remaining = rest._pause_until - time.monotonic()
        self.assertLessEqual(remaining, 5.0 + 1.0)
        self.assertGreater(remaining, 1.0)

    def test_success_returns_payload(self):
        rest, result = self._run([_FakeResp(200, payload={"ok": 1})])
        self.assertEqual(result, {"ok": 1})
        self.assertFalse(rest.paused)


if __name__ == "__main__":
    unittest.main()
