"""Unit tests for ssh_util command builders. No real SSH — assert argv shape."""
import unittest

import ssh_util


class TestParseTarget(unittest.TestCase):
    def test_user_host_port(self):
        c = ssh_util.parse_target("root@1.2.3.4:2222")
        self.assertEqual(c["user"], "root")
        self.assertEqual(c["host"], "1.2.3.4")
        self.assertEqual(c["port"], 2222)

    def test_default_port(self):
        c = ssh_util.parse_target("ubuntu@example.com")
        self.assertEqual(c["user"], "ubuntu")
        self.assertEqual(c["host"], "example.com")
        self.assertEqual(c["port"], 22)

    def test_host_only(self):
        c = ssh_util.parse_target("1.2.3.4")
        self.assertIsNone(c["user"])
        self.assertEqual(c["host"], "1.2.3.4")
        self.assertEqual(c["port"], 22)


class TestBuildSshArgv(unittest.TestCase):
    def _conn(self, **kw):
        base = {"user": "root", "host": "h", "port": 22, "key": None, "password": False}
        base.update(kw)
        return base

    def test_key_mode_has_no_sshpass(self):
        argv = ssh_util.build_ssh_argv(self._conn(key="/k"), "echo ok")
        self.assertNotIn("sshpass", argv)
        self.assertIn("ssh", argv)
        self.assertIn("-i", argv)
        self.assertIn("/k", argv)
        self.assertIn("root@h", argv)
        self.assertEqual(argv[-1], "echo ok")

    def test_password_mode_prefixes_sshpass(self):
        argv = ssh_util.build_ssh_argv(self._conn(password=True), "echo ok")
        self.assertEqual(argv[:2], ["sshpass", "-e"])
        self.assertIn("ssh", argv)

    def test_batch_adds_batchmode(self):
        argv = ssh_util.build_ssh_argv(self._conn(key="/k"), "echo ok", batch=True)
        self.assertIn("BatchMode=yes", argv)

    def test_no_batch_omits_batchmode(self):
        argv = ssh_util.build_ssh_argv(self._conn(), "echo ok")
        self.assertNotIn("BatchMode=yes", argv)

    def test_custom_port(self):
        argv = ssh_util.build_ssh_argv(self._conn(port=2222), "echo ok")
        self.assertIn("-p", argv)
        self.assertIn("2222", argv)

    def test_host_only_target(self):
        argv = ssh_util.build_ssh_argv(self._conn(user=None), "echo ok")
        self.assertIn("h", argv)
        self.assertNotIn("root@h", argv)

    def test_accept_new_hostkey(self):
        argv = ssh_util.build_ssh_argv(self._conn(), "echo ok")
        self.assertIn("StrictHostKeyChecking=accept-new", argv)


class TestSshEString(unittest.TestCase):
    def test_contains_port_and_key_no_sshpass(self):
        s = ssh_util.ssh_e_string({"user": "root", "host": "h", "port": 2222, "key": "/k", "password": True})
        self.assertIn("ssh", s)
        self.assertIn("-p 2222", s)
        self.assertIn("-i /k", s)
        self.assertNotIn("sshpass", s)  # sshpass wraps rsync, not the -e string


class TestBuildRsyncArgv(unittest.TestCase):
    def _conn(self, **kw):
        base = {"user": "root", "host": "h", "port": 22, "key": "/k", "password": False}
        base.update(kw)
        return base

    def test_excludes_present(self):
        argv = ssh_util.build_rsync_argv(
            self._conn(), "/local/dir", "/opt/altmonitor", excludes=[".git", ".env", "*.db"]
        )
        joined = " ".join(argv)
        self.assertIn("--exclude .git", joined)
        self.assertIn("--exclude .env", joined)
        self.assertIn("--exclude *.db", joined)

    def test_has_ssh_transport_and_dst(self):
        argv = ssh_util.build_rsync_argv(self._conn(), "/local/dir", "/opt/altmonitor", excludes=[])
        self.assertIn("rsync", argv)
        self.assertIn("-e", argv)
        self.assertIn("root@h:/opt/altmonitor", argv)

    def test_source_has_trailing_slash(self):
        argv = ssh_util.build_rsync_argv(self._conn(), "/local/dir", "/opt/altmonitor", excludes=[])
        # copying contents, not the dir itself
        self.assertIn("/local/dir/", argv)

    def test_password_prefixes_sshpass(self):
        argv = ssh_util.build_rsync_argv(self._conn(password=True), "/local/dir", "/opt/altmonitor", excludes=[])
        self.assertEqual(argv[:2], ["sshpass", "-e"])


class TestPickCompose(unittest.TestCase):
    def test_v2_plugin(self):
        self.assertEqual(ssh_util.pick_compose("V2\n"), "docker compose")

    def test_v1_standalone(self):
        self.assertEqual(ssh_util.pick_compose("V1"), "docker-compose")

    def test_none_available(self):
        self.assertIsNone(ssh_util.pick_compose("NONE"))

    def test_garbage(self):
        self.assertIsNone(ssh_util.pick_compose(""))


class TestBuildScpArgv(unittest.TestCase):
    def _conn(self, **kw):
        base = {"user": "root", "host": "h", "port": 2222, "key": "/k", "password": False}
        base.update(kw)
        return base

    def test_uses_uppercase_port_flag(self):
        argv = ssh_util.build_scp_argv(self._conn(), "/local/.env", "/opt/altmonitor/.env")
        # scp's port flag is -P (uppercase), unlike ssh's -p
        self.assertIn("-P", argv)
        self.assertIn("2222", argv)
        self.assertNotIn("-p", argv)

    def test_dst_target(self):
        argv = ssh_util.build_scp_argv(self._conn(), "/local/.env", "/opt/altmonitor/.env")
        self.assertIn("scp", argv)
        self.assertIn("/local/.env", argv)
        self.assertIn("root@h:/opt/altmonitor/.env", argv)

    def test_password_prefixes_sshpass(self):
        argv = ssh_util.build_scp_argv(self._conn(password=True), "/local/.env", "/opt/altmonitor/.env")
        self.assertEqual(argv[:2], ["sshpass", "-e"])


if __name__ == "__main__":
    unittest.main()
