# 币安全市场异动监控 Bot（价格 / OI / 爆量）

扫描币安**全部 USDT 永续合约**,推送三类 Telegram 告警:**① 1 分钟价格异动**(±3%,带价 × 仓四象限)、**② OI 异动**(1 分钟 / 5 分钟未平仓量骤变)、**③ 爆量**(单根 1m 成交额相对自身基线突增)。

```
🟢 PUMP ALERT · 价↑仓↑ 多头进场       📈 OI 异动 · 仓位骤增  (5m)        🔊 爆量 · VOLUME SURGE
📌 SWARMS  (SWARMSUSDT)               📌 ZK  (ZKUSDT)                    📌 MOODENG  (MOODENGUSDT)
💲 价格: 0.006161                      📊 5m OI 变化: +21.4%              💲 价格: 0.31
📈 1min 涨幅: +3.2%                     💲 价格: 0.1284                    📊 1min 成交额: $4.20M ≈ 8.3× 近20根中位
📊 1min OI: +1.9%                       🕐 …                              🕐 …
📐 振幅: 7.4%
⚖️ 多空比: 1.85 (偏多)
🕐 2026-06-25 00:52:01
```

数据全部来自币安**免费公开接口**(WebSocket K线 + REST OI/多空比),无需 API key、不烧任何额度。

## 配套工具 / Companion

本工具是 [binance-smart-money-oi-monitor](https://github.com/0xBennie/binance-smart-money-oi-monitor) 仓库 Python 那一半。TypeScript 那一半给你更深的定位数据:[17 字段 Smart Money 抓取器](https://github.com/0xBennie/binance-smart-money-oi-monitor#what-you-get-vs-public-fapi)(鲸鱼均价 + 盈利大户数)、[MCP server](https://github.com/0xBennie/binance-smart-money-oi-monitor#mcp-server-use-from-any-terminal-ai)(`npx -y binance-smart-money-oi-monitor`)、以及[可分享的看板](https://github.com/0xBennie/binance-smart-money-oi-monitor#generate-a-shareable-panel)。altmonitor 告诉你某个币**何时**异动,把它丢进那半就知道**是谁**在建仓。

**特性**
- 全市场 USDT 永续(~530 个),三类告警:**价格 ±3% / OI 1m·5m 异动 / 爆量**
- 价格告警附带 **振幅 + 多空比(LSR)** + 价 × 仓四象限
- **OI 窗口校验**:仅在相邻采样间隔接近设定周期时给值,慢扫/退避期标 N/A,不误报「1min」
- **爆量基线**:对比该币自身近 N 根 1m 成交额中位,带绝对额下限过滤小币噪音
- **SQLite 历史**:三类告警都存档,`/history`、`/stats` 在 TG 里复盘
- **Telegram 命令实时调参**(含 `/set_oi`、`/set_vol`),不用改 `.env` 重启,持久化到 `state.json`
- 内置币安 429/418 退避 + Telegram 发送限速队列,防限频 / 防封 IP / 防刷屏

## 🚀 最快上手:配置向导（推荐新手）

不用手动找 token、查 chat_id、改配置文件。一条命令搞定:

```bash
cd altmonitor
pip install -r requirements.txt   # 首次
python setup.py
```

向导会:① 校验你的 @BotFather token → ② 让你给 bot 发一条消息、**自动抓取 chat_id**(无需第三方查 id bot)→ ③ 发送测试消息 → ④ 写好 `.env`(保留已有设置、自动备份)→ ⑤ 询问是否立即启动(本地 / Docker / **部署到你的服务器**)。

> 未配置时直接运行 `python monitor.py` 也会友好提示并可转向导,不再硬报错。

## Docker 一键部署（推荐）

在仓库根目录:

```bash
cp altmonitor/.env.example altmonitor/.env   # 填 TG_BOT_TOKEN + TG_CHAT_ID
docker compose up -d                          # 构建 + 后台运行，崩溃自动重启
docker compose logs -f                        # 看日志
```

`state.json` 和 `alerts.db` 持久化在命名卷里,重启不丢。停止: `docker compose down`。

## 本地运行

```bash
cd altmonitor
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # 填入 TG_BOT_TOKEN 和 TG_CHAT_ID
python monitor.py
```

启动后会先发一条「✅ 异动监控已启动」确认消息。

### 拿 Telegram 凭据
1. 找 `@BotFather` → `/newbot` → 拿到 `TG_BOT_TOKEN`
2. 把 bot 拉进你的群,设为管理员(频道同理)
3. 群组 `TG_CHAT_ID`(负数)找 `@getidsbot`;私聊找 `@userinfobot`

## VPS 常驻(systemd)

```ini
# /etc/systemd/system/altmonitor.service
[Unit]
Description=Binance Alt Monitor
After=network-online.target

[Service]
WorkingDirectory=/opt/altmonitor
ExecStart=/opt/altmonitor/.venv/bin/python monitor.py
Restart=always
RestartSec=5
User=ubuntu

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now altmonitor
journalctl -u altmonitor -f          # 看日志
```

## 🌐 部署到你的服务器（一条命令）

想让它 7×24 跑在你自己的 VPS 上?配置向导第 ⑤ 步选「部署到我的服务器」,或直接:

```bash
cd altmonitor
python deploy.py
```

输入 `user@host`,向导会:测试 SSH 连接(优先 key,不行再用密码)→ 自动装 Docker → 同步代码 + 你的 `.env` → `docker compose up -d`(崩溃自重启)→ 校验并给你发 Telegram 通知「已部署到 &lt;host&gt;」。

```bash
python deploy.py --host 1.2.3.4 --user root   # 免交互
python deploy.py --update                      # 更新代码并重启（数据卷不丢）
python deploy.py --down                        # 停止
```

> 认证优先用 SSH key;仅密码登录的服务器需本机装 `sshpass`。密码用 getpass 读取、经环境变量传递,**不落盘、不写日志**。

## Telegram 命令(直接在群里发,实时生效)
| 命令 | 作用 |
|---|---|
| `/status` | 查看当前配置 |
| `/set_pump 5` | 涨幅阈值改成 +5% |
| `/set_dump -5` | 跌幅阈值改成 -5% |
| `/set_oi 3 6` | OI 异动阈值：1m 3% / 5m 6%（`0`=关该窗口） |
| `/set_vol 5` | 爆量阈值：成交额 ≥ 5× 近 N 根中位（`0`=关） |
| `/cooldown 120` | 同币告警冷却 120s |
| `/watch sol doge` | 只看这几个币(留空 `/watch` = 全部) |
| `/unwatch sol` | 移出关注列表 |
| `/mute play` / `/unmute play` | 屏蔽 / 取消屏蔽某币 |
| `/history 20 sol` | 最近 20 条告警(可带币种) |
| `/stats 24` | 近 24 小时异动榜(哪些币最常异动) |
| `/help` | 命令帮助 |

只有 `TG_CHAT_ID`(或 `.env` 里 `ALLOWED_CHAT_IDS`)允许的会话能发命令。改动写入 `state.json`,**重启不丢**。

## 可调参数(写在 `.env`)
| 变量 | 默认 | 说明 |
|---|---|---|
| `PUMP_THRESHOLD` | 3.0 | 涨幅触发线(%) |
| `DUMP_THRESHOLD` | -3.0 | 跌幅触发线(%) |
| `OI_SURGE_PCT_1M` | 3.0 | 1分钟 OI 异动触发线(%)，`0`=关 |
| `OI_SURGE_PCT_5M` | 6.0 | 5分钟 OI 异动触发线(%)，`0`=关 |
| `VOL_BURST_MULT` | 5.0 | 爆量倍数（成交额/近N根中位），`0`=关 |
| `VOL_BURST_LOOKBACK` | 20 | 爆量基线用的历史根数 |
| `VOL_BURST_MIN_USDT` | 50000 | 爆量绝对成交额下限（过滤小币噪音） |
| `COOLDOWN_SEC` | 180 | 同一币同类告警最小间隔 |
| `OI_POLL_SEC` | 60 | OI 全市场轮询周期 |
| `OI_CONCURRENCY` | 15 | OI 并发请求数 |
| `SYMBOLS_REFRESH_SEC` | 3600 | 交易对列表刷新间隔 |
| `TG_MIN_SEND_INTERVAL` | 3.2 | 两条消息最小间隔(防撞 TG 限速) |
| `ALLOWED_CHAT_IDS` | (空) | 额外允许发命令的 chat id,逗号分隔 |
| `LSR_PERIOD` | 5m | 多空比粒度(币安最小 5m) |
| `SMART_MONEY_LINK` | true | 每条告警附带该币的币安"聪明钱"(鲸鱼持仓)链接——从"何时异动"一键跳到"是谁在建仓" |
| `HISTORY_ENABLED` | true | 是否存 SQLite 历史 |
| `DB_FILE` | alerts.db | 历史数据库文件 |

## 设计说明
- **价格**:单条 WebSocket 订阅全市场 `@kline_1m`,实时算当根 1 分钟 K 线 `(收-开)/开`。
- **OI**:后台每 `OI_POLL_SEC`(默认 60s)用 `fapi/v1/openInterest` 扫全市场(权重 1/币,~530 币 << 2400/min 限频),维护**带时间戳的环形缓冲**(~12 分钟)。**仅当相邻采样间隔接近目标窗口(0.5–2.5×)时才给值**,否则标 `N/A`——避免慢扫/退避期把多分钟跨度误标成「1min」。
- **OI 异动**:每轮扫描后比对 1m / 5m 两个窗口的 OI 变化,超阈值即推(5m 与 1m 同时触发时优先推更强的 5m)。
- **爆量(成交量)**:用 K线流里**收盘** 1m 的成交额(`q`,USDT),对比该币近 `VOL_BURST_LOOKBACK` 根的**中位数**;≥ `VOL_BURST_MULT` 倍且超过 `VOL_BURST_MIN_USDT` 才算爆量(中位数抗个别尖峰、绝对额下限滤小币)。
- **去重**:价格告警按「同币同一根 1m K线只推一次 + 按币冷却」;OI / 爆量各按「(币,类型)」独立冷却,互不挤占(冷却计时在内存,重启后重置)。
- **持久化**:运行配置写 `state.json`(`/set_*`、`/watch` 等重启不丢);开启 `HISTORY_ENABLED` 时每条告警入 `alerts.db`(SQLite),供 `/history`、`/stats` 复盘。

---

## 作者 & 联系

**Bennie Strategy** 出品(本工具是 [binance-smart-money-oi-monitor](../README.md) 仓库的 Python 伴随组件)。

- 🐦 X / 推特:[@0xBenniee](https://x.com/0xBenniee)（0x 是数字零加 x，双写 e）
- 💬 Telegram:[@OxBennie](https://t.me/OxBennie)（Ox 是大写字母 O）

两个 handle 都是对的，不是打错。
