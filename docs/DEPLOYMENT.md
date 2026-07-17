# Deployment & Configuration

English · [简体中文](DEPLOYMENT.zh-CN.md)

Everything beyond the zero-config MCP quick start: running from a clone, the
tracker, the dashboard, environment variables, rate-limit internals, and
production deployment with pm2.

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

### MCP server from a clone

`npm run mcp`, or the equivalent JSON client config:

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

(For the npm-published server it's simply `"command": "npx", "args": ["-y", "binance-smart-money-oi-monitor@latest"]`.)

> **Updating an npx-registered server:** `npx` caches packages — remove and
> re-add `smartmoney` (or clear the npx cache), then restart the client.

---

## Tracker (time-series history)

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

---

## Dashboard + HTTP JSON API

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

---

## Telegram position alerts

Opt-in: set `SMART_MONEY_ALERT_TG_TOKEN` + `SMART_MONEY_ALERT_TG_CHAT_ID` and
the tracker alerts when a watched symbol's smart-money position moves past
`SMART_MONEY_ALERT_QTY_PCT` (default 5%) or a side opens from zero.
Fingerprint + cooldown dedup — a plateaued move doesn't re-fire every sweep.

For full-market price/OI/volume burst alerts, see
[altmonitor](../altmonitor/README.md) (Python, GitHub only — not in the npm
package). `docker compose up -d` runs the whole stack: altmonitor + tracker +
dashboard.

---

## Env vars

Every variable is optional. Copy [`.env.example`](../.env.example) to `.env`,
then uncomment only what you need. Keep tokens out of Git.

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

The rate-limit helpers are re-exported from the library
(`isBinanceApiBlocked`, `preflightBinanceFapi`,
`waitForBinanceWeightHeadroom`) so your other Binance calls can share the same
circuit breaker.

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

### Full-market sharded (1h refresh)

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
