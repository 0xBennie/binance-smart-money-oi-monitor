# Binance 合约聪明钱 & OI 异动监控

[![npm version](https://img.shields.io/npm/v/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![npm downloads](https://img.shields.io/npm/dm/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![CI](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/binance-smart-money-oi-monitor)](LICENSE)

[English](README.md) · **简体中文**

> **[Bennie Strategy](https://x.com/0xBenniee)** 出品 · [X @0xBenniee](https://x.com/0xBenniee) · [Telegram @OxBennie](https://t.me/OxBennie) · 🚀 新手先读[新手指南](GUIDE.zh-CN.md)

**看到币安「聪明钱」标签页背后的鲸鱼数据 —— 公开 API 拿不到的那些字段。**

对任意币安 USDT 永续合约，它回答的是：*鲸鱼站在哪边、开仓均价多少、此刻到底
赚没赚钱？* 无需 API key、无需注册。**只报数字 —— 所有输出都是数据，不带任何观点。**

![币安聪明钱看板](https://raw.githubusercontent.com/0xBennie/binance-smart-money-oi-monitor/main/docs/panel-preview.png)

## 快速开始

把 MCP server 注册到你的 AI 客户端 —— 不用 clone、不用 build、不用配置：

```bash
claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
```

然后直接问：*「ETH 现在的聪明钱持仓结构是什么？」*

兼容任意 MCP 客户端（Claude Code / Desktop、Codex CLI、Cursor、Windsurf、
Cline、Zed……）。被墙区域设 `HTTPS_PROXY=http://host:port` 即可。

## 相比公开 fapi，你多拿到什么

它调用的是 binance.com **Smart Signal** 页面背后的同一个接口，里面有公开合约
API 没有的字段：

| 独有字段 | 告诉你什么 |
|---|---|
| `longWhalesAvgEntryPrice` / `shortWhalesAvgEntryPrice` | 多空鲸鱼各自的开仓均价 —— 成本线 vs 现价 |
| `longProfitTraders` / `shortProfitTraders` | 每边**此刻**有多少交易者在盈利 |
| `longProfitWhales` / `shortProfitWhales` | 同上，只算鲸鱼 |
| 聪明钱占全市场 OI 比例（衍生计算） | 聪明钱在这个市场里*有多大分量* |

常规数据（头部账户多空比、Taker 买卖比、OI 及变化率、资金费）也一并拉取，
一次调用拿全。核心不是*哪边仓位大*，而是*哪边在赚钱、成本在哪*。

## 工具一览

7 个实时工具（直连币安）+ 4 个时序工具（需要本地 tracker，见下）：

| 工具 | 返回 |
|---|---|
| `get_full_picture` ⭐ | 一键拿全：聪明钱 + 鲸鱼 + 头部账户 + OI + 资金费 |
| `get_smart_money` | 分多空的仓位、**鲸鱼均价**、**盈利人数** |
| `get_top_trader` | 头部 20% 账户多空比 + Taker 主动买卖比 |
| `get_open_interest` | 总 OI（USD 和张数）+ 5m/15m/1h/4h 变化率 |
| `get_funding` | 资金费率 → 年化 % 和实付 USD |
| `render_panel` / `render_push` | 可分享 HTML 卡片 / Telegram 消息（`zh`/`en`） |
| `get_change` * | 近 N 分钟每边加/减仓多少（张数口径） |
| `get_profit_trend` * | 每边盈利占比 N 分钟内怎么变的 |
| `scan_extreme` * | 全市场聪明钱多空比最高 / 最低排名 |
| `render_chart` * | 三面板折线：多空持仓 + 鲸鱼均价 vs 现价 |

`*` 需要历史数据 —— 跑 tracker 攒快照（SQLite，保留 30 天）：

```bash
SMART_MONEY_WATCHLIST=BTC,ETH,SOL SMART_MONEY_INTERVAL_MIN=15 npm run track
```

## 其他用法

- **CLI** —— `npm run analyze -- <币>` 一条命令出人话报告；另有
  `panel`、`doctor`、`change`、`trend`、`scan`、`chart`、`dashboard`。
- **看板 + JSON API** —— `npm run dashboard` → 所有跟踪币的可排序总表，
  `http://127.0.0.1:3001`。
- **Telegram 告警** —— tracker 在聪明钱仓位骤变时推送；
  [altmonitor](altmonitor/README.md)（Python）补上全市场价格/OI/爆量告警，
  单条 WebSocket 盯全部永续。`docker compose up -d` 整套全起。
- **当库用** —— `npm install binance-smart-money-oi-monitor`，
  `getSmartMoneyOverview('BTCUSDT')` 拿原始 17 个鲸鱼字段。

## 限频防护

接口在币安 web `bapi` 网关上，封得很凶（实测一次莽撞突发换来约 4 小时
`Retry-After`）。7 层防护默认全开 —— `Retry-After` 真实解析、权重预算、预检
ping、抖动间隔、指数退避、熔断器、缓存。细节见
[docs/DEPLOYMENT.zh-CN.md](docs/DEPLOYMENT.zh-CN.md)。

## 文档

- [新手指南](GUIDE.zh-CN.md) —— 5 分钟带真实案例走一遍
- [部署与配置](docs/DEPLOYMENT.zh-CN.md) —— clone 运行、tracker、看板、环境变量、pm2、架构、常见问题
- [Troubleshooting](TROUBLESHOOTING.md) —— 踩过的所有坑和解法（英文）
- [altmonitor](altmonitor/README.md) —— Python 全市场异动告警 bot

## 致谢 & 许可证

Smart Signal 接口最早由
[andychien555/binance-smart-money-tracker](https://github.com/andychien555/binance-smart-money-tracker)
逆向；[BNSmartMoneyMonitor](https://github.com/y18929284608-byte/BNSmartMoneyMonitor)
与 [opentrade](https://github.com/6551Team/opentrade) 印证了接口契约。

MIT —— 见 [LICENSE](LICENSE)。欢迎 issue / PR：
[X @0xBenniee](https://x.com/0xBenniee) · [Telegram @OxBennie](https://t.me/OxBennie)。
