# Binance Smart Money & OI Monitor

[![npm version](https://img.shields.io/npm/v/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![npm downloads](https://img.shields.io/npm/dm/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![CI](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/binance-smart-money-oi-monitor)](LICENSE)

**English** · [简体中文](README.zh-CN.md)

> A **[Bennie Strategy](https://x.com/0xBenniee)** project · [X @0xBenniee](https://x.com/0xBenniee) · [Telegram @OxBennie](https://t.me/OxBennie)

**See the whale data behind Binance's "Smart Money" tab — the fields the public API doesn't expose.**

For any Binance USDT perpetual, it answers: *which side are the whales on, at
what average entry price, and are they actually in profit right now?* No API
key, no sign-up. **Numbers only — every output reports data, never a trading view.**

![Binance Smart Money panel](https://raw.githubusercontent.com/0xBennie/binance-smart-money-oi-monitor/main/docs/panel-preview.png)

## Quick start

Register the MCP server with your AI client — no clone, no build, no config:

```bash
claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
```

Then ask: *"What's the smart-money positioning on ETH?"*

Works with any MCP client (Claude Code / Desktop, Codex CLI, Cursor, Windsurf,
Cline, Zed, …). Geo-restricted region? Set `HTTPS_PROXY=http://host:port`.

## What you get that public `fapi` doesn't have

It calls the same endpoint the binance.com **Smart Signal** page uses, which
exposes fields absent from the public futures API:

| Exclusive field | What it tells you |
|---|---|
| `longWhalesAvgEntryPrice` / `shortWhalesAvgEntryPrice` | Whale average entry per side — cost lines vs current price |
| `longProfitTraders` / `shortProfitTraders` | How many traders on each side are in profit **right now** |
| `longProfitWhales` / `shortProfitWhales` | Same, whales only |
| Smart Money share of total OI (derived) | How much of the market the smart money *is* |

Standard data (top-trader long/short ratio, taker buy/sell, OI + velocity,
funding) is pulled too, so one call gives the full picture. Not *which side is
bigger* — *which side is making money, and from what entry.*

## Tools

7 live tools (straight from Binance) + 4 time-series tools (need the local
tracker, see below):

| Tool | Returns |
|---|---|
| `get_full_picture` ⭐ | One-shot: smart money + whales + top traders + OI + funding |
| `get_smart_money` | Per-side positions, **whale avg entry**, **in-profit counts** |
| `get_top_trader` | Top-20% account LSR + taker buy/sell ratio |
| `get_open_interest` | OI (USD & contracts) + 5m/15m/1h/4h velocity |
| `get_funding` | Funding rate → annualized % and USD cost |
| `render_panel` / `render_push` | Shareable HTML card / Telegram message (`zh`/`en`) |
| `get_change` * | Qty each side added/reduced over N minutes |
| `get_profit_trend` * | How each side's in-profit % moved over N minutes |
| `scan_extreme` * | Market-wide highest / lowest smart-money LSR |
| `render_chart` * | 3-panel chart: long/short positions + whale entry vs price |

`*` needs history — run the tracker to accumulate snapshots (SQLite, 30-day
retention):

```bash
SMART_MONEY_WATCHLIST=BTC,ETH,SOL SMART_MONEY_INTERVAL_MIN=15 npm run track
```

## Other ways to use it

- **CLI** — `npm run analyze -- <SYM>` for a one-shot readable report; also
  `panel`, `doctor`, `change`, `trend`, `scan`, `chart`, `dashboard`.
- **Dashboard + JSON API** — `npm run dashboard` → sortable table of every
  tracked symbol at `http://127.0.0.1:3001`.
- **Telegram alerts** — tracker alerts on smart-money position jumps;
  [altmonitor](altmonitor/README.md) (Python) adds full-market price/OI/volume
  burst alerts over one WebSocket. `docker compose up -d` runs the whole stack.
- **Library** — `npm install binance-smart-money-oi-monitor`, then
  `getSmartMoneyOverview('BTCUSDT')` for the raw 17 whale fields.

## Rate-limit safety

The endpoint sits on Binance's web `bapi` gateway, which bans aggressively (one
careless burst earned a ~4-hour `Retry-After` in testing). A 7-layer guard is
on by default — `Retry-After` parsing, weight budgeting, pre-flight pings,
jittered spacing, exponential backoff, a circuit breaker, and caching. Details
in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

- [Getting-Started Guide (中文)](GUIDE.zh-CN.md) — 5-minute walkthrough with real examples
- [Deployment & configuration](docs/DEPLOYMENT.md) — clone setup, tracker, dashboard, env vars, pm2, architecture
- [Troubleshooting](TROUBLESHOOTING.md) — every gotcha actually hit, with fixes
- [altmonitor](altmonitor/README.md) — the Python full-market alert bot

## Credits & license

Original endpoint reverse-engineering by
[andychien555/binance-smart-money-tracker](https://github.com/andychien555/binance-smart-money-tracker);
contract confirmed by
[BNSmartMoneyMonitor](https://github.com/y18929284608-byte/BNSmartMoneyMonitor)
and [opentrade](https://github.com/6551Team/opentrade).

MIT — see [LICENSE](LICENSE). Issues and PRs welcome:
[X @0xBenniee](https://x.com/0xBenniee) · [Telegram @OxBennie](https://t.me/OxBennie).
