# Binance 合约聪明钱 & OI 异动监控

[![npm version](https://img.shields.io/npm/v/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![npm downloads](https://img.shields.io/npm/dm/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![CI](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/binance-smart-money-oi-monitor)](LICENSE)
[![node](https://img.shields.io/node/v/binance-smart-money-oi-monitor)](package.json)

[English](README.md) · **简体中文**

> **[Bennie Strategy](https://x.com/0xBenniee)** 出品 · npm 包名 `binance-smart-money-oi-monitor` · 联系：[X/推特 @0xBenniee](https://x.com/0xBenniee) · [Telegram @OxBennie](https://t.me/OxBennie)

生产级的 **Binance Smart Signal（"聪明钱 / Smart Money" 标签页）** 抓取器 —— 拉取
公开 `fapi` 接口**拿不到**的完整 17 字段鲸鱼总览，并内置 7 层 `418 / 429 / 403`
限频封禁防护。

本仓库包含 **两个独立工具** + **三种数据消费方式**：

| 工具 | 技术栈 | 作用 |
|---|---|---|
| **Smart Money 抓取器**（根目录 `src/`） | TypeScript | 把 17 字段鲸鱼总览 + 头部账户 + OI 快照入 SQLite，并提供 Express 看板 |
| **[altmonitor](altmonitor/)**（`altmonitor/`） | Python | 全市场 1 分钟价格异动（±3%）+ OI 异动监控，带 Telegram bot |

**Smart Money 数据三种消费方式** —— 当 [Node 库](#当作库使用)、走 [HTTP JSON API](#http-json-api)、或通过自带的
[**MCP server**](#mcp-server从任意终端-ai-调用) 把它暴露成工具给任意终端 AI（Claude Code、Codex、Gemini CLI、Cursor……）。

这是 `binance.com/zh-CN/smart-money/signal/<symbol>` 页面背后调用的接口：

```
https://www.binance.com/bapi/futures/v1/public/future/smart-money/signal/overview?symbol=BTCUSDT
```

无需 API key，无需代理（多数 VPS 区域可直连）。但币安对此 web `bapi` 网关有未公开的
单 IP 权重预算，一次莽撞的突发请求就可能换来 4 小时的 `Retry-After`。本仓库解决这个问题。

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

那 4 个 ★ 字段才是 Smart Signal 真正有用的地方 —— 它们不只告诉你*哪边持仓更多*，
而是*此刻哪边真在赚钱*、均价多少。公开 `fapi` 给不了这些。

### 解读示例

```
币种            多头盈利%   空头盈利%   鲸鱼均价 多/空    判断
1000RATSUSDT    5%          92%         0.034 / 0.042    🔴 空头大赚（价格已下跌）
1000LUNCUSDT    71%         41%         0.085 / 0.092    🟢 多头大赚（价格已拉升）
```

当 `空头鲸鱼均价 > 多头鲸鱼均价` 超过 5% 时，通常意味着空头进场太晚、即将被逼空。

---

## 架构

```
┌─────────────────┐         ┌──────────────────────────────┐
│ smart-money-tick│ cron 60m├──► binance bapi smart-money  │
└────────┬────────┘         └──────────────────────────────┘
         │ 写入 ob_smart_money_snapshots
         ▼
┌─────────────────────────────────────────────┐
│           sqlite (data/snapshots.db)         │
│   ob_smart_money_snapshots / ob_top_trader_  │
│   snapshots / ob_oi_snapshots（30 天保留）    │
└────────────────────┬─────────────────────────┘
                     │ 只读
                     ▼
            ┌──────────────────┐
            │ Express 看板 + API │   http://your-host:3001/
            └──────────────────┘
```

- **一个 sqlite 文件**，三张表，30 天保留
- **一个 Express 看板**，服务端渲染（无前端框架）
- **三个 cron 入口**（smart-money 60min、top-trader 30min、OI 30min），错峰
- **库模式**：`import { getSmartMoneyOverview } from 'binance-smart-money-oi-monitor'`

---

## 7 层 418/429 防护

Smart Signal 接口位于币安 web `bapi` 网关，比 `fapi` 更敏感。一次未协调的突发请求
就可能换来**实测 3.85 小时**的 `Retry-After`。下面 7 层默认全部启用：

1. **真实解析 `Retry-After`** —— 用币安返回的确切秒数，不靠猜。
2. **权重预算追踪** —— 读每个 fapi 响应的 `X-MBX-USED-WEIGHT-1M`，利用率 > 70% 时下一次调用睡到下一分钟窗口。
3. **预检 ping** —— 每个 cron 入口先 ping `/fapi/v1/ping`，遇 418/403 立即中止，不再发任何请求。
4. **抖动间隔** —— smart-money 用 12s ± 3s，top-trader 用 1s ± 200ms，避免形成被 WAF 识别的固定节奏。
5. **指数退避** —— 1 小时内连续软命中，冷却 5min → 15min → 60min 逐级升级。
6. **进程级熔断** —— `isBinanceApiBlocked()` 短路同进程内所有下游调用。
7. **内存缓存** —— smart-money 10min、top-trader 5min，窗口内重复请求同一币不触网。

**没有任何忽略 `Retry-After` 的重试路径**，这是故意的：把 5 分钟软封升级成多小时硬封的
最快方式，就是对 418 做重试循环 —— 别这么干。

---

## 快速开始

```bash
git clone https://github.com/0xBennie/binance-smart-money-oi-monitor.git
cd binance-smart-money-oi-monitor
npm install

# 1. 单次拉取（写入 data/snapshots.db）
npx tsx src/scripts/smart-money-tick.ts

# 2. 启动看板（读同一个 db）
PORT=3001 npx tsx src/scripts/smart-money-dashboard.ts
# → http://localhost:3001/

# 3. 可选：再拉 top-trader 补充（Taker 买卖比 + 5min LSR）
npx tsx src/scripts/top-trader-tick.ts
```

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SMART_MONEY_POOL_MAX` | `0` | 币种上限。**0 = 全部 USDT-PERPETUAL**（~500）。设为如 `100` 限制 |
| `SMART_MONEY_SHARD_INDEX` | `0` | 分片时的 0 基下标 |
| `SMART_MONEY_SHARD_TOTAL` | `1` | 总分片数，`1` = 不分片 |
| `TOP_TRADER_POOL_MAX` / `_SHARD_INDEX` / `_SHARD_TOTAL` | 同上 | top-trader cron 同语义 |
| `OI_POOL_MAX` / `_SHARD_INDEX` / `_SHARD_TOTAL` | 同上 | OI cron 同语义 |
| `SMART_MONEY_DASHBOARD_PORT` / `PORT` | `3001` | 看板监听端口 |

### 当作库使用

```ts
import {
  getSmartMoneyOverview,
  getTopTraderSnapshot,
  getOpenInterest,
  smartMoneyNotionalUsd,
  smartMoneyShareOfOI,
} from 'binance-smart-money-oi-monitor';

const sym = 'BTCUSDT';
const [sm, tt, oi] = await Promise.all([
  getSmartMoneyOverview(sym),         // 17 个鲸鱼字段
  getTopTraderSnapshot(sym, '5m'),    // 头部账户/持仓 LSR + Taker 买卖比
  getOpenInterest(sym),               // 全市场 OI + 5m/15m/1h/4h 变化
]);

if (sm && oi) {
  console.log(`${sm.longWhales} 个多头鲸鱼 @ 均价 ${sm.longWhalesAvgEntryPrice}`);
  console.log(`${sm.longProfitTraders}/${sm.longTraders} 多头在盈利`);
  // 聪明钱 USD 名义敞口，由 数量 × 均价 推导（不要用单位不一致的 totalPositions）
  console.log(`聪明钱名义敞口: $${(smartMoneyNotionalUsd(sm) / 1e6).toFixed(2)}M`);
  console.log(`占全市场 OI: ${(smartMoneyShareOfOI(sm, oi.oiNowUsd)! * 100).toFixed(1)}%`);
}
```

> **为什么要 helper？** 币安未公开的 `totalPositions` 字段单位跨币种不一致（有时是币本位、有时是 USD）。
> `smartMoneyNotionalUsd(sm)` 用单位已知的字段（`数量 × 均价`）确定性地算出 USD 名义敞口。

直接从 GitHub 安装：

```bash
npm install github:0xBennie/binance-smart-money-oi-monitor
```

### HTTP JSON API

看板进程同时是一个对 sqlite 内容只读的 JSON API —— 任何 HTTP 客户端（包括能 `fetch` 的 AI agent）都能拉：

```bash
npm run dashboard          # 默认 PORT=3001
```

| 路由 | 返回 |
|---|---|
| `GET /api/snapshots` | 每个币最新快照（smart-money 关联 OI），附盈利% 和 占 OI 比例 |
| `GET /api/symbol/:symbol/history?days=30` | 单币快照历史 |
| `GET /health` | `{ ok: true, port }` 存活探针 |
| `GET /` | 人看的 HTML 看板（可排序表格） |
| `GET /symbol/:symbol` | 单币 30 天 HTML 视图 |

> API 返回的是 cron 已写入 `data/snapshots.db` 的内容。先至少跑一次抓取器（`npm run smart-money:tick`），否则响应为空。

### MCP server（从任意终端 AI 调用）

自带的 MCP server 把**实时**的 Smart Money / Top Trader / OI 库（含内置限频防护）暴露成
Model Context Protocol 工具 —— 无需 cron、无需本地数据库。兼容任意 MCP 客户端：
**Claude Code、Claude Desktop、Codex CLI、Gemini CLI、Cursor、Windsurf、Cline、Zed、Continue** ……

**一行注册到你自己的 AI —— 不用 clone、不用 build。** 发布到 npm 后，让客户端指向
`npx -y binance-smart-money-oi-monitor` 即可：

```json
{
  "mcpServers": {
    "binance-smart-money": {
      "command": "npx",
      "args": ["-y", "binance-smart-money-oi-monitor"]
    }
  }
}
```

或在 Claude Code 命令行里加：

```bash
claude mcp add binance-smart-money -- npx -y binance-smart-money-oi-monitor
```

`npx` 会自动下载包、运行 `binance-smart-money-oi-monitor` 这个 bin（即 MCP server），
你的 AI 就拿到下面 4 个工具。该 server 是纯 stdio JSON-RPC，运行时**不加载任何原生模块**
（不拉 `better-sqlite3`/`express`）。

<details>
<summary>从 clone 直接跑（无需发布 npm）</summary>

```json
{
  "mcpServers": {
    "binance-smart-money": {
      "command": "npx",
      "args": ["tsx", "src/scripts/mcp-server.ts"],
      "cwd": "/绝对路径/binance-smart-money-oi-monitor"
    }
  }
}
```

或直接 `npm run mcp` 在前台启动 stdio server。
</details>

**暴露的工具：**

| 工具 | 参数 | 返回 |
|---|---|---|
| `get_smart_money` | `symbol` | 17 字段鲸鱼总览：多空鲸鱼数、均价、盈利者数、USD 名义敞口 |
| `get_top_trader` | `symbol`, `period?` | 头部账户（top 20% 保证金）LSR + Taker 买卖比 |
| `get_open_interest` | `symbol` | 全市场 OI（USD + 币数）+ 5m/15m/1h/4h 变化 |
| `get_full_picture` | `symbol`, `period?` | 三者合一 + 聪明钱占 OI 比例 —— "X 现在什么仓位"的一键调用 |

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

### 生成可分享的看板

把任意币的鲸鱼仓位做成一张**自包含深色 HTML 卡片**（币安 Smart Signal 那种样式）—— 截图发推，或把 HTML 串嵌进自己的网站。

```bash
npm run panel BEAT          # 生成 beatusdt-panel.html，浏览器打开截图即可
```

三种方式，同一张卡：

```ts
import { buildPanel, renderPanelHtml } from 'binance-smart-money-oi-monitor';
const html = renderPanelHtml((await buildPanel('BEAT'))!);   // 当库用
```

- MCP 工具 `render_panel`(symbol) → 返回 `{ summary, html }`，让你的 AI 当场生成看板。
- 卡片零依赖（无外链），到哪都能渲染、截图干净，底部自带署名水印。

---

## 池规模 & cron 节奏

默认行为是**全部 USDT-PERPETUAL 币种**（2026 年约 500 个合约）。按你对数据新鲜度的容忍度选部署模式：

| 模式 | 币数 | smart-money cron | top-trader cron | OI cron | 分片 |
|---|---|---|---|---|---|
| **轻量** | 上限 100 | `7 * * * *`（1×/h） | `*/30 * * * *` | `15,45 * * * *` | 无 |
| **标准** | 上限 200 | `7 * * * *`（1×/h） | `*/30 * * * *` | `15,45 * * * *` | 无 |
| **全量，2h 刷新** | ~500 全部 | `0 */2 * * *`（1×/2h） | `*/30 * * * *` | `15,45 * * * *` | 无 |
| **全量，1h 刷新** | ~500 全部 | `7,37 * * * *`（2×/h，各跑一半） | `*/30 * * * *` | `15,45 * * * *` | **2 分片** |

"1h 刷新"读作**每个币在 1 小时内都拿到一次新快照**，靠 `:07` 和 `:37` 两个 cron 各拉一半（分片 0/2 和 1/2）实现。

算账：smart-money 用 12s ± 3s 间隔（web bapi 对频率敏感），500 币 ≈ 100 分钟，不分片塞不进 1 小时。
top-trader 和 OI 都走 fapi/data、1s 间隔，500 币 ≈ 8 分钟，随便放。

### 分片

币种按 `index % SHARD_TOTAL == SHARD_INDEX` 确定性切分，每个分片永远拉同一批（缓存局部性好，且分片间不会在同一窗口撞同一个币）。

### 数据保留

三张表由每次 `smart-money-tick` 结尾的 `storage.cleanup()` 修剪到 **30 天**。要更长历史就调大
`src/storage.ts` 里的 `RETENTION_DAYS` 重新构建，或在每日 cron 前备份。

默认节奏下（500 币、smart-money 每小时 + top-trader/OI 各 30min）磁盘占用约 **30–80 MB/月**（开 WAL）。

## 生产部署（pm2）

```js
// ecosystem.config.js — 标准模式：上限 200，每小时
module.exports = {
  apps: [
    { name: 'smart-money-tick', script: 'node_modules/.bin/tsx',
      args: 'src/scripts/smart-money-tick.ts', cron_restart: '7 * * * *',
      autorestart: false, env: { SMART_MONEY_POOL_MAX: '200' } },
    { name: 'top-trader-tick', script: 'node_modules/.bin/tsx',
      args: 'src/scripts/top-trader-tick.ts 5m', cron_restart: '*/30 * * * *', autorestart: false },
    { name: 'oi-tick', script: 'node_modules/.bin/tsx',
      args: 'src/scripts/oi-tick.ts', cron_restart: '15,45 * * * *', autorestart: false },
    { name: 'smart-money-dashboard', script: 'node_modules/.bin/tsx',
      args: 'src/scripts/smart-money-dashboard.ts', autorestart: true, env: { PORT: '3001' } },
  ],
};
```

全量 + 1h 刷新的 2 路分片，以及错峰原理，见 [英文 README](README.md#production-deployment-pm2)。

---

## 伴随工具：altmonitor（价格 / OI / 爆量 异动监控）

[`altmonitor/`](altmonitor/) 是一个自包含的 **Python** 工具（与上面的 TypeScript 抓取器相互独立），
监控**全部** USDT 永续合约，推送三类 Telegram 告警：

1. **价格异动** —— 单根 1 分钟 K 线涨/跌 ≥ ±3%，带价 × 仓四象限 + 振幅 + 多空比
2. **OI 异动** —— 未平仓量在 **1 分钟** 或 **5 分钟** 窗口内骤变超阈值
3. **爆量（成交量）** —— 收盘 1m 成交额突增到自身近 N 根中位的 ≥ N 倍

- 单条 WebSocket 订阅全市场 `@kline_1m`（价格 + 成交量）
- 后台每 60s 扫全市场 `fapi/v1/openInterest`，存进带时间戳的环形缓冲算 1m/5m 变化
- Telegram 命令（`/set_pump`、`/set_oi`、`/set_vol`、`/watch`、`/history`、`/stats` ……）实时调参，无需重启，持久化到 `state.json`
- 可选 SQLite 告警历史（三类都存），供 `/history`、`/stats` 复盘
- 全部免费公开接口 —— 无需 API key，不烧额度

Docker 一键部署（在仓库根目录）：

```bash
cp altmonitor/.env.example altmonitor/.env   # 填 TG_BOT_TOKEN + TG_CHAT_ID
docker compose up -d                          # 构建 + 运行，崩溃自动重启
```

或直接运行：

```bash
cd altmonitor
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # 填入 TG_BOT_TOKEN + TG_CHAT_ID
python monitor.py
```

完整配置、Telegram 命令表、Docker compose、systemd 配置见 [`altmonitor/README.md`](altmonitor/README.md)。

---

## 本仓库**不**包含

- ❌ 不交易，纯数据。
- ❌ 无代理。如果你的 IP 吃到硬 403（CloudFront WAF），唯一办法是等或换 IP —— 防护层的全部意义就是永远走不到那一步。
- ❌ 无链上数据、无盘口、无聚合成交。这些见*致谢*里的项目。

---

## 作者 & 联系

由 **Bennie Strategy** 开发维护。

- 🐦 X / 推特：[@0xBenniee](https://x.com/0xBenniee)
- 💬 Telegram：[@OxBennie](https://t.me/OxBennie)

有问题、想法或想要某个功能？两个渠道都可以找我，也欢迎提 issue / PR。

---

## 致谢

- **[andychien555/binance-smart-money-tracker](https://github.com/andychien555/binance-smart-money-tracker)**
  —— 最早逆向出 `bapi/futures/v1/public/future/smart-money/signal/overview` 接口。他们的版本基于
  Cloudflare Workers + R2 + 静态 SPA 前端；本仓库是 Node + sqlite + express 版，限频防护更强。架构不同，数据洞见同源。
- **[y18929284608-byte/BNSmartMoneyMonitor](https://github.com/y18929284608-byte/BNSmartMoneyMonitor)**
  与 **[6551Team/opentrade](https://github.com/6551Team/opentrade)** —— 平行实现，印证了接口契约。

---

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
