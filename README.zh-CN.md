# Binance 合约聪明钱 & OI 异动监控

[![npm version](https://img.shields.io/npm/v/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![npm downloads](https://img.shields.io/npm/dm/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![CI](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/binance-smart-money-oi-monitor)](LICENSE)

[English](README.md) · **简体中文**

> **[Bennie](https://x.com/0xBenniee)**（[Bennie Strategy](https://x.com/0xBenniee)）出品 · [X @0xBenniee](https://x.com/0xBenniee) · [Telegram @OxBennie](https://t.me/OxBennie)

## 这是做什么的？

币安网页上有个**「聪明钱」**标签页，能看到每个币的大户（鲸鱼）站在哪边。这个
工具把那些数据抓出来，覆盖**任意币安 USDT 永续合约** —— 你（或者你的 AI）直接
问就行，不用自己去网页上翻。

它只回答一个简单的问题：

> **鲸鱼站在哪边？他们在什么价位进的场？现在赚钱了吗？**

无需 API key，无需注册。它只给数据，绝不告诉你买还是卖。

<p align="center">
  <img src="https://raw.githubusercontent.com/0xBennie/binance-smart-money-oi-monitor/main/docs/panel-preview.png" width="49%" alt="聪明钱卡片（中文）">
  <img src="https://raw.githubusercontent.com/0xBennie/binance-smart-money-oi-monitor/main/docs/panel-preview-en.png" width="49%" alt="聪明钱卡片（英文）">
</p>

## 安装

先装 **[Node.js](https://nodejs.org) 20 或更高版本**（用 `node -v` 查一下）。
然后从下面两种方式里选一个。

### 方式一 —— 加到你的 AI 里（推荐，什么都不用下载）

**Claude Code（命令行）：** 一行搞定 ——

```bash
claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
```

**Cursor、Claude Desktop、Codex 或任何 MCP 客户端：** 把下面这段加到客户端的
MCP 配置文件里 ——

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

重启应用，搞定。之后直接用大白话问。

### 方式二 —— 自己跑（想用看板、图表、历史数据时）

```bash
git clone https://github.com/0xBennie/binance-smart-money-oi-monitor.git
cd binance-smart-money-oi-monitor
npm install

npm run analyze -- ETH      # 测试一下 —— 在终端打印完整报告
npm run dashboard           # 网页看板，http://127.0.0.1:3001
```

## 举个例子

**你问：**《KAITO 的聪明钱现在什么情况？》

**你会得到**（就是上面那张英文卡片，换成大白话）：

| | 多头 | 空头 |
|---|---|---|
| 开仓均价 | $0.625 | $0.595 |
| 当前盈利比例 | **82%** | 15% |
| 仓位大小 | $28.8M | $14.9M |

现价：**$0.88** —— 外加持仓量、资金费率、头部账户多空比，一次问全。

一句话：鲸鱼**大多在做多**，成本大约在 **$0.62**，现价 **$0.88**，所以**约 82%
的鲸鱼现在是绿的** —— 这些币安网页上有、但普通 API 不给你的东西。

> ⏱️ 提示：聪明钱是币安的**每日**信号，所以这些开仓均价 / 盈利比例大约每天刷新
> 一次，不是每秒变 —— 适合看「大玩家站在哪边」，不适合拿来做秒级短线。

## 你可以问什么

直接用大白话问，你的 AI 会自动选对工具。

| 想知道…… | 工具 |
|---|---|
| **一个币的全部情况**（先用这个） | `get_full_picture` |
| 鲸鱼仓位和开仓均价 | `get_smart_money` |
| 头部账户多空比 + Taker 主动买卖 | `get_top_trader` |
| 持仓量 + 变化快慢 | `get_open_interest` |
| 资金费率 → 年化 % 和实付 $ | `get_funding` |
| 一张**可分享的卡片**（就是上面那种图） | `render_panel` |
| 一条能直发的 Telegram 消息 | `render_push` |

你还能**追踪一个币的时间变化** —— 仓位怎么变的、鲸鱼是越来越绿还是越来越红、
再画成一张图（`get_change`、`get_profit_trend`、`scan_extreme`、`render_chart`）。
这些需要 tracker 在跑，见[部署指南](docs/DEPLOYMENT.zh-CN.md)。

还有一个现成的 prompt `whale-cost` —— 一问就告诉你现价离鲸鱼成本线还有多远。

## 其他用法

- **命令行** —— `npm run analyze -- ETH`，在终端里打印一份完整报告。
- **网页看板** —— `npm run dashboard`，一张所有跟踪币的可排序总表。
- **告警** —— 聪明钱仓位骤变时推 Telegram；Python 版
  [altmonitor](altmonitor/README.md) 盯全市场的价格 / OI / 爆量异动。
- **当库用** —— `npm install binance-smart-money-oi-monitor`，然后
  `getSmartMoneyOverview('BTCUSDT')`。

## 使用须知

- **数据从哪来** —— 币安自己的「Smart Signal」网页。这个页面对频繁请求封得很凶，
  所以工具内置了防护，帮你避免被封。
- **区域被墙？** 设 `HTTPS_PROXY=http://host:port`，请求就走你的代理。
- **不构成投资建议。** 鲸鱼持仓是*参考背景*，不是买卖信号。自担风险。

更多细节：[部署与配置](docs/DEPLOYMENT.zh-CN.md) ·
[新手指南](GUIDE.zh-CN.md) · [Troubleshooting](TROUBLESHOOTING.md)

## 关于作者

由 **Bennie** 开发和维护 —— 加密货币交易者 & 交易工具开发者。

- 🐦 X / 推特：[@0xBenniee](https://x.com/0xBenniee)
- 💬 Telegram：[@OxBennie](https://t.me/OxBennie)
- 🏷️ 品牌：**Bennie Strategy**

有问题、想法或 bug？在 X / Telegram 找我，或者直接在这里开 issue。

## 致谢 & 许可证

Smart Signal 接口最早由
[andychien555](https://github.com/andychien555/binance-smart-money-tracker)
逆向；[BNSmartMoneyMonitor](https://github.com/y18929284608-byte/BNSmartMoneyMonitor)
与 [opentrade](https://github.com/6551Team/opentrade) 印证了接口契约。

MIT —— 见 [LICENSE](LICENSE)。欢迎 issue / PR。
