"""Unit tests for links.smart_money_link (pure, no network)."""
import unittest

import links


class TestSmartMoneyLink(unittest.TestCase):
    def test_full_symbol(self):
        self.assertEqual(
            links.smart_money_link("BEATUSDT"),
            "https://www.binance.com/zh-CN/smart-money/signal/BEATUSDT",
        )

    def test_appends_usdt(self):
        self.assertEqual(
            links.smart_money_link("beat"),
            "https://www.binance.com/zh-CN/smart-money/signal/BEATUSDT",
        )

    def test_strips_whitespace_and_uppercases(self):
        self.assertEqual(
            links.smart_money_link("  eth "),
            "https://www.binance.com/zh-CN/smart-money/signal/ETHUSDT",
        )


if __name__ == "__main__":
    unittest.main()
