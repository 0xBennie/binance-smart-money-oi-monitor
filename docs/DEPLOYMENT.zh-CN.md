# 部署与配置

[English](DEPLOYMENT.md) · 简体中文

零配置 MCP 快速开始之外的所有内容：从 clone 运行、tracker 时序跟踪、看板、
环境变量、限频防护内幕、pm2 生产部署。

---

## 从 clone 运行

需要 tracker、时序历史或看板时再 clone：

```bash
git clone https://github.com/0xBennie/binance-smart-money-oi-monitor.git
cd binance-smart-money-oi-monitor
npm install

npx tsx src/scripts/smart-money-tick.ts                    # 单次拉取 → data/snapshots.db
PORT=3001 npx tsx src/scripts/smart-money-dashboard.ts     # 看板（读同一个 db）
npx tsx src/scripts/top-trader-tick.ts                     # 可选：top-trader 补充
```

### 从 clone 跑 MCP server

`npm run mcp`，或等价的 JSON 客户端配置：

```json
{
  "mcpServers": {
    "smartmoney": {
      "command": "npx",
      "args": ["tsx", "src/scripts/mcp-server.ts"],
      "cwd": "/绝对路径/binance-smart-money-oi-monitor",
      "env": {
        "SMART_MONEY_DB_PATH": "/绝对路径/binance-smart-money-oi-monitor/data/snapshots.db"
      }
    }
  }
}
```

（npm 发布版则是 `"command": "npx", "args": ["-y", "binance-smart-money-oi-monitor@latest"]`。）

> **升级 npx 注册的 server：** `npx` 有缓存 —— 移除并重新添加 `smartmoney`
>（或清 npx 缓存），再重启客户端。

---

## Tracker（时序跟踪）

实时调用都是当下快照。想回答「近 15 分钟空头加了多少」「现在哪些币多空最一边倒」，
就让 tracker 攒快照（SQLite，保留 30 天）：

```bash
SMART_MONEY_WATCHLIST=BEAT,BIRB,MAGMA SMART_MONEY_INTERVAL_MIN=15 npm run track
```

名单 ≤ ~70 个币可安全 15 分钟刷一轮（12 秒/币）；留空 = 全市场，需要更长间隔或
[分片](#生产部署pm2)。也可用 `watchlist.json` 文件。

> **一个库，绝对路径。** tracker、MCP server、看板要用同一个绝对路径
> `SMART_MONEY_DB_PATH` —— 否则各进程回落到各自的 `cwd/data/snapshots.db`，
> 时序工具静默读到空库。（docker compose 已帮你设好。）

> **npm 安装（非 clone）？** 直接跑 tracker bin：
>
> ```bash
> SMART_MONEY_WATCHLIST=BEAT,BILL SMART_MONEY_DB_PATH=/abs/path/snapshots.db \
> SMART_MONEY_INTERVAL_MIN=15 npx binance-smart-money-oi-monitor-track
> ```

查攒下来的历史：

```bash
npm run change -- MAGMA 15   # 近 ~15 分钟每边加/减仓张数
npm run trend -- MAGMA 120   # 交易员/鲸鱼盈利占比趋势
npm run scan                 # 聪明钱多空比最高 / 最低排名
npm run chart -- BEAT 24     # beat-chart.html：持仓 + 均价 24h 时序图
```

持仓变化用**张数而非 USD 名义** —— 避免把涨价误算成加仓。

---

## 看板 + HTTP JSON API

```bash
npm run dashboard            # http://127.0.0.1:3001
```

所有被跟踪币的可排序总表（LSR、盈利占比、鲸鱼均价、价差、SM 占 OI、OI 变化）、
单币 30 天历史页，以及同一个库上的只读 JSON API：

| 路由 | 返回 |
|---|---|
| `GET /api/snapshots` | 每币最新快照，附盈利% 和占 OI 比例 |
| `GET /api/symbol/:symbol/history?days=30` | 单币快照历史 |
| `GET /health` | `{ ok: true, port }` 存活探针 |
| `GET /` · `GET /symbol/:symbol` | HTML 看板 · 单币 30 天视图 |

API 返回的是 tracker 已写入的内容 —— 先至少跑一次 tracker。

---

## Telegram 持仓告警

可选：设 `SMART_MONEY_ALERT_TG_TOKEN` + `SMART_MONEY_ALERT_TG_CHAT_ID` 后，
被盯的币聪明钱仓位变化超过 `SMART_MONEY_ALERT_QTY_PCT`（默认 5%）或从零新建仓
时推 TG。带指纹 + 冷却去重 —— 同一个动作不会每轮重复刷屏。

全市场价格/OI/爆量告警见 [altmonitor](../altmonitor/README.md)（Python，仅
GitHub、不进 npm 包）。`docker compose up -d` 一次全起：altmonitor + tracker + 看板。

---

## 环境变量

所有变量均为可选。把 [`.env.example`](../.env.example) 复制为 `.env`，只取消
需要项的注释；真实 token 不要提交到 Git。

| 变量 | 默认 | 说明 |
|---|---|---|
| `SMART_MONEY_DB_PATH` | `<cwd>/data/snapshots.db` | 共享 SQLite 库的绝对路径；tracker、看板、时序 MCP 工具必须使用同一个文件 |
| `SMART_MONEY_WATCHLIST` | *(无)* | 逗号分隔的币种，如 `BTC,ETH,SOL`；留空表示全市场 |
| `SMART_MONEY_WATCHLIST_FILE` | `watchlist.json` | JSON 数组或 `{ "symbols": [...] }` 文件；内容会与 `SMART_MONEY_WATCHLIST` 合并 |
| `SMART_MONEY_INTERVAL_MIN` | `0` | `0` 表示单次抓取后退出；正数启用自调度 daemon |
| `SMART_MONEY_POOL_MAX` | `0` | 每轮 Smart Money 币种上限；`0` 表示全部 USDT 永续 |
| `SMART_MONEY_SHARD_INDEX` | `0` | 分片时的 0 基下标 |
| `SMART_MONEY_SHARD_TOTAL` | `1` | 总分片数，`1` = 不分片 |
| `TOP_TRADER_POOL_MAX` | `0` | top-trader 币种上限；`0` 表示全部 |
| `TOP_TRADER_SHARD_INDEX` | `0` | top-trader 的 0 基分片下标 |
| `TOP_TRADER_SHARD_TOTAL` | `1` | top-trader 总分片数 |
| `OI_POOL_MAX` | `0` | OI 币种上限；`0` 表示全部 |
| `OI_SHARD_INDEX` | `0` | OI 的 0 基分片下标 |
| `OI_SHARD_TOTAL` | `1` | OI 总分片数 |
| `SMART_MONEY_DASHBOARD_HOST` | `127.0.0.1` | 看板绑定地址；`0.0.0.0` 会暴露到网络 |
| `SMART_MONEY_DASHBOARD_PORT` | `3001` | 看板监听端口 |
| `SMART_MONEY_DASHBOARD_CORS` | *(关闭)* | 精确允许的浏览器 origin；不会启用通配 CORS |
| `PORT` | `3001` | 看板端口的兼容回退变量 |
| `SMART_MONEY_CARD_LANG` | `zh` | `render_panel` / `render_push` 默认语言：`zh` 或 `en`；单次调用的 `lang` 优先 |
| `SMART_MONEY_ALERT_TG_TOKEN` | *(无)* | Telegram bot token；token 和 chat ID 缺一时告警关闭 |
| `SMART_MONEY_ALERT_TG_CHAT_ID` | *(无)* | Telegram 目标 chat ID |
| `SMART_MONEY_ALERT_WINDOW_MIN` | `30` | 告警回看窗口（分钟） |
| `SMART_MONEY_ALERT_QTY_PCT` | `5` | 触发告警的持仓数量绝对变化百分比 |
| `HTTPS_PROXY` / `HTTP_PROXY` | *(无)* | 把**所有** Binance 请求走此代理（如 `http://host:port`）—— 用于被地区限制的区域。未设置则直连 |
| `NO_PROXY` | *(无)* | 逗号分隔、需绕过代理直连的主机（标准 `NO_PROXY` 语义） |

---

## 7 层 418/429 防护

Smart Signal 接口位于币安 web `bapi` 网关，比 `fapi` 更敏感 —— 一次未协调的
突发请求实测换来过 **3.85 小时** `Retry-After`。以下 7 层默认全部启用：

1. **真实解析 `Retry-After`** —— 用币安返回的确切秒数，不靠猜。
2. **权重预算追踪** —— 读 `X-MBX-USED-WEIGHT-1M`，利用率 > 70% 时下一次调用睡到下一分钟窗口。
3. **预检 ping** —— 每个 cron 入口先 ping `/fapi/v1/ping`，遇 418/403 立即中止。
4. **抖动间隔** —— smart-money 12s ± 3s、top-trader 1s ± 200ms，不给 WAF 固定节奏。
5. **指数退避** —— 连续软命中冷却 5min → 15min → 60min 逐级升级。
6. **进程级熔断** —— `isBinanceApiBlocked()` 短路同进程所有下游调用。
7. **内存缓存** —— smart-money 10min / top-trader 5min，窗口内重复请求不触网。

**故意没有任何忽略 `Retry-After` 的重试路径** —— 对 418 做重试循环是把 5 分钟
软封升级成多小时硬封的最快方式。

限频 helper 从库中一并导出（`isBinanceApiBlocked`、`preflightBinanceFapi`、
`waitForBinanceWeightHeadroom`），你的其他币安调用可以共用同一套熔断器。

---

## 架构

```
                    ┌──────────────────────────────────────────────────────┐
                    │                    库内核 (library core)              │
                    │  getSmartMoneyOverview / getTopTraderSnapshot /       │
                    │  getOpenInterest —— 实时直连 Binance (bapi + fapi/    │
                    │  data)，7 层限频防护                                  │
                    └───────────────┬───────────────────────┬───────────────┘
                                    │                        │
        ┌───────────────────────────┘                        └────────────────────────┐
        │  轨道 A —— cron → 库 → 看板                          │  轨道 B —— 实时，无 DB    │
        ▼                                                     ▼                          │
┌─────────────────┐                                       ┌──────────────────────────┐
│ smart-money-tick│──┐                                    │  • Node import 导入      │
├─────────────────┤  │ 写入快照                           │  • MCP server            │
│ top-trader-tick │──┤                                    │      (stdio，11 个工具)  │
├─────────────────┤  │                                    │  • panel HTML 卡片       │
│ oi-tick         │──┘                                    └──────────────────────────┘
└─────────────────┘  │
                     ▼
      sqlite (data/snapshots.db，保留 30 天)
                     │ 只读
                     ▼
      Express 看板 + JSON API (:3001)
```

两条轨道调用同一份内核，同一套限频防护保护每条路径。轨道 B（Node import /
MCP / 卡片）实时直连币安，无需 cron 和数据库；7 个实时 MCP 工具永不加载原生模块。

---

## 生产部署（pm2）

默认**全部 USDT 永续**（约 500 个合约）。smart-money 每币 12s（500 币 ≈ 100 分
钟），全市场想 1 小时刷新必须 2 路分片；top-trader/OI 每币 1s（≈ 8 分钟），随便放。

| 模式 | 币数 | smart-money cron | top-trader cron | OI cron | 分片 |
|---|---|---|---|---|---|
| **轻量** | 上限 100 | `7 * * * *` | `*/30 * * * *` | `15,45 * * * *` | 无 |
| **标准** | 上限 200 | `7 * * * *` | `*/30 * * * *` | `15,45 * * * *` | 无 |
| **全量，2h 刷新** | ~500 全部 | `0 */2 * * *` | `*/30 * * * *` | `15,45 * * * *` | 无 |
| **全量，1h 刷新** | ~500 全部 | `7,37 * * * *`（各跑一半） | `*/30 * * * *` | `15,45 * * * *` | **2 分片** |

分片按 `index % SHARD_TOTAL == SHARD_INDEX` 确定性切分。三张表保留 30 天
（`src/storage.ts` 的 `RETENTION_DAYS`）；默认节奏下磁盘约 30–80 MB/月。

```js
// ecosystem.config.js —— 标准模式
module.exports = {
  apps: [
    { name: 'smart-money-tick', script: 'node_modules/.bin/tsx',
      args: 'src/scripts/smart-money-tick.ts', cron_restart: '7 * * * *',
      autorestart: false, env: { SMART_MONEY_POOL_MAX: '200' } },
    { name: 'top-trader-tick', script: 'node_modules/.bin/tsx',
      args: 'src/scripts/top-trader-tick.ts 5m', cron_restart: '*/30 * * * *',
      autorestart: false },
    { name: 'oi-tick', script: 'node_modules/.bin/tsx',
      args: 'src/scripts/oi-tick.ts', cron_restart: '15,45 * * * *',
      autorestart: false },
    { name: 'smart-money-dashboard', script: 'node_modules/.bin/tsx',
      args: 'src/scripts/smart-money-dashboard.ts', autorestart: true,
      env: { PORT: '3001' } },
  ],
};
```

### 全量分片（1h 刷新）

两个入口错峰各拉一半：

```js
{ name: 'smart-money-tick-a', script: 'node_modules/.bin/tsx',
  args: 'src/scripts/smart-money-tick.ts', cron_restart: '7 * * * *',
  autorestart: false, env: { SMART_MONEY_SHARD_INDEX: '0', SMART_MONEY_SHARD_TOTAL: '2' } },
{ name: 'smart-money-tick-b', script: 'node_modules/.bin/tsx',
  args: 'src/scripts/smart-money-tick.ts', cron_restart: '37 * * * *',
  autorestart: false, env: { SMART_MONEY_SHARD_INDEX: '1', SMART_MONEY_SHARD_TOTAL: '2' } },
```

最省的全量方案 —— 单入口 `cron_restart: '0 */2 * * *'`，无需 env。

无论哪种都要错峰：熔断器是进程内的，但每个入口发数据请求前都会预检 ping ——
进程 A 刚吃 418，进程 B 的预检会捕捉到并干净中止；错峰能让 IP 权重窗口有时间回落。

---

## 常见问题

完整清单见 [TROUBLESHOOTING.md](../TROUBLESHOOTING.md)（英文）。最常踩的：

- **某币报 `no data / 可能不支持` 但合约明明存在** → 多半是 `bapi` 临时抽风，重试一两次；少数低量合约确实没有聪明钱覆盖（OI/费率仍可用）。别凭一次 null 就断定「不支持」。
- **所有工具都报 `temporarily rate-limited/blocked`** → 熔断器被 418/403 触发；等 stderr 里的 TTL，或换到能连币安的地区/VPS。
- **时序工具说「没数据」** → tracker 和 MCP server 没共享同一个库；两边设同一个绝对路径 `SMART_MONEY_DB_PATH`。
- **`npm publish` 报 `EOTP` / `ENEEDAUTH`** → 用勾了**「Bypass 2FA」**的 npm token，或配 Trusted Publisher。
