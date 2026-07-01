"""Unit tests for env_io pure helpers (no network, no I/O beyond tmp files)."""
import os
import tempfile
import unittest

import env_io


class TestParseEnv(unittest.TestCase):
    def test_parses_key_value_pairs(self):
        text = "TG_BOT_TOKEN=abc\nTG_CHAT_ID=123\n"
        self.assertEqual(env_io.parse_env(text), {"TG_BOT_TOKEN": "abc", "TG_CHAT_ID": "123"})

    def test_skips_comments_and_blanks(self):
        text = "# a comment\n\nFOO=1\n   \n# another\nBAR=2\n"
        self.assertEqual(env_io.parse_env(text), {"FOO": "1", "BAR": "2"})

    def test_value_may_contain_equals(self):
        text = "TOKEN=aaa:bbb=ccc\n"
        self.assertEqual(env_io.parse_env(text), {"TOKEN": "aaa:bbb=ccc"})

    def test_empty_value(self):
        text = "TG_BOT_TOKEN=\n"
        self.assertEqual(env_io.parse_env(text), {"TG_BOT_TOKEN": ""})

    def test_strips_inline_comments(self):
        # matches python-dotenv: an inline # comment is not part of the value
        text = "TG_BOT_TOKEN=          # bot token from @BotFather\nX=1   # note\n"
        self.assertEqual(env_io.parse_env(text), {"TG_BOT_TOKEN": "", "X": "1"})


class TestMergeEnv(unittest.TestCase):
    def test_updates_existing_key_in_place(self):
        existing = "TG_BOT_TOKEN=\nTG_CHAT_ID=\nPUMP_THRESHOLD=3.0\n"
        out = env_io.merge_env(existing, {"TG_BOT_TOKEN": "7:AAH", "TG_CHAT_ID": "-100"})
        self.assertIn("TG_BOT_TOKEN=7:AAH", out)
        self.assertIn("TG_CHAT_ID=-100", out)
        # untouched key preserved
        self.assertIn("PUMP_THRESHOLD=3.0", out)

    def test_preserves_comments_and_other_lines(self):
        existing = "# header comment\nTG_BOT_TOKEN=old\nOI_SURGE_PCT_1M=3.0      # inline note\n"
        out = env_io.merge_env(existing, {"TG_BOT_TOKEN": "new"})
        self.assertIn("# header comment", out)
        self.assertIn("OI_SURGE_PCT_1M=3.0      # inline note", out)
        self.assertIn("TG_BOT_TOKEN=new", out)
        self.assertNotIn("TG_BOT_TOKEN=old", out)

    def test_appends_missing_keys(self):
        existing = "PUMP_THRESHOLD=3.0\n"
        out = env_io.merge_env(existing, {"TG_BOT_TOKEN": "tok", "TG_CHAT_ID": "42"})
        self.assertIn("PUMP_THRESHOLD=3.0", out)
        self.assertIn("TG_BOT_TOKEN=tok", out)
        self.assertIn("TG_CHAT_ID=42", out)

    def test_idempotent(self):
        existing = "TG_BOT_TOKEN=\n"
        once = env_io.merge_env(existing, {"TG_BOT_TOKEN": "x", "TG_CHAT_ID": "y"})
        twice = env_io.merge_env(once, {"TG_BOT_TOKEN": "x", "TG_CHAT_ID": "y"})
        self.assertEqual(once, twice)

    def test_matches_key_with_surrounding_whitespace(self):
        existing = "  TG_CHAT_ID = old \n"
        out = env_io.merge_env(existing, {"TG_CHAT_ID": "99"})
        self.assertIn("TG_CHAT_ID=99", out)
        self.assertNotIn("old", out)

    def test_does_not_match_key_as_substring(self):
        # MY_TG_BOT_TOKEN must not be updated when we set TG_BOT_TOKEN
        existing = "MY_TG_BOT_TOKEN=keep\n"
        out = env_io.merge_env(existing, {"TG_BOT_TOKEN": "new"})
        self.assertIn("MY_TG_BOT_TOKEN=keep", out)
        self.assertIn("TG_BOT_TOKEN=new", out)


class TestRedactToken(unittest.TestCase):
    def test_redacts_middle(self):
        r = env_io.redact_token("123456:AAHverylongsecretpartxxxxxxxxxxabcd")
        self.assertTrue(r.startswith("1234"))
        self.assertTrue(r.endswith("abcd"))
        self.assertIn("…", r)
        self.assertNotIn("verylongsecret", r)

    def test_short_token_fully_masked(self):
        self.assertEqual(env_io.redact_token("abc"), "***")

    def test_empty(self):
        self.assertEqual(env_io.redact_token(""), "***")


class TestExtractChat(unittest.TestCase):
    def test_private_message(self):
        upd = {"ok": True, "result": [
            {"update_id": 1, "message": {"chat": {"id": 555, "type": "private", "first_name": "Ben"}}},
        ]}
        chat = env_io.extract_chat(upd)
        self.assertEqual(chat["id"], "555")
        self.assertEqual(chat["type"], "private")
        self.assertEqual(chat["title"], "Ben")

    def test_group_uses_title_and_negative_id(self):
        upd = {"ok": True, "result": [
            {"update_id": 9, "message": {"chat": {"id": -1001234, "type": "supergroup", "title": "我的交易群"}}},
        ]}
        chat = env_io.extract_chat(upd)
        self.assertEqual(chat["id"], "-1001234")
        self.assertEqual(chat["title"], "我的交易群")

    def test_channel_post(self):
        upd = {"ok": True, "result": [
            {"update_id": 3, "channel_post": {"chat": {"id": -100999, "type": "channel", "title": "News"}}},
        ]}
        chat = env_io.extract_chat(upd)
        self.assertEqual(chat["id"], "-100999")

    def test_takes_latest_when_multiple(self):
        upd = {"ok": True, "result": [
            {"update_id": 1, "message": {"chat": {"id": 111, "type": "private", "first_name": "A"}}},
            {"update_id": 2, "message": {"chat": {"id": 222, "type": "private", "first_name": "B"}}},
        ]}
        self.assertEqual(env_io.extract_chat(upd)["id"], "222")

    def test_none_when_empty(self):
        self.assertIsNone(env_io.extract_chat({"ok": True, "result": []}))

    def test_none_when_no_chat(self):
        upd = {"ok": True, "result": [{"update_id": 1, "edited_message": {}}]}
        self.assertIsNone(env_io.extract_chat(upd))


class TestValidTokenShape(unittest.TestCase):
    def test_accepts_realistic_token(self):
        self.assertTrue(env_io.valid_token_shape("7123456789:AAHdqZ1234567890abcdefghijklmnopqrst"))

    def test_rejects_missing_colon(self):
        self.assertFalse(env_io.valid_token_shape("7123456789AAHdqZ"))

    def test_rejects_empty(self):
        self.assertFalse(env_io.valid_token_shape(""))

    def test_rejects_too_short_secret(self):
        self.assertFalse(env_io.valid_token_shape("123:abc"))


class TestWriteEnvFile(unittest.TestCase):
    def test_creates_file_and_backs_up_existing(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, ".env")
            with open(path, "w") as f:
                f.write("PUMP_THRESHOLD=3.0\nTG_BOT_TOKEN=old\n")
            env_io.write_env_file(path, {"TG_BOT_TOKEN": "new", "TG_CHAT_ID": "42"})
            with open(path) as f:
                content = f.read()
            self.assertIn("TG_BOT_TOKEN=new", content)
            self.assertIn("TG_CHAT_ID=42", content)
            self.assertIn("PUMP_THRESHOLD=3.0", content)
            # backup exists with the OLD content
            self.assertTrue(os.path.exists(path + ".bak"))
            with open(path + ".bak") as f:
                self.assertIn("TG_BOT_TOKEN=old", f.read())

    def test_creates_new_file_when_absent(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, ".env")
            env_io.write_env_file(path, {"TG_BOT_TOKEN": "tok", "TG_CHAT_ID": "1"})
            self.assertTrue(os.path.exists(path))
            with open(path) as f:
                content = f.read()
            self.assertIn("TG_BOT_TOKEN=tok", content)
            # no backup when there was nothing to back up
            self.assertFalse(os.path.exists(path + ".bak"))


if __name__ == "__main__":
    unittest.main()
