# Binance 合约聪明钱 & OI 异动监控

[![npm version](https://img.shields.io/npm/v/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![npm downloads](https://img.shields.io/npm/dm/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![CI](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/binance-smart-money-oi-monitor)](LICENSE)
[![node](https://img.shields.io/node/v/binance-smart-money-oi-monitor)](package.json)

[English](README.md) · **简体中文**

> **[Bennie Strategy](https://x.com/0xBenniee)** 出品 · 联系：[X @0xBenniee](https://x.com/0xBenniee) · [Telegram @OxBennie](https://t.me/OxBennie) · 🚀 新手先读[新手指南](GUIDE.zh-CN.md)

![币安聪明钱看板 —— 分多空的鲸鱼持仓、资金费,自包含可分享卡片](https://raw.githubusercontent.com/0xBennie/binance-smart-money-oi-monitor/main/docs/panel-preview.png)

拉取币安 **Smart Signal**（binance.com 合约"聪明钱"标签页）背后的完整 17 字段
鲸鱼总览 —— **公开 `fapi` 拿不到的鲸鱼开仓均价、盈利人数** —— 用的就是官网页面
调用的同一个接口：

```
https://www.binance.com/bapi/futures/v1/public/future/smart-money/signal/overview?symbol=BTCUSDT
```

无需 API key。内置 7 层 `418/429/403` 封禁防护（一次莽撞突发可能换来 4 小时
`Retry-After`）。被墙区域设 `HTTPS_PROXY=http://host:port` 即可。**只报数字** ——
所有输出都是数据，不带任何观点。

---

## 快速开始

不用 clone、不用 build —— 把 MCP server 注册到你的 AI 客户端：

```bash
claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
```

直接问「ETH 现在的聪明钱持仓结构是什么？」—— 7 个实时工具直连币安，不需要
数据库、不需要配置。

> 4 个时序工具需要先攒本地历史 —— 见[时序跟踪（本地 DB）](#时序跟踪本地-db)。
> 全部环境变量：[`.env.example`](.env.example) · [环境变量](#环境变量)。

---

## 相比公开 fapi，你多拿到什么

| 字段 | 公开 `fapi/data` | 本仓库 |
|---|---|---|
| `longShortRatio` | ✅ 经 `topLongShortPositionRatio` | ✅ |
| 头部 20% 账户/持仓多空比 | ✅ | ✅（附带） |
| Taker 主动买卖比 | ✅ | ✅（附带） |
| 全市场未平仓量（USD）+ 5m/15m/1h/4h 变化 | ✅ | ✅（附带） |
| **`longWhalesAvgEntryPrice` / `shortWhalesAvgEntryPrice`**（鲸鱼均价） | ❌ | ✅ |
| **`longProfitTraders` / `shortProfitTraders`**（盈利交易者数） | ❌ | ✅ |
| **`longProfitWhales` / `shortProfitWhales`**（盈利鲸鱼数） | ❌ | ✅ |
| **聪明钱占全市场 OI 的比例**（衍生计算） | ❌ | ✅ |

**加粗**行就是价值所在：不只是*哪边持仓更多*，而是*此刻哪边真在赚钱*、均价多少。

### 数据示例

```
币种            多头盈利%   空头盈利%   鲸鱼均价 多/空
1000RATSUSDT    5%          92%         0.034 / 0.042
1000LUNCUSDT    71%         41%         0.085 / 0.092
```

`盈利%` = 该方向当前处于盈利的交易者占比；`鲸鱼均价 多/空` = 多头鲸鱼和空头鲸鱼
各自的平均开仓价。这些数字对价格意味着什么，由你自己判断 —— 本项目只报数字，
不给观点。

---

## 六种用法

### MCP server（11 个工具，接任意终端 AI）

兼容任意 MCP 客户端 —— Claude Code、Claude Desktop、Codex CLI、Gemini CLI、
Cursor、Windsurf、Cline、Zed、Continue……

```bash
claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
```

| 工具 | 参数 | 返回 |
|---|---|---|
| `get_full_picture` | `symbol`, `period?` | **一键拿全**：分多空的聪明钱 + 鲸鱼仓位、头部账户、OI、资金费、聪明钱占总 OI 比 |
| `get_smart_money` | `symbol` | 每边：仓位(USD)、鲸鱼仓位、**开仓均价**、**盈利人数** —— fapi 拿不到的独有字段 |
| `get_top_trader` | `symbol`, `period?` | 头部 20% 账户多空比 + Taker 主动买卖比（更短周期资金流） |
| `get_open_interest` | `symbol` | 总 OI（USD **和**张数）+ 5m/15m/1h/4h 变化率（按张数，涨价不会误算成加仓） |
| `get_funding` | `symbol`, `notionalUsd?` | 资金费率 → 年化 % + 每结算/每天/每年实付(收) USD（自动识别 8h/4h/1h 周期） |
| `render_panel` | `symbol`, `includeHtml?`, `lang?` | 可分享暗色 HTML 卡片，`zh` 或 `en` |
| `render_push` | `symbol`, `lang?` | Telegram 可直发的 `parse_mode:HTML` 消息，`zh` 或 `en` |
| `get_change` * | `symbol`, `minutes?` | 近 N 分钟每边**加/减仓**多少（张数口径，非 USD） |
| `get_profit_trend` * | `symbol`, `minutes?` | 每边**盈利占比**（交易员 + 鲸鱼）N 分钟内怎么变的 |
| `scan_extreme` * | `limit?`, `maxAgeMin?` | 全市场聪明钱多空比**最高 / 最低**排名 |
| `render_chart` * | `symbol`, `hours?` | 三面板 HTML 折线：多头持仓、空头持仓、鲸鱼均价 vs 现价 |

`*` = 读本地 tracker DB —— 见[时序跟踪（本地 DB）](#时序跟踪本地-db)。
另有 1 个 prompt 工作流：`whale-cost`（鲸鱼成本线 vs 现价）。

`get_full_picture ETH` 返回示例：

```json
{
  "symbol": "ETHUSDT",
  "smartMoney": { "longShortRatio": 0.288, "shortProfitPct": 72, "notionalUsd": 1860314867 },
  "topTrader": { "topPositionLsr": 1.50, "takerBuySellRatio": 1.16 },
  "openInterest": { "oiNowUsd": 3610164191, "oiChg4h": 0.55 },
  "smartMoneyShareOfOI": 0.515
}
```

> **升级：** `npx` 有缓存 —— 移除并重新添加 `smartmoney`（或清 npx 缓存），再重启客户端。

<details>
<summary>等价 JSON 配置 · 从 clone 直接跑 MCP server</summary>

```json
{
  "mcpServers": {
    "smartmoney": {
      "command": "npx",
      "args": ["-y", "binance-smart-money-oi-monitor@latest"]
    }
  }
}
```

从 clone 跑（无需 npm 发布）—— `npm run mcp`，或：

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
</details>

### CLI

clone 后 `npm run <命令>`。全部支持 `--help`；数据类命令支持 `--json`。

| 命令 | 作用 |
|---|---|
| `npm run analyze -- <币>` | 一条命令出人话报告（见下） |
| `npm run panel -- <币>` | 可分享深色看板卡 |
| `npm run doctor` | 自检：币安连通 / DB / 原生依赖；READY/NOT READY 可作 CI 门禁 |
| `npm run track` | tracker daemon（`SMART_MONEY_WATCHLIST`、`_INTERVAL_MIN`） |
| `npm run change -- <币> [分钟] [--json]` | 仓位变化表格；需 tracker 历史 |
| `npm run trend -- <币> [分钟] [--json]` | 盈利占比趋势；需 tracker 历史 |
| `npm run scan` · `npm run chart -- <币>` | 全市场扫描 / HTML 图；需 tracker 历史 |
| `npm run dashboard` · `npm run mcp` | 看板 + JSON API · MCP stdio server |

`npm run analyze -- BEAT` 输出：

```
  BEAT  聪明钱分析   现价 $0.11
  ────────────────────────────────────────────────────
  多空比(名义)   1.12     总持仓 $16.6M · 544 人

                 多头 ▲                空头 ▼
  交易员/大户     347 / 108        197 / 67
  平均成本       2.556023       2.364990
  现价 vs 成本   +4.3%          +12.6%
  盈利占比       85%            24%
```

### 可分享卡片

```bash
npm run panel -- BEAT       # 生成 beatusdt-panel.html，打开截图即可
```

自包含深色 HTML（零外链，到哪都能渲染）。卡片默认中文；设
`SMART_MONEY_CARD_LANG=en` 或单次调用传 `lang: "en"` 切英文。库函数
（`renderPanelHtml(await buildPanel('BEAT'))`）和 MCP 工具 `render_panel` /
`render_push` 出的是同一张卡。内置"仅数据分析,非投资建议"免责声明。

### 时序跟踪（本地 DB）

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

### 看板 + HTTP JSON API

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

### Telegram 告警 + altmonitor

**持仓告警（TypeScript，可选）：** 设 `SMART_MONEY_ALERT_TG_TOKEN` + `_CHAT_ID`
后，被盯的币聪明钱仓位变化超过 `SMART_MONEY_ALERT_QTY_PCT`（默认 5%）或从零新
建仓时推 TG。带指纹 + 冷却去重 —— 同一个动作不会每轮重复刷屏。

**[altmonitor](https://github.com/0xBennie/binance-smart-money-oi-monitor/tree/main/altmonitor)（Python，仅 GitHub、不进 npm 包）：**
单条 WebSocket 盯**全部** USDT 永续，三类告警 —— 1 分钟 K 线 ±3% 价格异动（带
价 × 仓四象限）、OI 在 1m/5m 窗口骤变、成交额相对自身基线爆量。Telegram 命令
（`/set_pump`、`/set_oi`、`/set_vol`、`/watch`、`/history` ……）实时调参不用重
启，无需 API key。altmonitor 告诉你**什么时候**动了；聪明钱工具告诉你**是谁**
在持仓。

```bash
cd altmonitor && pip install -r requirements.txt && python setup.py   # 配置向导
python altmonitor/deploy.py                                           # 一条命令部署到 VPS
docker compose up -d              # 整套全起：altmonitor + tracker + 看板
```

完整命令表见 [`altmonitor/README.md`](https://github.com/0xBennie/binance-smart-money-oi-monitor/tree/main/altmonitor#readme)。

---

## 当作库使用

```ts
import {
  getSmartMoneyOverview, getTopTraderSnapshot, getOpenInterest,
  smartMoneyNotionalUsd, smartMoneyShareOfOI,
} from 'binance-smart-money-oi-monitor';

const [sm, tt, oi] = await Promise.all([
  getSmartMoneyOverview('BTCUSDT'),      // 17 个鲸鱼字段
  getTopTraderSnapshot('BTCUSDT', '5m'), // 头部账户 LSR + Taker 买卖比
  getOpenInterest('BTCUSDT'),            // OI + 5m/15m/1h/4h 变化
]);

if (sm && oi) {
  console.log(`${sm.longWhales} 个多头鲸鱼 @ 均价 ${sm.longWhalesAvgEntryPrice}`);
  console.log(`聪明钱占 OI: ${smartMoneyShareOfOI(sm, oi.oiNowUsd)}`);
}
```

> 算 USD 名义敞口用 `smartMoneyNotionalUsd(sm)` —— 币安未公开的 `totalPositions`
> 字段单位跨币种不一致；helper 用单位已知的 `数量 × 均价` 确定性推导。

限频 helper 一并导出（`isBinanceApiBlocked`、`preflightBinanceFapi`、
`waitForBinanceWeightHeadroom`），你的其他币安调用可以共用同一套熔断器。
安装：`npm install binance-smart-money-oi-monitor`（或
`github:0xBennie/binance-smart-money-oi-monitor`）。

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

### 环境变量

所有变量均为可选。把 [`.env.example`](.env.example) 复制为 `.env`，只取消
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

<details>
<summary>全量分片（1h 刷新）· 2 小时不分片变体</summary>

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
</details>

---

## 常见问题

完整清单见 **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**。最常踩的：

- **某币报 `no data / 可能不支持` 但合约明明存在** → 多半是 `bapi` 临时抽风，重试一两次；少数低量合约确实没有聪明钱覆盖（OI/费率仍可用）。别凭一次 null 就断定"不支持"。
- **所有工具都报 `temporarily rate-limited/blocked`** → 熔断器被 418/403 触发；等 stderr 里的 TTL，或换到能连币安的地区/VPS。
- **时序工具说"没数据"** → tracker 和 MCP server 没共享同一个库；两边设同一个绝对路径 `SMART_MONEY_DB_PATH`。
- **`npm publish` 报 `EOTP` / `ENEEDAUTH`** → 用勾了**「Bypass 2FA」**的 npm token，或配 Trusted Publisher。

## 本仓库**不**包含

- ❌ 不交易 —— 纯数据。
- ❌ 无链上数据、无盘口、无聚合成交（见*致谢*里的项目）。
- ✅ 代理**已**支持：`HTTPS_PROXY` / `NO_PROXY`。

---

## 作者 & 联系

由 **Bennie Strategy** 开发维护。

- 🐦 X / 推特：[@0xBenniee](https://x.com/0xBenniee)（0x 是数字零加 x，双写 e）
- 💬 Telegram：[@OxBennie](https://t.me/OxBennie)（Ox 是大写字母 O）

两个 handle 都是对的，不是打错。欢迎 issue / PR。

---

## 致谢

- **[andychien555/binance-smart-money-tracker](https://github.com/andychien555/binance-smart-money-tracker)** —— 最早逆向出 Smart Signal 接口（Cloudflare Workers + R2 架构；本仓库是 Node + sqlite + express 版，限频防护更强）。
- **[y18929284608-byte/BNSmartMoneyMonitor](https://github.com/y18929284608-byte/BNSmartMoneyMonitor)** 与 **[6551Team/opentrade](https://github.com/6551Team/opentrade)** —— 平行实现，印证了接口契约。

---

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
