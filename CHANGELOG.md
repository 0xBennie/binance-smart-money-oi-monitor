# Changelog

All notable changes. Versions follow semver; dates are UTC.

## 1.9.2

Code-review fixes — robustness for library consumers, daemon efficiency, and chart/scan correctness.

- **Lazy native load** — `storage` no longer imports `better-sqlite3` at module load time (it loaded eagerly via `src/index.ts`'s re-exports, crashing consumers whose optional native build failed even if they only used live, non-DB functions). The native addon is now `require`d on first DB use only. `import 'binance-smart-money-oi-monitor'` touches no native module until a DB op runs.
- **Call-time DB path** — the default DB path is resolved by a new `resolveDbPath()` at call time, so a consumer that imports before its `dotenv` runs still honors `SMART_MONEY_DB_PATH`. (Was a module-load-time const.)
- **Smart Money retry** — `waitForBinanceWeightHeadroom()` is now called once per fetch instead of once per retry attempt; a short (120s) negative cache tombstones data-less symbols so they no longer re-do 2 requests + a 400ms wait every sweep. The single transient-blip retry and "stop immediately on 418/block" behavior are preserved.
- **Chart NaN / off-box fix** — `chart.ts` panels now include legit 0-qty points in the y-range (were pushed far off-box) and fall back to safe `lo=0, hi=1` when a panel has no finite values (was `Math.min(...[]) = Infinity → NaN` coords/labels).
- **`scanExtreme` overlap fix** — `mostLong` and `mostShort` can no longer share a symbol when the universe is small (the common case: watchlist ~11-19, default limit 10).
- **Daemon WAL checkpoint** — the tracker daemon now runs `storage.checkpoint()` (`wal_checkpoint(TRUNCATE)`) after each sweep so a SIGKILL/OOM mid-write can't strand an uncheckpointed WAL.
- **`exchangeInfo` pooling** — the full-market symbol fetch uses the shared keep-alive `binanceHttp` pool + weight accounting (was bare `axios`) and caches the resolved list for 6h so daemon sweeps stop re-downloading the whole payload.
- **`doctor`** — now prints a WARN row when the DB file exists but `better-sqlite3` is unavailable (previously printed no DB row at all in exactly that case), and reuses `resolveDbPath()` instead of a hand-rolled default.
- **`analyze` cleanup** — profit-ratio rows use the shared `fmtPct` (with its null guard) instead of a local duplicate; PNL rows call `fmtUsd` directly (it already renders `—` for null).

## 1.9.1

Percent-unit fixes (the `oiChg*` fields are already percents; `smShareOfOI`-style ratios are 0..1 fractions — mixing the two up multiplies the display by 100).

- `npm run analyze`: OI 4h change rendered ×100 too big (e.g. `+434.3%` instead of `+4.3%`) — now routed through `fmtChg`. The bug was masked in testing because Binance was unreachable and the field printed `—`.
- Dashboard: the "SM share of OI" column double-multiplied (51.5% showed as `5150.0%`).
- `.dockerignore` now excludes `.env` so local secrets can't be baked into image layers by `COPY . .`.

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
