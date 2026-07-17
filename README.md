# Binance Smart Money & OI Monitor

[![npm version](https://img.shields.io/npm/v/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![npm downloads](https://img.shields.io/npm/dm/binance-smart-money-oi-monitor)](https://www.npmjs.com/package/binance-smart-money-oi-monitor)
[![CI](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/0xBennie/binance-smart-money-oi-monitor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/binance-smart-money-oi-monitor)](LICENSE)
[![node](https://img.shields.io/node/v/binance-smart-money-oi-monitor)](package.json)

**English** · [简体中文](README.zh-CN.md)

> A **[Bennie Strategy](https://x.com/0xBenniee)** project · contact: [X @0xBenniee](https://x.com/0xBenniee) · [Telegram @OxBennie](https://t.me/OxBennie) · 🚀 new here? read the [Getting-Started Guide (中文)](GUIDE.zh-CN.md)

![Binance Smart Money panel — per-side whale positions, funding, self-contained shareable card](https://raw.githubusercontent.com/0xBennie/binance-smart-money-oi-monitor/main/docs/panel-preview.png)

Pulls the full 17-field whale overview behind Binance's **Smart Signal** page
(the "Smart Money" tab on binance.com Futures) — **whale average entry prices
and in-profit counts that the public `fapi` does not expose** — via the same
endpoint the website calls:

```
https://www.binance.com/bapi/futures/v1/public/future/smart-money/signal/overview?symbol=BTCUSDT
```

No API key. A 7-layer guard against `418/429/403` bans (one careless burst can
cost a 4-hour `Retry-After`). Geo-restricted region? Set
`HTTPS_PROXY=http://host:port`. **Numbers only** — every output reports data,
never a trading view.

---

## Quick start

No clone, no build — register the MCP server with your AI client:

```bash
claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
```

Ask "what is the smart-money positioning on ETH?" — the 7 live tools hit
Binance directly, no database, no config.

> The 4 time-series tools need local history first — see
> [Track over time (local DB)](#track-over-time-local-db).
> All environment variables: [`.env.example`](.env.example) · [Env vars](#env-vars).

---

## What you get vs. public fapi

| Field | Public `fapi/data` | This repo |
|---|---|---|
| `longShortRatio` | ✅ via `topLongShortPositionRatio` | ✅ |
| Top 20% account/position long-short ratios | ✅ | ✅ (bonus: also pulled) |
| Taker buy/sell ratio | ✅ | ✅ (bonus: also pulled) |
| Total Open Interest (USD) + 5m/15m/1h/4h velocity | ✅ | ✅ (bonus: also pulled) |
| **`longWhalesAvgEntryPrice` / `shortWhalesAvgEntryPrice`** | ❌ | ✅ |
| **`longProfitTraders` / `shortProfitTraders`** (in-profit count) | ❌ | ✅ |
| **`longProfitWhales` / `shortProfitWhales`** | ❌ | ✅ |
| **Smart Money's share of total market OI** (derived) | ❌ | ✅ |

The **bold** rows are the point: not just *which side has more positions*, but
*which side is actually making money right now*, and at what average entry.

### Example data

```
Symbol            Long Profit%   Short Profit%   Whale Avg L/S
1000RATSUSDT      5%             92%             0.034 / 0.042
1000LUNCUSDT      71%            41%             0.085 / 0.092
```

`Profit%` = share of that side's traders currently in profit. `Whale Avg L/S` =
average entry price of long whales / short whales. What it means for price is
up to you — this project reports the numbers, not a view.

---

## Six ways to use it

### MCP server (11 tools, any terminal AI)

Works with any MCP client — Claude Code, Claude Desktop, Codex CLI, Gemini CLI,
Cursor, Windsurf, Cline, Zed, Continue, …

```bash
claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
```

| Tool | Args | Returns |
|---|---|---|
| `get_full_picture` | `symbol`, `period?` | **The one-shot call**: per-side smart-money + whale positions, top-trader flow, OI, funding, SM share of total OI |
| `get_smart_money` | `symbol` | Per side: position (USD), whale-only position, **avg entry price**, **in-profit counts** — the bapi-only fields |
| `get_top_trader` | `symbol`, `period?` | Top-20% trader LSR + Taker buy/sell ratio (shorter-horizon flow) |
| `get_open_interest` | `symbol` | Total OI (USD **and** contracts) + 5m/15m/1h/4h velocity (contract count, so a price move isn't mistaken for an OI move) |
| `get_funding` | `symbol`, `notionalUsd?` | Funding rate → annualized % + USD paid/received per settlement / day / year (detects the real 8h/4h/1h interval) |
| `render_panel` | `symbol`, `includeHtml?`, `lang?` | Shareable dark HTML card, `zh` or `en` |
| `render_push` | `symbol`, `lang?` | Telegram-ready `parse_mode:HTML` message, `zh` or `en` |
| `get_change` * | `symbol`, `minutes?` | Qty each side **added/reduced** over N min (contracts, not USD) |
| `get_profit_trend` * | `symbol`, `minutes?` | How each side's **in-profit %** (traders + whales) moved over N min |
| `scan_extreme` * | `limit?`, `maxAgeMin?` | Market-wide **highest / lowest** smart-money LSR |
| `render_chart` * | `symbol`, `hours?` | 3-panel HTML chart: long qty, short qty, whale avg entry vs mark price |

`*` = reads the local tracker DB — see [Track over time (local DB)](#track-over-time-local-db).
Plus one prompt workflow: `whale-cost` (whale cost lines vs current price).

Example `get_full_picture ETH` result:

```json
{
  "symbol": "ETHUSDT",
  "smartMoney": { "longShortRatio": 0.288, "shortProfitPct": 72, "notionalUsd": 1860314867 },
  "topTrader": { "topPositionLsr": 1.50, "takerBuySellRatio": 1.16 },
  "openInterest": { "oiNowUsd": 3610164191, "oiChg4h": 0.55 },
  "smartMoneyShareOfOI": 0.515
}
```

> **Updating:** `npx` caches packages — remove and re-add `smartmoney` (or clear
> the npx cache), then restart the client.

<details>
<summary>Equivalent JSON config · running the MCP server from a clone</summary>

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

From a clone (no npm needed) — `npm run mcp`, or:

```json
{
  "mcpServers": {
    "smartmoney": {
      "command": "npx",
      "args": ["tsx", "src/scripts/mcp-server.ts"],
      "cwd": "/absolute/path/to/binance-smart-money-oi-monitor",
      "env": {
        "SMART_MONEY_DB_PATH": "/absolute/path/to/binance-smart-money-oi-monitor/data/snapshots.db"
      }
    }
  }
}
```
</details>

### CLI

From a clone, `npm run <cmd>`. All commands support `--help`; data commands support `--json`.

| Command | What |
|---|---|
| `npm run analyze -- <SYM>` | one-shot readable report for a coin (below) |
| `npm run panel -- <SYM>` | shareable dark-HTML Smart Money card |
| `npm run doctor` | Binance reachability / DB / native-deps check; READY/NOT READY is CI-gateable |
| `npm run track` | tracker daemon (`SMART_MONEY_WATCHLIST`, `SMART_MONEY_INTERVAL_MIN`) |
| `npm run change -- <SYM> [min] [--json]` | position-change table; needs tracker history |
| `npm run trend -- <SYM> [min] [--json]` | in-profit trend table; needs tracker history |
| `npm run scan` · `npm run chart -- <SYM>` | market scan / HTML chart; need tracker history |
| `npm run dashboard` · `npm run mcp` | dashboard + JSON API · MCP stdio server |

`npm run analyze -- BEAT` prints:

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

### Shareable cards

```bash
npm run panel -- BEAT       # writes beatusdt-panel.html; open & screenshot
```

Self-contained dark HTML (no external assets — renders anywhere). Cards default
to Chinese; set `SMART_MONEY_CARD_LANG=en` or pass `lang: "en"` per call. Same
card from the library (`renderPanelHtml(await buildPanel('BEAT'))`) or the MCP
tools `render_panel` / `render_push`. A data-not-advice disclaimer is baked in.

### Track over time (local DB)

Live calls are point-in-time. To answer *"how much did shorts add in the last
15 min"* or *"which coins are most one-sided right now"*, run the tracker so it
accumulates snapshots (SQLite, 30-day retention):

```bash
SMART_MONEY_WATCHLIST=BEAT,BIRB,MAGMA SMART_MONEY_INTERVAL_MIN=15 npm run track
```

A watchlist of ≤ ~70 symbols refreshes safely every 15 min (12s/symbol spacing);
an empty watchlist means the full market — use a longer interval or
[sharding](#production-deployment-pm2). A `watchlist.json` file works too.

> **One DB, absolute path.** Set `SMART_MONEY_DB_PATH` to the same absolute path
> for the tracker, the MCP server, and the dashboard — otherwise each process
> falls back to its own `cwd/data/snapshots.db` and the time-series tools read
> an empty file. (`docker compose` sets this for you.)

> **Installed via npm instead of a clone?** Run the tracker bin directly:
>
> ```bash
> SMART_MONEY_WATCHLIST=BEAT,BILL SMART_MONEY_DB_PATH=/abs/path/snapshots.db \
> SMART_MONEY_INTERVAL_MIN=15 npx binance-smart-money-oi-monitor-track
> ```

Query the accumulated history:

```bash
npm run change -- MAGMA 15   # qty added/reduced per side over ~15 min
npm run trend -- MAGMA 120   # trader/whale in-profit % trend
npm run scan                 # highest / lowest smart-money LSR
npm run chart -- BEAT 24     # beat-chart.html: positions + avg entry over 24h
```

Position deltas use **qty (contract count), not USD** — a price move isn't
mistaken for a position change.

### Dashboard + HTTP JSON API

```bash
npm run dashboard            # http://127.0.0.1:3001
```

A sortable table of every tracked symbol (LSR, profit %, whale avg entries,
spread, SM share of OI, OI velocity), per-symbol 30-day history, and a read-only
JSON API over the same DB:

| Route | Returns |
|---|---|
| `GET /api/snapshots` | Latest snapshot per symbol, enriched with profit % and SM-share-of-OI |
| `GET /api/symbol/:symbol/history?days=30` | One symbol's snapshot history |
| `GET /health` | `{ ok: true, port }` liveness probe |
| `GET /` · `GET /symbol/:symbol` | HTML dashboard · single-symbol 30-day view |

The API serves what the tracker has written — run it at least once first.

### Telegram alerts + altmonitor

**Position alerts (TypeScript, opt-in):** set `SMART_MONEY_ALERT_TG_TOKEN` +
`_CHAT_ID` and the tracker alerts when a watched symbol's smart-money position
moves past `SMART_MONEY_ALERT_QTY_PCT` (default 5%) or a side opens from zero.
Fingerprint + cooldown dedup — a plateaued move doesn't re-fire every sweep.

**[altmonitor](https://github.com/0xBennie/binance-smart-money-oi-monitor/tree/main/altmonitor) (Python, GitHub only — not in the npm package):**
watches **every** USDT perpetual over one WebSocket and alerts on three things —
±3% price moves within a 1m candle (with the price × OI quadrant), OI jumps over
1m/5m windows, and volume bursts vs the symbol's own baseline. Retune live via
Telegram commands (`/set_pump`, `/set_oi`, `/set_vol`, `/watch`, `/history`, …),
no API key needed. altmonitor tells you **when** something moves; the Smart
Money tools tell you **who** is positioned.

```bash
cd altmonitor && pip install -r requirements.txt && python setup.py   # guided setup
python altmonitor/deploy.py                                           # one-command VPS deploy
docker compose up -d              # whole stack: altmonitor + tracker + dashboard
```

Full command reference: [`altmonitor/README.md`](https://github.com/0xBennie/binance-smart-money-oi-monitor/tree/main/altmonitor#readme).

---

## As a library

```ts
import {
  getSmartMoneyOverview, getTopTraderSnapshot, getOpenInterest,
  smartMoneyNotionalUsd, smartMoneyShareOfOI,
} from 'binance-smart-money-oi-monitor';

const [sm, tt, oi] = await Promise.all([
  getSmartMoneyOverview('BTCUSDT'),      // 17 whale fields
  getTopTraderSnapshot('BTCUSDT', '5m'), // top-account LSR + Taker BSR
  getOpenInterest('BTCUSDT'),            // OI + 5m/15m/1h/4h velocity
]);

if (sm && oi) {
  console.log(`${sm.longWhales} long whales @ avg ${sm.longWhalesAvgEntryPrice}`);
  console.log(`SM share of OI: ${smartMoneyShareOfOI(sm, oi.oiNowUsd)}`);
}
```

> Use `smartMoneyNotionalUsd(sm)` for USD notional — Binance's undocumented
> `totalPositions` field has inconsistent units across symbols; the helper
> derives it from `qty × avg entry`, whose units are known.

Rate-limit helpers are re-exported (`isBinanceApiBlocked`,
`preflightBinanceFapi`, `waitForBinanceWeightHeadroom`) so your other Binance
calls can share the same circuit breaker. Install: `npm install
binance-smart-money-oi-monitor` (or `github:0xBennie/binance-smart-money-oi-monitor`).

---

## Run from a clone

Clone when you want the tracker, time-series history, or the dashboard:

```bash
git clone https://github.com/0xBennie/binance-smart-money-oi-monitor.git
cd binance-smart-money-oi-monitor
npm install

npx tsx src/scripts/smart-money-tick.ts                    # one-shot pull → data/snapshots.db
PORT=3001 npx tsx src/scripts/smart-money-dashboard.ts     # dashboard on the same db
npx tsx src/scripts/top-trader-tick.ts                     # optional: top-trader supplement
```

### Env vars

Every variable is optional. Copy [`.env.example`](.env.example) to `.env`, then
uncomment only what you need. Keep tokens out of Git.

| Var | Default | What |
|---|---|---|
| `SMART_MONEY_DB_PATH` | `<cwd>/data/snapshots.db` | Absolute path to the shared SQLite DB. Tracker, dashboard, and time-series MCP tools must use the same file |
| `SMART_MONEY_WATCHLIST` | *(none)* | Comma-separated symbols, such as `BTC,ETH,SOL`; empty means the full market |
| `SMART_MONEY_WATCHLIST_FILE` | `watchlist.json` | JSON array or `{ "symbols": [...] }` file; entries are combined with `SMART_MONEY_WATCHLIST` |
| `SMART_MONEY_INTERVAL_MIN` | `0` | `0` runs one sweep and exits; a positive value enables the self-scheduling daemon |
| `SMART_MONEY_POOL_MAX` | `0` | Maximum Smart Money symbols per sweep; `0` means all USDT perpetuals |
| `SMART_MONEY_SHARD_INDEX` | `0` | 0-based shard index when sharding (see below) |
| `SMART_MONEY_SHARD_TOTAL` | `1` | Total shards. `1` = no sharding |
| `TOP_TRADER_POOL_MAX` | `0` | Maximum top-trader symbols; `0` means all |
| `TOP_TRADER_SHARD_INDEX` | `0` | 0-based top-trader shard index |
| `TOP_TRADER_SHARD_TOTAL` | `1` | Total top-trader shards |
| `OI_POOL_MAX` | `0` | Maximum OI symbols; `0` means all |
| `OI_SHARD_INDEX` | `0` | 0-based OI shard index |
| `OI_SHARD_TOTAL` | `1` | Total OI shards |
| `SMART_MONEY_DASHBOARD_HOST` | `127.0.0.1` | Dashboard bind host; `0.0.0.0` exposes it to the network |
| `SMART_MONEY_DASHBOARD_PORT` | `3001` | Dashboard listen port |
| `SMART_MONEY_DASHBOARD_CORS` | *(off)* | Exact allowed browser origin; wildcard CORS is not used |
| `PORT` | `3001` | Legacy dashboard-port fallback |
| `SMART_MONEY_CARD_LANG` | `zh` | Default `render_panel` / `render_push` language: `zh` or `en`; a per-call `lang` overrides it |
| `SMART_MONEY_ALERT_TG_TOKEN` | *(none)* | Telegram bot token; alerts remain off unless token and chat ID are both set |
| `SMART_MONEY_ALERT_TG_CHAT_ID` | *(none)* | Telegram target chat ID |
| `SMART_MONEY_ALERT_WINDOW_MIN` | `30` | Alert lookback window in minutes |
| `SMART_MONEY_ALERT_QTY_PCT` | `5` | Absolute quantity-change percentage that triggers an alert |
| `HTTPS_PROXY` / `HTTP_PROXY` | *(none)* | Route **all** Binance calls through this proxy (e.g. `http://host:port`) — for geo-restricted regions. Direct connection when unset |
| `NO_PROXY` | *(none)* | Comma-separated hosts to bypass the proxy for (standard `NO_PROXY` semantics) |

---

## 7 layers of 418/429 protection

The Smart Signal endpoint lives on Binance's web `bapi` gateway — more
aggressive than `fapi`; one uncoordinated burst earned a **3.85-hour
Retry-After** in testing. All seven layers are on by default:

1. **Real `Retry-After` parsing** — uses the exact seconds Binance returns.
2. **Weight budget tracker** — reads `X-MBX-USED-WEIGHT-1M`; above 70% the next call sleeps to the next minute window.
3. **Pre-flight ping** — each cron entry pings `/fapi/v1/ping` first; on 418/403 it aborts before any data request.
4. **Jittered spacing** — 12s ± 3s (smart-money), 1s ± 200ms (top-trader); no fixed cadence for WAFs to flag.
5. **Exponential backoff** — repeated soft hits escalate the cooldown 5min → 15min → 60min.
6. **Process-wide circuit breaker** — `isBinanceApiBlocked()` short-circuits all downstream calls.
7. **Memory cache** — 10min (smart-money) / 5min (top-trader); repeat calls don't touch Binance.

There is deliberately **no retry path that ignores `Retry-After`** — retry-looping
a 418 is the fastest way to turn a 5-minute soft block into a multi-hour ban.

---

## Architecture

```
                    ┌──────────────────────────────────────────────────────┐
                    │                   library core                        │
                    │  getSmartMoneyOverview / getTopTraderSnapshot /       │
                    │  getOpenInterest — live Binance (bapi + fapi/data),   │
                    │  7-layer rate-limit guard                             │
                    └───────────────┬───────────────────────┬───────────────┘
                                    │                        │
        ┌───────────────────────────┘                        └────────────────────────┐
        │  TRACK A — cron → db → dashboard                    │  TRACK B — live, no DB   │
        ▼                                                     ▼                          │
┌─────────────────┐                                       ┌──────────────────────────┐
│ smart-money-tick│──┐                                    │  • Node import           │
├─────────────────┤  │ writes snapshots                   │  • MCP server            │
│ top-trader-tick │──┤                                    │      (stdio, 11 tools)   │
├─────────────────┤  │                                    │  • panel HTML            │
│ oi-tick         │──┘                                    └──────────────────────────┘
└─────────────────┘  │
                     ▼
      sqlite (data/snapshots.db, 30-day retention)
                     │ read-only
                     ▼
      Express dashboard + JSON API (:3001)
```

Both tracks call the same core, so the same rate-limit guard protects every
path. Track B (Node import / MCP / panel) hits Binance live and needs no cron
and no database; the 7 live MCP tools never load a native module.

---

## Production deployment (pm2)

Default is **all USDT perpetuals** (~500 contracts). Smart-money needs 12s/symbol
(≈100 min for 500), so full-market hourly freshness requires 2-way sharding;
top-trader/OI run at 1s/symbol (≈8 min) and fit anywhere.

| Mode | Symbols | smart-money cron | top-trader cron | OI cron | Sharding |
|---|---|---|---|---|---|
| **Light** | 100 cap | `7 * * * *` | `*/30 * * * *` | `15,45 * * * *` | None |
| **Standard** | 200 cap | `7 * * * *` | `*/30 * * * *` | `15,45 * * * *` | None |
| **Full, 2h refresh** | ~500 all | `0 */2 * * *` | `*/30 * * * *` | `15,45 * * * *` | None |
| **Full, 1h refresh** | ~500 all | `7,37 * * * *` (each half) | `*/30 * * * *` | `15,45 * * * *` | **2 shards** |

Shards split deterministically (`index % SHARD_TOTAL == SHARD_INDEX`). Tables
are pruned to 30 days (`RETENTION_DAYS` in `src/storage.ts`); disk usage at
default cadence is roughly 30–80 MB/month.

```js
// ecosystem.config.js — Standard mode
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
<summary>Full-market sharded (1h refresh) · 2-hour no-shard variant</summary>

Two entries, each pulls half at staggered times:

```js
{ name: 'smart-money-tick-a', script: 'node_modules/.bin/tsx',
  args: 'src/scripts/smart-money-tick.ts', cron_restart: '7 * * * *',
  autorestart: false, env: { SMART_MONEY_SHARD_INDEX: '0', SMART_MONEY_SHARD_TOTAL: '2' } },
{ name: 'smart-money-tick-b', script: 'node_modules/.bin/tsx',
  args: 'src/scripts/smart-money-tick.ts', cron_restart: '37 * * * *',
  autorestart: false, env: { SMART_MONEY_SHARD_INDEX: '1', SMART_MONEY_SHARD_TOTAL: '2' } },
```

Cheapest full-market option — one entry, `cron_restart: '0 */2 * * *'`, no env vars.

Stagger cron times regardless: the circuit breaker is per-process, but every
entry pre-flight-pings before requesting, so a fresh 418 in process A makes
process B abort cleanly — staggering gives the IP weight window time to drain.
</details>

---

## Troubleshooting

Full guide: **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**. Most common:

- **`no data — may be unsupported` but the perp exists** → usually a transient `bapi` blip; retry once. Some low-volume perps genuinely have no Smart Signal data (OI/funding still work).
- **Everything returns `temporarily rate-limited/blocked`** → the circuit breaker tripped (418/403); wait out the TTL in stderr, or run from a Binance-reachable region.
- **Time-series tools say "no data"** → tracker and MCP server aren't sharing one DB; set the same absolute `SMART_MONEY_DB_PATH` for both.
- **`npm publish` → `EOTP` / `ENEEDAUTH`** → use an npm token with **"Bypass 2FA"** checked, or configure a Trusted Publisher.

## What's *not* in this repo

- ❌ No trading — data only.
- ❌ No on-chain data, order book, or aggregated trades (see *Credits* for projects that do).
- ✅ Proxy **is** supported: `HTTPS_PROXY` / `NO_PROXY`.

---

## Author & contact

Built and maintained by **Bennie Strategy**.

- 🐦 X / Twitter: [@0xBenniee](https://x.com/0xBenniee) (zero-x, double-e)
- 💬 Telegram: [@OxBennie](https://t.me/OxBennie) (capital O)

Both handles are correct — not typos. Issues and PRs welcome.

---

## Credits

- **[andychien555/binance-smart-money-tracker](https://github.com/andychien555/binance-smart-money-tracker)** — original reverse-engineering of the Smart Signal endpoint (Cloudflare Workers + R2 architecture; this repo is the Node + sqlite + express take with stronger rate-limit protection).
- **[y18929284608-byte/BNSmartMoneyMonitor](https://github.com/y18929284608-byte/BNSmartMoneyMonitor)** and **[6551Team/opentrade](https://github.com/6551Team/opentrade)** — parallel implementations that confirmed the endpoint contract.

---

## License

MIT — see [LICENSE](LICENSE).
