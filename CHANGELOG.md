# Changelog

All notable changes. Versions follow semver; dates are UTC.

## 1.9.0

User-experience pass.

- **`SMART_MONEY_DB_PATH`** — point the tracker and the MCP server / dashboard at the same DB regardless of working directory (removes the #1 "time-series tools say no data" footgun).
- **`npm run doctor`** — self-diagnosis: Node version, `better-sqlite3` / `express` availability, Binance reachability, circuit-breaker state, a live sample fetch, and local-DB snapshot count/freshness.
- **`npm run analyze <SYMBOL>`** — one-shot readable terminal report (no server, no AI).
- **MCP prompts** — `positioning`, `squeeze-scan`, `whale-cost` example workflows, so a new user knows what to ask.
- **`--help` / `--version`** on the bin.
- **Full-stack Docker** — `docker compose up -d` now runs altmonitor **+** the tracker **+** the dashboard, sharing one DB volume.
- Added `CHANGELOG.md` and `examples/`.

## 1.8.1

- `getSmartMoneyOverview` retries once on an empty `bapi` body before returning null (a blip no longer looks like "unsupported"); real 418 blocks still stop immediately.
- Dashboard loads `express` via a guarded dynamic import (clear message if the optional dep is missing).
- Tracker daemon warns when a sweep can't finish inside `SMART_MONEY_INTERVAL_MIN`.
- MCP server prints a hint when run bare in a TTY instead of silently waiting.
- Added `TROUBLESHOOTING.md`.

## 1.8.0

- **Local time-series tracking**: watchlist + self-scheduling daemon (`SMART_MONEY_WATCHLIST`, `SMART_MONEY_INTERVAL_MIN`) — no cron needed.
- `get_change` (per-side added/reduced over N min, in qty not USD), `scan_extreme` (market-wide most long/short-heavy), `render_chart` (long/short position + avg-entry time-series). CLI + library + MCP (now 10 MCP tools).

## 1.7.0

- Current price included in analysis; clearer error messages; README hero.

## 1.6.0 – 1.6.2

- `get_funding` — funding rate turned into money (annualized % + USD per settlement/day/year).
- Data-not-advice disclaimer on every analysis result.
- Baked-in attribution on the shareable cards.

## 1.5.0

- Per-side (long/short) smart-money **and** whale positions in every query — USD notional, average entry, in-profit counts.

## 1.0.0 – 1.4.x

- Initial releases: Binance Smart Signal scraper (17 whale fields) with 7-layer 418/429 protection, SQLite storage, Express dashboard, the MCP server, the shareable panel card, and the bundled `altmonitor` Telegram alert bot.
