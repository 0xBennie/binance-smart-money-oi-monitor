"""Command builders + thin runners for remote deploy over the system ssh/scp/rsync.

The argv-building functions are pure (no side effects) and unit-tested. Password
auth is handled by wrapping the command in `sshpass -e` (password passed via the
SSHPASS environment variable — never on the command line, never logged).

Key detail: ssh uses '-p' for port, scp uses '-P'. rsync tunnels through ssh via
the '-e' string, which uses ssh's '-p'.
"""
import subprocess

_COMMON = ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10"]


def parse_target(s: str) -> dict:
    """Parse 'user@host[:port]' -> {'user', 'host', 'port'}. user may be None.
    (IPv6 literals with ports are not supported — document 'use ~/.ssh/config'.)"""
    s = s.strip()
    if "@" in s:
        user, rest = s.split("@", 1)
        user = user or None
    else:
        user, rest = None, s
    port = 22
    if ":" in rest:
        head, _, tail = rest.rpartition(":")
        if tail.isdigit():
            rest, port = head, int(tail)
    return {"user": user, "host": rest, "port": port}


def _target(conn: dict) -> str:
    user, host = conn.get("user"), conn["host"]
    return f"{user}@{host}" if user else host


def build_ssh_argv(conn: dict, remote_cmd: str, batch: bool = False) -> list:
    """argv for running `remote_cmd` on the host. batch=True forces key-only,
    non-interactive auth (used to probe whether key auth works)."""
    argv = []
    if conn.get("password"):
        argv += ["sshpass", "-e"]
    argv.append("ssh")
    argv += _COMMON
    if batch:
        argv += ["-o", "BatchMode=yes"]
    argv += ["-p", str(conn.get("port", 22))]
    if conn.get("key"):
        argv += ["-i", conn["key"]]
    argv.append(_target(conn))
    if remote_cmd:
        argv.append(remote_cmd)
    return argv


def ssh_e_string(conn: dict) -> str:
    """The `-e` transport string rsync uses to tunnel over ssh. No sshpass here —
    sshpass wraps the whole rsync invocation instead."""
    parts = ["ssh"] + _COMMON + ["-p", str(conn.get("port", 22))]
    if conn.get("key"):
        parts += ["-i", conn["key"]]
    return " ".join(parts)


def build_rsync_argv(conn: dict, local_dir: str, remote_dir: str, excludes: list) -> list:
    """argv to mirror local_dir/ -> host:remote_dir over ssh."""
    argv = []
    if conn.get("password"):
        argv += ["sshpass", "-e"]
    argv += ["rsync", "-az"]
    for ex in excludes:
        argv += ["--exclude", ex]
    argv += ["-e", ssh_e_string(conn)]
    src = local_dir.rstrip("/") + "/"          # trailing slash: copy contents
    argv += [src, f"{_target(conn)}:{remote_dir}"]
    return argv


def build_scp_argv(conn: dict, local_file: str, remote_path: str) -> list:
    """argv to copy a single file (e.g. .env) to host:remote_path."""
    argv = []
    if conn.get("password"):
        argv += ["sshpass", "-e"]
    argv.append("scp")
    argv += _COMMON
    argv += ["-P", str(conn.get("port", 22))]   # scp's port flag is uppercase -P
    if conn.get("key"):
        argv += ["-i", conn["key"]]
    argv += [local_file, f"{_target(conn)}:{remote_path}"]
    return argv


# ---------------- runners (side-effecting; kept thin, not unit-tested) ----------------

def _env_with_password(conn: dict) -> dict | None:
    """Return an env dict carrying SSHPASS when password auth is used, else None."""
    if not conn.get("password"):
        return None
    import os
    env = os.environ.copy()
    env["SSHPASS"] = conn["password"] if isinstance(conn["password"], str) else ""
    return env


def test_conn(conn: dict, batch: bool = False, timeout: int = 15) -> bool:
    """Return True if `ssh ... echo __ok__` succeeds."""
    argv = build_ssh_argv(conn, "echo __ok__", batch=batch)
    try:
        r = subprocess.run(argv, capture_output=True, text=True,
                           timeout=timeout, env=_env_with_password(conn))
        return r.returncode == 0 and "__ok__" in r.stdout
    except (subprocess.TimeoutExpired, OSError):
        return False


def run_remote(conn: dict, remote_cmd: str, timeout: int = 300, capture: bool = False):
    """Run a remote command. Streams to our stdout unless capture=True, in which
    case stdout/stderr are captured on the returned CompletedProcess."""
    argv = build_ssh_argv(conn, remote_cmd)
    return subprocess.run(argv, text=True, timeout=timeout,
                          env=_env_with_password(conn), capture_output=capture)


def sync_dir(conn: dict, local_dir: str, remote_dir: str, excludes: list, timeout: int = 300):
    argv = build_rsync_argv(conn, local_dir, remote_dir, excludes)
    return subprocess.run(argv, text=True, timeout=timeout, env=_env_with_password(conn))


def copy_file(conn: dict, local_file: str, remote_path: str, timeout: int = 120):
    argv = build_scp_argv(conn, local_file, remote_path)
    return subprocess.run(argv, text=True, timeout=timeout, env=_env_with_password(conn))
