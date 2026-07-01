# altmonitor 上手向导 + 远程部署 — 设计文档 (v1.2.0)

> 仓库:`0xBennie/binance-smart-money-oi-monitor` · 组件:`altmonitor/`(Python 伴随监控)
> 分支:`feat/onboarding-and-remote-deploy` · 日期:2026-07-01

## 1. 背景与目标

`altmonitor/` 已经是一个完整的币安全市场异动监控器,推送三类 Telegram 告警(价格 ±3% / OI 1m·5m 异动 / 爆量),支持 Docker、systemd、TG 命令实时调参、SQLite 历史。**告警与部署能力已具备。**

缺的是**面向零基础用户的"上手体验"**:今天用户必须手动复制 `.env.example`、去 `@BotFather` 建 bot、再去第三方 bot 查 `chat_id`、粘回 `.env`;配置缺失时 `config.validate()` 直接 `SystemExit` 硬崩溃。

本设计补齐这条龙,分两个耦合子项目:

- **A. 本地配置向导** (`setup.py`):一条命令完成 TG 连接 + 自动发现 `chat_id` + 写 `.env` + 可选启动。
- **B. 远程部署向导** (`deploy.py`):**"输入你的服务器 → 一键部署到你的 VPS"**,由向导 A 的第 ⑤ 步接入。

**Phase C(npm/TS 包体验与功能打磨)不在本 spec 内**,A+B 落地后单独 brainstorm。

### 锁定的决策(不再讨论)
- 目标组件:Python `altmonitor`(不是 TS/npm 那半边)。
- SSH 认证:**Key 为主 + 密码 sshpass 兜底**。
- 远程运行时:**Docker**(复用现有 `Dockerfile` + `docker-compose.yml`);systemd 作为文档备选。
- 依赖底线:仅系统 `ssh`/`scp`/`rsync` + 现有 Python 依赖(aiohttp/websockets/dotenv/certifi)。**不新增 Python 库**(不引 paramiko);密码兜底用系统 `sshpass`(检测缺失则引导安装)。
- 做完后用真实 VPS 端到端部署验证一次。

## 2. 非目标 (Out of scope)
- 不重写告警逻辑 / 不动 WS/OI/爆量检测。
- 不改 TS/MCP 包(Phase C)。
- 不做 Web UI、不做多用户 SaaS。
- 不持久化 SSH 密码;不替用户管理密钥。

## 3. Phase A — 本地配置向导 `setup.py`

### 3.1 用户旅程(逐屏文案,中英双语跟随现有仓库风格)
入口:`cd altmonitor && python setup.py`(等价 `python monitor.py --setup`)。

```
🚀 Bennie Strategy · 异动监控配置向导 / Setup Wizard

① 从 @BotFather 拿 bot token 贴进来:
   (Telegram 搜 @BotFather → /newbot → 复制 token)
   > 7xxxxxxx:AAH…
   ⏳ 校验中… ✅ 已连上 bot:@your_alert_bot

② 现在打开 Telegram,给 @your_alert_bot 发任意一条消息。
   要推到群/频道:把 bot 拉进去、发一条(频道需设为管理员)。
   发完回车继续 [回车] / 手动输入 chat_id [m]:
   ⏳ 监听中… ✅ 发现会话:「我的交易群」 (id -100xxxxx,群组)

③ 发送测试消息… ✅ 去 Telegram 看看,应该收到「✅ Bennie Strategy 已连接」

④ 写入配置… ✅ 已更新 altmonitor/.env(其它设置保留,已备份 .env.bak)

⑤ 现在启动监控吗?
   [1] Docker 后台常驻(推荐,崩溃自重启)
   [2] 本地前台运行(python monitor.py)
   [3] 部署到我的服务器(远程 VPS)     → 进入 deploy.py
   [4] 先不启动
   > _
```

### 3.2 模块拆分(全部在 `altmonitor/`,遵循现有约定)
| 文件 | 职责 | 依赖 |
|------|------|------|
| **`setup.py`** 🆕 | 向导编排:交互流程 + 调 Telegram API + 调 `env_io` + 触发 `deploy.py`。有 `main()`,可 `python setup.py` 直跑。 | `env_io`, `config`, aiohttp |
| **`env_io.py`** 🆕 | **纯函数,零网络零交互**:`parse_env(text)->dict`、`merge_env(existing_text, updates)->str`(保留旧键与注释、幂等)、`redact_token(tok)->str`、`extract_chat(updates_json)->{id,title,type}`|None、`valid_token_shape(tok)->bool`、`write_env_file(path, updates)`(先备份 `.env.bak` 再写) | 仅标准库 |
| **`tg_probe.py`** 🆕(或并入 setup) | 轻量 Telegram 调用(向导阶段 token 尚未进 `config`,不能用 `notifier.Telegram`):`get_me(token)`、`discover_chat(token, timeout)`(getUpdates 轮询)、`send_test(token, chat_id)`。复用 `config.ssl_context()`。 | aiohttp, config |
| `config.py` | `validate()` 硬崩溃 → 友好引导(见 3.4)。新增 `missing_required()->list[str]` 供 monitor 判断。 | — |
| `monitor.py` | 解析 `--setup`(转 setup.py)/ `--dry-run`(见 3.5);`main()` 缺配置时走友好路径。 | setup |

**边界约定:** `env_io` 全部是纯函数,单测覆盖;所有网络/交互在 `setup.py`/`tg_probe.py`,靠 mock 测。

### 3.3 chat_id 自动发现(复用 `commands.py` 的 getUpdates 模式)
1. 先 `getUpdates(offset=-1, timeout=0)` 清 backlog,记录最后 update_id。
2. 提示用户给 bot 发消息;轮询 `getUpdates(offset, timeout=25)` 最多 ~90s。
3. 取最新一条 `message`/`channel_post` 的 `chat.id / .title / .type`,回显确认。
4. 找不到 → 提示常见原因(没给 bot 发消息 / 群隐私模式没设管理员)→ 循环重试 or `[m]` 手动输入。

### 3.4 缺配置的友好处理(替换 SystemExit)
`monitor.py main()` 在跑之前检查:若缺 `TG_BOT_TOKEN`/`TG_CHAT_ID`:
- **TTY 交互终端**:打印引导 + 询问「现在运行配置向导吗? [Y/n]」→ 直接进 `setup.py`。
- **非 TTY**(Docker/管道/CI):打印手动步骤 + 明确指令(填 `.env` 或本地先跑 `python setup.py`),`exit(1)`,**不卡 input()**。

### 3.5 dry-run 预览(轻量)
`python monitor.py --dry-run`:不发 TG,把本应推送的告警打到 stdout(把 `Telegram.enqueue_text` 替换为打印 sink)。让用户没配 TG 也能先看到告警长啥样。*(实现成本低则纳入,否则降级为 P2 后续。)*

## 4. Phase B — 远程部署向导 `deploy.py`

### 4.1 用户旅程
入口:`python deploy.py`(或向导 A 第 ⑤ 步 `[3]`)。前置:本地 `.env` 已由 setup.py 配好。

```
🌐 部署到你的服务器 / Deploy to your server

① 服务器? user@host[:port]   > root@1.2.3.4
② 认证:检测 SSH key… ✅ 用 key / 或提示输入密码(sshpass)
③ ⏳ 测试连接… ✅ 已连上 root@1.2.3.4
④ ⏳ 检查 Docker… 未安装 → 自动安装(curl -fsSL https://get.docker.com | sh)
⑤ ⏳ 同步代码 + 你的 .env → /opt/altmonitor(rsync over SSH,加密)
⑥ ⏳ docker compose up -d …
⑦ ✅ 部署完成!容器 running。Telegram 已收到「✅ 已部署到 1.2.3.4」
   更新:python deploy.py --update   停止:python deploy.py --down
```

### 4.2 模块拆分
| 文件 | 职责 |
|------|------|
| **`deploy.py`** 🆕 | 编排:收集服务器信息 → `ssh_util` 预检 → 远程 bootstrap → 同步 → 起容器 → 校验。支持 `--update` / `--down` / 无交互参数模式 `--host --user --port --key`。 |
| **`ssh_util.py`** 🆕 | 对系统 `ssh`/`scp`/`rsync`/`sshpass` 的薄封装(subprocess)。`test_conn`、`run_remote(cmd)`、`sync_dir(local, remote)`。**纯拼命令 + 跑**,命令拼接逻辑抽成纯函数便于单测。 |

### 4.3 认证策略(Key 为主 + 密码兜底)
- 默认尝试 key:`ssh -o BatchMode=yes -o ConnectTimeout=8 target "echo ok"`。成功 → 用 key。
- 失败且用户选密码:检测 `sshpass`;缺失则引导安装(`brew install hudochenkov/sshpass/sshpass` / `apt-get install sshpass`)。密码**只存进程内内存**,传给 sshpass 用 `-e`(环境变量)而非命令行(避免进 `ps`/history)。**绝不写盘、绝不打日志。**
- 支持自定义 `-i <keyfile>` 与非标准端口。

### 4.4 远程 bootstrap 与同步
1. `run_remote("command -v docker || (curl -fsSL https://get.docker.com | sh)")`;确认 `docker compose version`(缺则装 compose 插件)。
2. `run_remote("mkdir -p /opt/altmonitor")`。
3. `rsync` 传仓库(排除 `.git`、`node_modules`、`.venv`、`__pycache__`、`*.db`、`.env.bak`);**单独** `scp` 本地 `.env`(权限 600)。
4. `run_remote("cd /opt/altmonitor && docker compose up -d --build")`。
5. 校验:`docker compose ps` 状态 running;发 TG「✅ 已部署到 host」。

### 4.5 幂等 / 更新 / 卸载
- `--update`:重新 rsync + `docker compose up -d --build`(不动 `.env`/数据卷)。
- `--down`:`docker compose down`(保留命名卷:`state.json`/`alerts.db` 不丢)。
- 重复部署安全(rsync 增量、compose 幂等)。

## 5. 错误与边界处理清单
| 场景 | 处理 |
|------|------|
| token 无效 | `getMe` ok:false → 友好重试(≤3 次)后退出 |
| 用户没给 bot 发消息 / 群隐私模式 | getUpdates 空 → 超时后提示原因 + 手动输 chat_id 兜底 |
| 群/频道负数 id | 正确识别 `chat.type`,回显 title |
| `.env` 已有其它键 | `merge_env` 保留 + 备份 `.env.bak`,绝不覆盖 |
| token 出现在日志 | 一律 `redact_token`,只显示 `7xxx…cdef` |
| 非 TTY 环境 | 不调 `input()`,打印手动指引后退出 |
| 无 docker(本地/远程) | 本地给 `[2]` 本地启动;远程自动安装 docker |
| SSH 连不上 | 明确报错(超时/认证失败/host 不可达)+ 排查建议,不静默 |
| sshpass 缺失 | 引导安装命令,或改用 key |
| Telegram 429 | 复用 `notifier` 式退避(向导阶段也做简单重试) |
| Windows | `input()`/aiohttp 可用;`.env` 用 cwd 相对路径;远程部署依赖系统 ssh(Win 提示用 WSL/自带 OpenSSH) |

## 6. 安全
- 公开 MIT 仓库:`.env`、`.env.bak`、`*.db`、`state.json` 必须在 `.gitignore`(核对现有)。
- SSH 密码仅内存,`sshpass -e` 经环境变量传递;不落盘、不入日志、不进 shell history。
- `.env` 经加密 SSH 通道传输;远程文件权限 600。
- token/密码在任何 stdout/日志中脱敏。

## 7. 测试计划
遵循现有 `smoke_test.py` 风格(标准库 `unittest`,无 pytest 依赖):
- **`test_env_io.py`** 🆕:`parse_env` / `merge_env`(保留旧键、幂等、备份)/ `redact_token` / `extract_chat`(私聊、群负数、空)/ `valid_token_shape`。
- **`test_ssh_util.py`** 🆕:命令拼接纯函数(key vs 密码、自定义端口/keyfile、rsync 排除项)——不真连服务器,断言生成的 argv。
- Telegram/SSH 网络交互:mock(`aiohttp` 用 `unittest.mock` / monkeypatch `run_remote`)。
- 手动验收:真实 VPS 端到端跑一次(决策已定)。

## 8. 文档改动
- `altmonitor/README.md`:把 **`python setup.py` 一键配置**列为**首选**上手路径(现有手动步骤降为备选);新增「部署到你的服务器 `python deploy.py`」小节。
- `altmonitor/.env.example`:顶部注释加「懒人首选:`python setup.py` 自动配好这些」。
- 根 `README.md`:altmonitor 段落加向导指针。
- `requirements.txt`:若 dry-run/向导无新依赖则不动(sshpass/rsync 是系统工具,不进 requirements)。

## 9. 收尾 / 发布
1. 本地已 ff 同步到 npm 的 1.1.0(完成)。
2. 全部在 `feat/onboarding-and-remote-deploy` 分支开发,TDD。
3. 完成后跑一轮对抗式 code review(codex-review / code-review skill)。
4. 真机部署验证。
5. 用户 review → 合并 → bump `package.json` 1.1.0 → 1.2.0 + tag `v1.2.0`(altmonitor 不在 npm `files`,故 npm 包体不变,发布主要是 GitHub release;是否 `npm publish` 由用户定)。

## 10. Phase C 占位(后续单独 brainstorm)
"优化 npm/TS 包 UX + 功能,完善配套系统":候选方向——把 MCP 巨鲸卡片(鲸鱼均价/盈利大户)接进 TG 告警、TS 侧加 `npx … alert`、统一双组件品牌与文档互链、README quickstart 打磨。**待 A+B 完成后另开设计。**
