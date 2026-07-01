#!/usr/bin/env python3
"""Remote deploy wizard: ship altmonitor to your own VPS and run it in Docker.

    python deploy.py                 # interactive
    python deploy.py --host 1.2.3.4 --user root
    python deploy.py --update        # re-sync code + restart (keeps data volume)
    python deploy.py --down          # stop the remote stack

Auth: tries SSH key first, falls back to password (via sshpass). The password is
read with getpass, passed to sshpass through the SSHPASS env var, and never
written to disk or logged.
"""
import argparse
import getpass
import os
import shutil
import sys

import env_io
import ssh_util
import tg_probe

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
ENV_LOCAL = os.path.join(SCRIPT_DIR, ".env")

RSYNC_EXCLUDES = [
    ".git", "node_modules", ".venv", "__pycache__", "dist",
    "*.db", "*.db-*", "state.json", ".env", ".env.bak", ".worktrees", "*.pyc",
]


def _abort(msg: str) -> None:
    print(f"   ❌ {msg}")
    sys.exit(1)


def resolve_auth(conn: dict) -> dict:
    print("   ⏳ 测试连接(SSH key / agent)…")
    if ssh_util.test_conn(conn, batch=True):
        print("   ✅ key 认证可用")
        return conn
    print("   key 认证不通(或未配置),改用密码登录。")
    if not shutil.which("sshpass"):
        print("   需要 sshpass 才能用密码登录:")
        print("     macOS:         brew install hudochenkov/sshpass/sshpass")
        print("     Debian/Ubuntu: sudo apt-get install -y sshpass")
        print("   或先用 ssh-copy-id 配好 SSH key 再重试。")
        sys.exit(1)
    conn["password"] = getpass.getpass("   服务器密码(不显示): ")
    print("   ⏳ 测试连接(密码)…")
    if not ssh_util.test_conn(conn):
        _abort("密码认证失败,检查 地址/端口/密码。")
    print("   ✅ 密码认证可用")
    return conn


def ensure_docker(conn: dict) -> None:
    print("   ⏳ 检查 Docker…")
    r = ssh_util.run_remote(conn, "command -v docker || true", capture=True, timeout=30)
    if "docker" not in (r.stdout or ""):
        print("   未装 Docker,自动安装(curl -fsSL https://get.docker.com | sh)…")
        r2 = ssh_util.run_remote(conn, "curl -fsSL https://get.docker.com | sh", timeout=600)
        if r2.returncode != 0:
            _abort("Docker 安装失败,请手动安装后重试。")
    chk = ssh_util.run_remote(conn, "docker compose version || true", capture=True, timeout=30)
    if "compose" not in (chk.stdout or "").lower():
        print("   ⚠️ 未检测到 docker compose v2 插件。多数 get.docker.com 安装已含;"
              "若失败请装 docker-compose-plugin。")


def sync_and_up(conn: dict, remote_dir: str) -> None:
    if not os.path.exists(ENV_LOCAL):
        _abort("本地未找到 altmonitor/.env,请先运行:python setup.py")
    print(f"   ⏳ 同步代码 → {conn['host']}:{remote_dir} …")
    ssh_util.run_remote(conn, f"mkdir -p {remote_dir}/altmonitor", timeout=30)
    r = ssh_util.sync_dir(conn, REPO_ROOT, remote_dir, RSYNC_EXCLUDES, timeout=600)
    if r.returncode != 0:
        _abort("rsync 同步失败。确认本机已装 rsync(macOS/Linux 自带)。")
    print("   ⏳ 传输 .env(加密信道)…")
    r = ssh_util.copy_file(conn, ENV_LOCAL, f"{remote_dir}/altmonitor/.env", timeout=120)
    if r.returncode != 0:
        _abort(".env 传输失败。")
    print("   ⏳ docker compose up -d --build(远程,首次构建较慢)…")
    r = ssh_util.run_remote(conn, f"cd {remote_dir} && docker compose up -d --build", timeout=1200)
    if r.returncode != 0:
        _abort("远程 docker compose 启动失败,登录服务器看 docker compose logs。")


def verify_and_notify(conn: dict, remote_dir: str) -> None:
    r = ssh_util.run_remote(conn, f"cd {remote_dir} && docker compose ps", capture=True, timeout=60)
    out = (r.stdout or "").lower()
    if "running" in out or " up " in out:
        print(f"   ✅ 部署完成!容器在 {conn['host']} 后台运行中。")
    else:
        print("   ⚠️ 已部署,但没确认到 running 状态,登录服务器 docker compose ps 看看。")
    cfg = env_io.parse_env(open(ENV_LOCAL, encoding="utf-8").read())
    tok, chat = cfg.get("TG_BOT_TOKEN"), cfg.get("TG_CHAT_ID")
    if tok and chat:
        tg_probe.send_message(tok, chat, f"✅ 已部署到 {conn['host']} — 异动监控已在服务器后台常驻运行。")
    print(f"\n   更新:  python deploy.py --host {conn['host']} --update")
    print(f"   停止:  python deploy.py --host {conn['host']} --down")
    print(f"   日志:  ssh {conn['host']} 'cd {remote_dir} && docker compose logs -f'")


def collect_conn(args) -> dict:
    if args.host:
        conn = {"user": args.user or "root", "host": args.host,
                "port": args.port or 22, "key": args.key, "password": False}
    else:
        print("🌐 部署到你的服务器 / Deploy to your server")
        try:
            target = input("① 服务器 user@host[:port] > ").strip()
        except (EOFError, KeyboardInterrupt):
            sys.exit(1)
        conn = ssh_util.parse_target(target)
        if not conn.get("user"):
            u = input("   用户名(默认 root) > ").strip()
            conn["user"] = u or "root"
        conn["key"] = args.key
        conn["password"] = False
    return conn


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Deploy altmonitor to a remote VPS via Docker.")
    ap.add_argument("--host")
    ap.add_argument("--user")
    ap.add_argument("--port", type=int)
    ap.add_argument("--key", help="path to a private key (-i)")
    ap.add_argument("--dir", default="/opt/altmonitor", help="remote install dir")
    ap.add_argument("--update", action="store_true", help="re-sync + restart, keep data")
    ap.add_argument("--down", action="store_true", help="stop the remote stack")
    args = ap.parse_args(argv)

    conn = collect_conn(args)
    conn = resolve_auth(conn)
    remote_dir = args.dir

    if args.down:
        print("   ⏳ docker compose down …")
        ssh_util.run_remote(conn, f"cd {remote_dir} && docker compose down", timeout=120)
        print("   ✅ 已停止(数据卷保留,state.json / alerts.db 不丢)。")
        return

    if not args.update:
        ensure_docker(conn)
    sync_and_up(conn, remote_dir)
    verify_and_notify(conn, remote_dir)
    print("\n🎉 部署完成!")


if __name__ == "__main__":
    main()
