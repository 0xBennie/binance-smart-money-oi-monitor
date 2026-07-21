# Binance Smart Money & OI Monitor

[![npm version](https://img.shields.io/npm/v/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![npm downloads](https://img.shields.io/npm/dm/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![CI](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/binance-smart-money-oi-monitor)](LICENSE)

**English** · [简体中文](README.zh-CN.md)

> Built by **[Bennie](https://x.com/0xBenniee)** ([Bennie Strategy](https://x.com/0xBenniee)) · [X @0xBenniee](https://x.com/0xBenniee) · [Telegram @OxBennie](https://t.me/OxBennie)

## What is this?

Binance's website has a **"Smart Money"** tab that shows where the big traders
(whales) are positioned on each coin. This tool pulls that data for **any Binance
USDT perpetual** — so you, or your AI, can just ask, instead of clicking around
the website.

It answers one simple question:

> **Which side are the whales on, what price did they buy in at, and are they
> winning right now?**

No API key. No sign-up. It only shows data — it never tells you to buy or sell.

<p align="center">
  <img src="https://raw.githubusercontent.com/0xBennie/binance-smart-money-oi-monitor/main/docs/panel-preview-en.png" width="49%" alt="Smart Money card (English)">
  <img src="https://raw.githubusercontent.com/0xBennie/binance-smart-money-oi-monitor/main/docs/panel-preview.png" width="49%" alt="Smart Money card (中文)">
</p>

## Install

You need **[Node.js](https://nodejs.org) 20 or newer** (check with `node -v`).
Then pick one of the two ways below.

### Option 1 — Add it to your AI (recommended, nothing to download)

**Claude Code (CLI):** one command —

```bash
claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
```

**Cursor, Claude Desktop, Codex, or any other MCP client:** add this to the
client's MCP config file —

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

Restart the app, and you're done. Now just ask in plain language.

### Option 2 — Run it yourself (for the dashboard, charts & history)

```bash
git clone https://github.com/0xBennie/binance-smart-money-oi-monitor.git
cd binance-smart-money-oi-monitor
npm install

npm run analyze -- ETH      # test it — prints a full report in your terminal
npm run dashboard           # web dashboard at http://127.0.0.1:3001
```

## Example

**You ask:** *"What's the smart money doing on KAITO?"*

**You get back** (this is the English card shown above, in plain numbers):

| | Long side | Short side |
|---|---|---|
| Avg entry price | $0.625 | $0.595 |
| In profit now | **82%** | 15% |
| Position size | $28.8M | $14.9M |

Current price: **$0.88** — plus open interest, funding rate, and the top-trader
ratio, all in one answer.

In plain terms: the whales are mostly **long**, they got in around **$0.62**, and
with price at **$0.88** about **82% of them are in the green** right now — the
stuff Binance shows on its website but doesn't hand you through the normal API.

> ⏱️ Note: Smart Money is Binance's **daily** signal, so these entry/profit
> numbers refresh about once a day, not every second — great for "where do the
> big players stand," not for second-by-second scalping.

## What you can ask for

Just ask naturally; your AI picks the right tool.

| To find out... | Tool |
|---|---|
| **Everything about a coin** (start here) | `get_full_picture` |
| Whale positions & entry prices | `get_smart_money` |
| Top-trader long/short + taker buy/sell | `get_top_trader` |
| Open interest + how fast it's moving | `get_open_interest` |
| Funding rate → yearly % and $ cost | `get_funding` |
| A **shareable card** (the images above) | `render_panel` |
| A ready-to-send Telegram message | `render_push` |

You can also track a coin **over time** — how positions changed, whether the
whales are getting greener or redder, and a chart of it all (`get_change`,
`get_profit_trend`, `scan_extreme`, `render_chart`). These need the tracker
running; see the [deployment guide](docs/DEPLOYMENT.md).

There's even a ready-made prompt, `whale-cost` — ask it and it tells you how far
the price is from the whales' entry.

## Other ways to use it

- **Command line** — `npm run analyze -- ETH` prints a full report in your terminal.
- **Web dashboard** — `npm run dashboard` gives you a sortable table of every coin you track.
- **Alerts** — get a Telegram ping when whale positions jump; the Python
  [altmonitor](altmonitor/README.md) watches the whole market for price / OI /
  volume spikes.
- **In your own code** — `npm install binance-smart-money-oi-monitor`, then
  `getSmartMoneyOverview('BTCUSDT')`.

## Good to know

- **Where the data comes from** — Binance's own "Smart Signal" web page. That
  page blocks aggressive requests, so this tool has built-in protection to keep
  you from getting blocked.
- **In a blocked region?** Set `HTTPS_PROXY=http://host:port` and it routes through your proxy.
- **Not financial advice.** Whale positioning is *context*, not a signal. Trade
  at your own risk.

More detail: [Deployment & config](docs/DEPLOYMENT.md) ·
[Getting started](GUIDE.md) · [Troubleshooting](TROUBLESHOOTING.md)

## About the author

Built and maintained by **Bennie** — crypto trader & trading-tools builder.

- 🐦 X / Twitter: [@0xBenniee](https://x.com/0xBenniee)
- 💬 Telegram: [@OxBennie](https://t.me/OxBennie)
- 🏷️ Brand: **Bennie Strategy**

Questions, ideas, or bugs? Reach out on X or Telegram, or open an issue here.

## Credits & license

Endpoint first reverse-engineered by
[andychien555](https://github.com/andychien555/binance-smart-money-tracker);
confirmed by [BNSmartMoneyMonitor](https://github.com/y18929284608-byte/BNSmartMoneyMonitor)
and [opentrade](https://github.com/6551Team/opentrade).

MIT — see [LICENSE](LICENSE). Issues and PRs welcome.
