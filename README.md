# binance-smart-money-tracker

Production-grade scraper for **Binance Smart Signal** (the "Smart Money" tab on
binance.com Futures) — pulls the full 17-field whale overview that the public
`fapi` API does **not** expose, with a 7-layer defense against `418 / 429 / 403`
rate-limit bans.

This is the URL that `binance.com/zh-CN/smart-money/signal/<symbol>` calls
behind the scenes:

```
https://www.binance.com/bapi/futures/v1/public/future/smart-money/signal/overview?symbol=BTCUSDT
```

No API key required. No proxy required (works directly from most VPS regions).
But Binance enforces an undocumented per-IP weight budget, and a single careless
burst can cost you a 4-hour `Retry-After`. This repo solves that.

---

## What you get vs. public fapi

| Field | Public `fapi/data` | This repo |
|---|---|---|
| `longShortRatio` | ✅ via `topLongShortPositionRatio` | ✅ |
| Top 20% account/position long-short ratios | ✅ | ✅ (bonus: also pulled) |
| Taker buy/sell ratio | ✅ | ✅ (bonus: also pulled) |
| **`longWhalesAvgEntryPrice` / `shortWhalesAvgEntryPrice`** | ❌ | ✅ |
| **`longProfitTraders` / `shortProfitTraders`** (in-profit count) | ❌ | ✅ |
| **`longProfitWhales` / `shortProfitWhales`** | ❌ | ✅ |

The four ★ fields are what makes Smart Signal useful — they tell you not just
*which side has more positions*, but *which side is actually making money right
now*, and at what average entry. Public `fapi` can't tell you any of that.

### Example interpretation

```
Symbol            Long Profit%   Short Profit%   Whale Avg L/S    Verdict
1000RATSUSDT      5%             92%             0.034 / 0.042    🔴 shorts winning big (price has dropped)
1000LUNCUSDT      71%            41%             0.085 / 0.092    🟢 longs winning big (price has run)
```

When `Short Whale Avg Entry > Long Whale Avg Entry` by >5%, it usually means
shorts entered too late and are about to get squeezed.

---

## Architecture

```
┌─────────────────┐         ┌──────────────────────────────┐
│ smart-money-tick│ cron 60m├──► binance bapi smart-money  │
└────────┬────────┘         └──────────────────────────────┘
         │                                │
         │ writes ob_smart_money_snapshots│
         ▼                                ▼
┌─────────────────────────────────────────────┐
│           sqlite (data/snapshots.db)         │
│   ob_smart_money_snapshots (21 columns)      │
│   ob_top_trader_snapshots  (12 columns)      │
└────────────────────┬─────────────────────────┘
                     │ read-only
                     ▼
            ┌──────────────────┐
            │ Express dashboard │   http://your-host:3001/
            │ + JSON API        │
            └──────────────────┘

┌─────────────────┐         ┌──────────────────────────────┐
│ top-trader-tick │ cron 30m├──► binance fapi/futures/data │
└─────────────────┘         └──────────────────────────────┘
```

- **One sqlite file**, two tables, 30-day retention
- **One Express dashboard** with server-side rendering (no JS framework)
- **Two cron entry points** (smart-money 60min, top-trader 30min) — staggered
- **Library mode**: `import { getSmartMoneyOverview } from 'binance-smart-money-tracker'`

---

## 7 layers of 418/429 protection

The Smart Signal endpoint lives on Binance's web `bapi` gateway, which is more
aggressive than `fapi`. A single uncoordinated burst can earn a **3.85-hour
Retry-After** (verified empirically). All seven layers below are wired up
by default:

1. **Real `Retry-After` parsing** — uses the exact seconds Binance returns,
   not a guess. `parseInt(response.headers['retry-after'])`.
2. **Weight budget tracker** — reads `X-MBX-USED-WEIGHT-1M` from every fapi
   response; when utilization > 70%, the next call sleeps to the next minute
   window before firing.
3. **Pre-flight ping** — every cron entry pings `/fapi/v1/ping` once before
   the batch; on 418/403 it aborts immediately, no further requests fired.
4. **Jittered spacing** — smart-money batches use 12s ± 3s, top-trader uses
   1s ± 200ms. Avoids forming a predictable cadence that WAFs flag.
5. **Exponential backoff** — consecutive soft hits within 1 hour escalate
   the cooldown 5min → 15min → 60min.
6. **Process-wide circuit breaker** — `isBinanceApiBlocked()` short-circuits
   *all* downstream calls in the same process; `getSmartMoneyOverview()` and
   `getTopTraderSnapshot()` return cached or null without firing.
7. **Memory cache** — 10min for smart-money, 5min for top-trader. Repeated
   calls to the same symbol within the window don't hit Binance at all.

There is **no retry-on-failure path that ignores `Retry-After`**. That is
intentional. The single fastest way to escalate a 5-minute soft block into a
multi-hour hard block is to retry-loop a 418 — don't.

---

## Quick start

```bash
git clone https://github.com/0xBennie/binance-smart-money-tracker.git
cd binance-smart-money-tracker
npm install

# 1. One-shot pull (writes to data/snapshots.db)
npx tsx src/scripts/smart-money-tick.ts

# 2. Start the dashboard (reads from the same db)
PORT=3001 npx tsx src/scripts/smart-money-dashboard.ts
# → http://localhost:3001/

# 3. Optional: also pull top-trader supplement (Taker ratio + 5min LSR)
npx tsx src/scripts/top-trader-tick.ts
```

### Tweaks

| Env var | Default | What |
|---|---|---|
| `SMART_MONEY_POOL_MAX` | `150` | Cap of USDT-PERPETUAL symbols pulled per cron |
| `TOP_TRADER_POOL_MAX` | `150` | Same for top-trader cron |
| `SMART_MONEY_DASHBOARD_PORT` / `PORT` | `3001` | Dashboard listen port |

### As a library

```ts
import { getSmartMoneyOverview } from 'binance-smart-money-tracker';

const snap = await getSmartMoneyOverview('BTCUSDT');
if (snap) {
  console.log(`${snap.longWhales} long whales @ avg ${snap.longWhalesAvgEntryPrice}`);
  console.log(`${snap.longProfitTraders}/${snap.longTraders} longs in profit`);
}
```

The library re-exports all rate-limit helpers
(`isBinanceApiBlocked`, `preflightBinanceFapi`, `waitForBinanceWeightHeadroom`)
so you can integrate the same circuit breaker into your other Binance calls
and share one weight budget across modules.

---

## Production deployment (pm2)

```js
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'smart-money-tick',
      script: 'node_modules/.bin/tsx',
      args: 'src/scripts/smart-money-tick.ts',
      cron_restart: '7 * * * *',       // :07 every hour
      autorestart: false,
    },
    {
      name: 'top-trader-tick',
      script: 'node_modules/.bin/tsx',
      args: 'src/scripts/top-trader-tick.ts 5m',
      cron_restart: '*/30 * * * *',    // every 30 min
      autorestart: false,
    },
    {
      name: 'smart-money-dashboard',
      script: 'node_modules/.bin/tsx',
      args: 'src/scripts/smart-money-dashboard.ts',
      autorestart: true,
      env: { PORT: '3001' },
    },
  ],
};
```

Stagger the crons (`:07` vs `:00/:30`) so they don't bunch onto the same IP
weight window. They share the same circuit breaker state inside a single
process — across processes (separate pm2 entries) the preflight ping
re-syncs state on each invocation, so they're safe.

---

## What's *not* in this repo

- ❌ No trading. This is data only.
- ❌ No proxy. If your IP gets a hard 403 (CloudFront WAF), the only fix is
  to wait it out or change IP. The whole point of the protection layers is
  to never get there.
- ❌ No on-chain data, no order book, no aggregated trades. For that, see
  the projects in *Credits*.

---

## Credits

- **[andychien555/binance-smart-money-tracker](https://github.com/andychien555/binance-smart-money-tracker)**
  — original reverse-engineering of the `bapi/futures/v1/public/future/smart-money/signal/overview`
  endpoint. Their version is built on Cloudflare Workers + R2 with a static SPA
  frontend; this repo is the Node + sqlite + express version with stronger
  rate-limit protection. Different architecture, same source insight.
- **[y18929284608-byte/BNSmartMoneyMonitor](https://github.com/y18929284608-byte/BNSmartMoneyMonitor)**
  and **[6551Team/opentrade](https://github.com/6551Team/opentrade)** —
  parallel implementations that confirmed the endpoint contract.

---

## License

MIT — see [LICENSE](LICENSE).
