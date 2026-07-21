# Getting Started — binance-smart-money-oi-monitor

**English** · [简体中文](GUIDE.zh-CN.md)

> Understand it in 5 minutes: what this tool shows, the two ways to use it, and a real walkthrough.
> **It's a data / context tool, not a buy-sell signal** — smart-money positioning has no validated predictive power for whether price goes up next (AUC ≈ 0.5). Use it to see *who's on which side, at what cost, and whether they're winning* — don't trade it like a signal.
> Built by [Bennie Strategy](https://x.com/0xBenniee) · X [@0xBenniee](https://x.com/0xBenniee) · Telegram [@OxBennie](https://t.me/OxBennie)

---

## 1. What it does (the big picture)

It pulls Binance's own **Smart Signal (Smart Money)** data — **the whale entry prices and in-profit whale counts the public fapi won't give you**, 17 fields in all — plus open interest, funding, and top-trader ratios. It saves that as a local time series, so you can query it, scan it, chart it, and get alerts.

**11 MCP tools, in two groups:**

| Group | Tool | What it's for |
|---|---|---|
| **Live (7, no local DB needed)** | `get_smart_money` | A coin's long/short smart-money positions, entry price, in-profit counts |
| | `get_full_picture` | ⭐ Everything at once: smart money + whales + top traders + OI + funding (most used) |
| | `get_top_trader` | Top-trader long/short ratio + taker buy/sell ratio |
| | `get_open_interest` | OI plus its 5m / 15m / 1h / 4h rate of change |
| | `get_funding` | Funding rate converted into money (per settlement / per day / annualized) |
| | `render_panel` / `render_push` | A shareable panel card / a ready-to-send Telegram card |
| **Time series (4, tracker must collect data first)** | `get_change` | How many contracts each side **added/cut** over the last N minutes (incl. **whale-level** + current price vs whale entry P&L) |
| | `get_profit_trend` | How the in-profit share shifts over time (**flips from losing to winning, or the reverse**) |
| | `scan_extreme` | Market-wide ranking of highest / lowest long-short ratio |
| | `render_chart` | **Three-panel line chart**: long positions / short positions / whale entry vs current price |

---

## 2. Mode A — zero-setup queries (fastest)

No clone, no server. Register the MCP server with your terminal AI:

```bash
claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
```

Then just ask your AI in plain language:
- "Show me the smart money on BILL" → runs `get_smart_money`
- "What's BILL's position structure right now" → runs `get_full_picture`
- "Make me a panel card for BEAT" → runs `render_panel`

Cards default to Chinese. For English cards set `SMART_MONEY_CARD_LANG=en`, or pass `lang: "en"` in the `render_panel` / `render_push` call.

> ⚠️ The 4 time-series tools (change / trend / scan / chart) are empty in zero-setup mode — they read the local tracker DB. See Mode B.
> ⚠️ Already registered and want to upgrade: `claude mcp remove smartmoney` then add again (npx caches the old version).

---

## 3. Mode B — continuous tracking + charts + alerts

```bash
git clone https://github.com/0xBennie/binance-smart-money-oi-monitor
cd binance-smart-money-oi-monitor && npm install
npm run doctor          # self-check: is Binance reachable? is better-sqlite3 installed?
```

**1) Run the tracker to build history (multi-coin)** — the key is `SMART_MONEY_DB_PATH` as an **absolute path**, so every command below reads the same DB:

```bash
SMART_MONEY_WATCHLIST=BEAT,BILL,MAGMA \
SMART_MONEY_DB_PATH=~/sm/snapshots.db \
SMART_MONEY_INTERVAL_MIN=15 \
npm run track           # long-running; records one snapshot every 15 minutes
```

**2) Once you have ≥2 snapshots, query anytime:**

```bash
SMART_MONEY_DB_PATH=~/sm/snapshots.db npm run analyze -- BILL      # one-shot readable live report for a coin
SMART_MONEY_DB_PATH=~/sm/snapshots.db npm run change  -- BILL 30   # last 30m: contracts added/cut per side (incl. whales)
SMART_MONEY_DB_PATH=~/sm/snapshots.db npm run trend   -- BILL 120  # in-profit share over 120m
SMART_MONEY_DB_PATH=~/sm/snapshots.db npm run scan    -- 20        # market-wide top/bottom 20 by long-short ratio
SMART_MONEY_DB_PATH=~/sm/snapshots.db npm run chart   -- BILL      # three-panel HTML chart
SMART_MONEY_DB_PATH=~/sm/snapshots.db npm run panel   -- BILL      # shareable panel card (HTML) — screenshot for a tweet
npm run dashboard                                                  # web dashboard at http://127.0.0.1:3001 (binds 127.0.0.1 only)
```

`analyze` / `change` / `trend` print a human-readable table by default. When a machine needs to read the output, use `--json` — and add `--silent` so npm's own banner doesn't leak into the JSON:

```bash
npm run --silent change -- BILL 30 --json
```

`npm run doctor` ends with **READY / NOT READY** and only returns a non-zero exit code on blocking issues. The dashboard supports coin search, data/load timestamps, a field legend, and mobile horizontal scroll; on an empty DB it shows how to start the tracker.

> npm-install (non-clone) users can run the tracker too: `npx binance-smart-money-oi-monitor-track` (same env vars).

**3) Alerts (optional, opt-in)** — only fires if you set a TG token; auto-pushes when a threshold trips:

```bash
SMART_MONEY_WATCHLIST=BILL SMART_MONEY_DB_PATH=~/sm/snapshots.db SMART_MONEY_INTERVAL_MIN=15 \
SMART_MONEY_ALERT_TG_TOKEN=<your bot token> \
SMART_MONEY_ALERT_TG_CHAT_ID=<your chat id> \
SMART_MONEY_ALERT_QTY_PCT=5 \
npm run track
```

**Restricted region:** set `HTTPS_PROXY=http://host:port` and the client routes every Binance request through your proxy (since 1.9.3).

---

## 4. A real example — BILL (how to read the structure)

One real tracking run (a snapshot every 15 minutes) showed this:

1. **`change`** showed longs adding again and again: +1.6% → +3.7% → **+11.6% cumulative**, with the entry price drifting *down* not up = averaging down / scaling in; then it pulled back and chopped.
2. Later, shorts cut **−3.6% all at once** (breaking the range) while longs kept adding → both sides moving the same way, net position tilting long.
3. **`trend`** showed the long in-profit share going 95% → 80% (whales 96% → 76%) = the paper profit got diluted after all that scaling in.
4. **`chart`** panel 3 made it obvious: **current price climbing up toward the long whales' entry (0.0635)**, whale paper loss narrowing from −11% to −5%.

**How to read it:** contract counts (qty, price-independent) tell you *who's adding or cutting*; whale entry vs current price tells you *whether whales are winning*; the in-profit share over time tells you *whether the structure is improving or deteriorating*. You need all three together for the full picture. **But one window ≠ a trend, and a trend ≠ a buy/sell signal.**

---

## 5. Disclaimer

This tool provides data and structural analysis only. It is **not investment advice** and never outputs buy/sell or directional signals. Smart-money / whale positioning has no validated predictive edge over price — treat it as *context*, make your own decisions, and trade at your own risk.