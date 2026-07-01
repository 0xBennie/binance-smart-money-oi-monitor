#!/usr/bin/env python3
"""Interactive first-run setup wizard for altmonitor.

    python setup.py

Walks a new user through connecting a Telegram bot with zero manual ID hunting:
paste the @BotFather token, send the bot one message, and the wizard discovers
the chat_id automatically, sends a test message, and writes altmonitor/.env.
Then offers to start locally, in Docker, or deploy to a remote server.
"""
import os
import shutil
import subprocess
import sys

import env_io
import tg_probe

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
ENV_PATH = os.path.join(SCRIPT_DIR, ".env")

TEST_MESSAGE = "✅ Bennie Strategy · 已连接!异动监控配置成功,告警会发到这个会话。"


def _input(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        print("\n已取消。")
        sys.exit(1)


def _require_tty() -> None:
    if sys.stdin.isatty():
        return
    print(
        "⚠️  非交互式终端,无法运行向导。\n"
        "   请手动:cp altmonitor/.env.example altmonitor/.env 并填入 TG_BOT_TOKEN / TG_CHAT_ID,\n"
        "   或在能交互的终端运行:python setup.py"
    )
    sys.exit(1)


def step_token() -> str:
    print("\n① 从 @BotFather 拿 bot token(Telegram 搜 @BotFather → /newbot → 复制 token)")
    while True:
        tok = _input("   粘贴 token > ")
        if not env_io.valid_token_shape(tok):
            print("   ⚠️ 格式看起来不对(应形如 123456789:AAH…)。再试一次(Ctrl+C 退出)。")
            continue
        print(f"   ⏳ 校验 token {env_io.redact_token(tok)} …")
        me = tg_probe.get_me(tok)
        if not me:
            print("   ❌ Telegram 不认这个 token。确认从 @BotFather 完整复制。")
            continue
        print(f"   ✅ 已连上 bot:@{me.get('username', '?')}")
        return tok


def step_chat(token: str) -> str:
    print("\n② 现在打开 Telegram,给你的 bot 发任意一条消息。")
    print("   要推到群/频道:把 bot 拉进去、发一条(频道需把 bot 设为管理员)。")
    while True:
        offset = tg_probe.clear_backlog(token)
        print("   ⏳ 正在监听你的消息…(最多等约 100 秒;输入 m 手动填 chat_id 请先按 Ctrl+C)")
        waited = 0
        while waited < 100:
            chat, offset = tg_probe.poll_for_chat(token, offset, timeout=20)
            if chat:
                kind = {"private": "私聊", "group": "群", "supergroup": "群", "channel": "频道"}.get(
                    chat["type"], chat["type"])
                print(f"   ✅ 发现会话:「{chat['title']}」(id {chat['id']},{kind})")
                return chat["id"]
            waited += 20
            print(f"   …已等 {waited}s,还没收到。确认给 bot 发过消息了?")
        print("   没自动抓到。常见原因:没给 bot 发消息 / 群里 bot 没设管理员(隐私模式)。")
        manual = _input("   手动填 chat_id(或直接回车重试自动检测)> ")
        if manual:
            return manual


def step_test(token: str, chat_id: str) -> None:
    print("\n③ 发送测试消息…")
    if tg_probe.send_message(token, chat_id, TEST_MESSAGE):
        print("   ✅ 已发送,去 Telegram 看看应该收到一条测试消息。")
    else:
        print("   ⚠️ 测试消息没发出去(chat_id 可能不对),但配置仍会写入,可稍后 /status 验证。")


def step_write(token: str, chat_id: str) -> None:
    env_io.write_env_file(ENV_PATH, {"TG_BOT_TOKEN": token, "TG_CHAT_ID": chat_id})
    note = f";原内容已备份到 {os.path.basename(ENV_PATH)}.bak" if os.path.exists(ENV_PATH + ".bak") else ""
    print(f"\n④ ✅ 已写入 {ENV_PATH}(其它设置保留{note})")


def _docker_available() -> bool:
    return shutil.which("docker") is not None


def step_start() -> None:
    print("\n⑤ 现在启动监控吗?")
    has_docker = _docker_available()
    print(f"   [1] Docker 后台常驻(推荐,崩溃自重启){'' if has_docker else '  ← 未检测到 docker'}")
    print("   [2] 本地前台运行(python monitor.py)")
    print("   [3] 部署到我的服务器(远程 VPS)")
    print("   [4] 先不启动")
    choice = _input("   > ")
    if choice == "1":
        if not has_docker:
            print("   未检测到 docker。装好 Docker 后在仓库根目录运行:docker compose up -d")
            return
        print("   ⏳ docker compose up -d(首次会构建镜像)…")
        subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=REPO_ROOT)
        print("   ✅ 已在后台运行。看日志:docker compose logs -f")
    elif choice == "2":
        print("   ⏳ 启动 python monitor.py(Ctrl+C 停止)…\n")
        subprocess.run([sys.executable, "monitor.py"], cwd=SCRIPT_DIR)
    elif choice == "3":
        import deploy
        deploy.main([])   # empty argv: don't inherit setup/monitor's flags (e.g. --setup)
    else:
        print("   好的。以后启动:docker compose up -d  或  cd altmonitor && python monitor.py")


def main() -> None:
    print("🚀 Bennie Strategy · 异动监控配置向导 / Setup Wizard")
    _require_tty()
    if os.path.exists(ENV_PATH):
        cur = env_io.parse_env(open(ENV_PATH, encoding="utf-8").read())
        if cur.get("TG_BOT_TOKEN") and cur.get("TG_CHAT_ID"):
            if _input("\n检测到 .env 已配置 TG。重新配置吗? [y/N] > ").lower() not in ("y", "yes"):
                print("保持现有配置。")
                step_start()
                return
    token = step_token()
    chat_id = step_chat(token)
    step_test(token, chat_id)
    step_write(token, chat_id)
    step_start()
    print("\n🎉 完成!")


if __name__ == "__main__":
    main()
