"""Unit tests for tg_probe: mock the single network function, assert logic."""
import unittest
from unittest import mock

import tg_probe


class TestGetMe(unittest.TestCase):
    def test_returns_result_when_ok(self):
        with mock.patch.object(tg_probe, "_api", return_value={"ok": True, "result": {"username": "my_bot"}}):
            me = tg_probe.get_me("tok")
        self.assertEqual(me["username"], "my_bot")

    def test_none_when_not_ok(self):
        with mock.patch.object(tg_probe, "_api", return_value={"ok": False, "description": "Unauthorized"}):
            self.assertIsNone(tg_probe.get_me("tok"))

    def test_none_when_network_fails(self):
        with mock.patch.object(tg_probe, "_api", return_value=None):
            self.assertIsNone(tg_probe.get_me("tok"))


class TestPollForChat(unittest.TestCase):
    def test_returns_chat_and_advances_offset(self):
        resp = {"ok": True, "result": [
            {"update_id": 41, "message": {"chat": {"id": 555, "type": "private", "first_name": "Ben"}}},
        ]}
        with mock.patch.object(tg_probe, "_api", return_value=resp):
            chat, offset = tg_probe.poll_for_chat("tok", 0)
        self.assertEqual(chat["id"], "555")
        self.assertEqual(offset, 42)  # last update_id + 1

    def test_no_chat_keeps_offset(self):
        with mock.patch.object(tg_probe, "_api", return_value=None):
            chat, offset = tg_probe.poll_for_chat("tok", 7)
        self.assertIsNone(chat)
        self.assertEqual(offset, 7)

    def test_empty_result_keeps_offset(self):
        with mock.patch.object(tg_probe, "_api", return_value={"ok": True, "result": []}):
            chat, offset = tg_probe.poll_for_chat("tok", 7)
        self.assertIsNone(chat)
        self.assertEqual(offset, 7)


class TestSendMessage(unittest.TestCase):
    def test_true_on_ok(self):
        with mock.patch.object(tg_probe, "_api", return_value={"ok": True, "result": {}}):
            self.assertTrue(tg_probe.send_message("tok", "1", "hi"))

    def test_false_on_failure(self):
        with mock.patch.object(tg_probe, "_api", return_value=None):
            self.assertFalse(tg_probe.send_message("tok", "1", "hi"))


if __name__ == "__main__":
    unittest.main()
