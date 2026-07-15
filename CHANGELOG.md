# Changelog

All notable changes. Versions follow semver; dates are UTC.

## 1.12.0

Selective UX integration built on the released `1.11.0` codebase. No breaking
API changes and no changes to OI, funding, profit, ratio, or notional units.

**Onboarding and documentation**
- Added a commented `.env.example` and complete, equivalent environment-variable tables in both READMEs.
- Added a zero-install MCP quick start and one canonical install command: `claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest`.
- Made the shared absolute `SMART_MONEY_DB_PATH` requirement explicit for tracker, dashboard, and all four time-series MCP tools.
- Added automated documentation contracts for release-version parity, env coverage, MCP commands, CLI examples, unique headings, and local anchors.

**Cards and MCP**
- `render_panel`, `render_push`, and their library renderers accept `lang: 'zh' | 'en'`; precedence is explicit argument, `SMART_MONEY_CARD_LANG`, then backward-compatible Chinese.
- English cards expand FR, LSR, and SM labels. Numeric values and percentage semantics remain unchanged.
- Ratio output now explains direction (`long ÷ short`; values above 1 mean the numerator dominates).
- Interpretive MCP outputs consistently include the data-not-advice disclaimer, including `get_change`, `get_profit_trend`, and `render_chart`; raw single-metric tools do not duplicate it.

**CLI and dashboard**
- `change` and `trend` now print readable tables by default, support `--json`, provide `--help`, and return non-zero on data errors.
- `doctor` prints a final READY / NOT READY verdict and fails only for blocking checks.
- Dashboard defaults to OI sorting and adds symbol search, match count, empty-state guidance, field legend/tooltips, data/load timestamps, and mobile horizontal scrolling.
- Missing-DB onboarding remains handled by the guarded `1.11.0` storage path and is covered by an HTTP route regression test.

## 1.11.0

An adversarially-verified audit batch — data-integrity, alert reliability, security, and internal consolidation. No breaking API changes (`FundingInfo.markPrice/indexPrice/lastFundingRate` are now `number | null` to stop NaN leaking into output).

**Tracker integrity & liveness**
- **Force fetch never returns a stale snapshot.** `getSmartMoneyOverview({ force })` (the tracker path) previously fell back to the cached snap — with its OLD `ts` — on a circuit-break or a data-less retry, so `INSERT OR REPLACE` rewrote the existing row and FROZE the time series. Force now returns fresh-or-`null`.
- **Partial-outage liveness.** The daemon's `STUCK` check only caught a *total* outage (0 rows written); a sweep that captured 1-of-400 symbols looked healthy. Added a second escalation when the fresh-capture yield stays below 25% for 3 consecutive sweeps.
- **No more false 30s "exceeded" warnings.** The per-symbol `Promise.race` hard-timeout timer was never cleared, so every SUCCESSFUL symbol logged a bogus "exceeded 30000ms" ~30s later and held the event loop open. The timer is now cleared once the race settles; the warning fires only when the timeout actually wins.
- **One price source everywhere.** The tracker recorded LAST price (`ticker/price`) while the push card + MCP tools render 现价/P&L from MARK price (`premiumIndex`). The tracker now stores `premiumIndex.markPrice`, so 现价 is consistent across every surface.
- Resolve the watchlist once per sweep (was parsed twice); fetch the symbol pool and price map concurrently.

**Alerts reliability**
- **Dedup + cooldown.** Alerts re-fired every sweep because `getChange` compares window endpoints (a plateaued move stays ≥ threshold all window) and there was no state. A per-symbol fingerprint (side + direction + bucketed %) now suppresses a repeat within the cooldown (≥ window).
- **Single-side moves fire.** Dropped the `triggers.length < 2` gate that made a genuine qty move depend on unrelated whale-P&L availability; P&L is now optional context.
- **From-zero new positions fire.** A brand-new position (0 → big) had `qtyChangePct = null` and was silently blocked; it now fires "多头/空头新建仓".
- **Short-side P&L.** Whale-P&L context is now computed for short-side events too (was long-only).
- **Send failures are visible.** `sendTelegram` surfaces the HTTP status/body; the tracker logs `alert NOT sent: … reason`. Sends are spaced 350ms and gated on BOTH token AND chat id.

**Dashboard**
- **`SM Share` fixed.** It divided gross-both-sides notional by single-sided OI (no `/2`, no clamp) → ~2× every other surface, could exceed 100%. Now uses the library `smartMoneyShareOfOI` helper (0..1, clamped).
- **CORS no longer wildcard.** `access-control-allow-origin: *` on a loopback server let any visited site read the watchlist cross-origin. CORS is now off by default; opt in with `SMART_MONEY_DASHBOARD_CORS=<origin>` (reflected, `Vary: Origin`).
- HTML routes (`/`, `/symbol/:symbol`) render a friendly "run the tracker first" page on a missing DB instead of a raw 500.

**Storage**
- **Read path survives a pre-1.9.4 DB.** Reads that opened their own connection selected `price` unconditionally; a DB whose migration hadn't run threw "no such column: price". Reads now probe `PRAGMA table_info` and select `NULL AS price` when the column is absent (+ a "no such column" hint).
- Reads reuse the live connection (cached statements) when one is open, instead of opening a new readonly handle per call on the alert hot path.
- `getDbReadonly` gained the `existsSync` guard its siblings have (throws a typed `MissingDbError`, code `ENOENT`).

**Consolidation / dedup**
- All three tick scripts (smart-money / oi / top-trader) now share one `getUsdtPerpetuals(binanceHttp, …)` resolver (shared keep-alive pool + used-weight accounting + 6h cache). `oi-tick` / `top-trader-tick` no longer use bare `axios`.
- Number formatters unified on `format-num.ts` — `format.ts`, the dashboard, and `chart.ts` consume it (added `fmtQty`; `fmtPct` gained a `digits` arg). Removes the divergent percent conventions that caused the 1.9.1 bug.
- `computePanel` builds its per-side breakdown from the canonical `smartMoneySide()`.
- The four DB-backed MCP tools share one `withLocalDb` wrapper.

**Correctness**
- Funding fields (`markPrice`/`indexPrice`/`lastFundingRate`) coerce non-finite → `null`, and the push header tests `Number.isFinite` — no more "FR NaN%".
- `chart.ts`: each series is materialized once (getVal was called 3×/row); price backfill uses a single two-pointer merge instead of an O(missing×klines) rescan.

**Docs / deploy**
- `docker-compose.yml` adds an `oi-tick` service (and optional `toptrader`) sharing the `smartmoney-data` volume — without it the dashboard OI / OIΔ / SM-Share columns were permanently empty in the documented deploy.
- README (EN + 中文) + GUIDE: run the tracker from an installed package via `npx binance-smart-money-oi-monitor-track` (there are multiple bins, not "only the MCP server").

## 1.10.2

Patch — defensive bounds on a daemon sweep (belt-and-suspenders for flaky proxies).

- `getSmartMoneyOverviewBatch` caps each symbol at 30s via `Promise.race`, so one stalled fetch can't hang the whole sweep (the hung promise resolves later, harmlessly).
- `waitForBinanceWeightHeadroom` sleep is clamped to ≤65s (the 1-min weight window never needs longer; guards against a corrupted reset marker).
- Caveat: these bound the *common* case. A proxy that stalls badly enough to block the Node event loop can still delay a sweep — client-side timers can't fire while the loop is blocked. For reliable cadence, run the tracker where Binance is directly reachable (a VPS) rather than behind a flaky local proxy.

## 1.10.1

Patch — hard request timeout so a flaky proxy can't hang a sweep.

- `binanceHttp` now enforces each request's timeout via `AbortSignal.timeout` in addition to axios's `timeout` option. axios's option does **not** abort a request stalled in a proxy CONNECT/TLS handshake — a flaky proxy was observed hanging a 10s-timeout request for 200s+, turning a ~15s tracker sweep into ~17min and starving the time series (snapshots ended up >30min apart → "not enough history"). `AbortSignal` aborts at the socket level regardless of the proxy agent (verified: a blackhole request now cancels at its timeout instead of hanging). Surfaced by the 1.9.3 proxy support.

## 1.10.0

New analysis features + a from-scratch guide. Tool count is now **11** (7 live + 4 DB-backed).

- **Whale-level change** — `get_change` now breaks out a per-side `whale` delta (庄家 qty added/reduced) next to the all-traders delta, plus `price` + `whaleAvg` so you can read 现价-vs-庄家均价 P&L directly.
- **Profit-ratio trend** — new `get_profit_trend` tool + `npm run trend <SYM> [min]` CLI: how each side's "% in profit" (traders AND whales) moved over N minutes — catches a flip from mostly-losing to mostly-winning that raw qty deltas miss.
- **Opt-in Telegram alerts** — new `alerts` module (`evaluateAlert` / `maybeAlert`). Set `SMART_MONEY_ALERT_TG_TOKEN` + `SMART_MONEY_ALERT_TG_CHAT_ID` (optional `SMART_MONEY_ALERT_QTY_PCT`, default 5; `SMART_MONEY_ALERT_WINDOW_MIN`, default 30) and the tracker auto-pushes a Telegram alert when a watchlist symbol's smart-money qty moves past the threshold (with 现价 vs 庄家均价 context). Off by default — sends nothing without your own bot token.
- **Multi-coin** — `SMART_MONEY_WATCHLIST` takes a comma list (`BEAT,BILL,MAGMA`); the tracker records all, and change/trend/chart/scan work per symbol. Documented in the guide.
- **新手指南 `GUIDE.zh-CN.md`** — from-scratch: what all 11 tools do, both usage modes (zero-deploy MCP + clone/monitor + alerts), proxy setup, and a real BILL walk-through. Linked from both READMEs and shipped in the package.

## 1.9.4

Positioning visualization + a sweep of correctness/security/doc fixes.

**Chart & price**
- **`render_chart` is now a 3-panel line chart** — 多头持仓 / 空头持仓 / 庄家均价 vs 现价 — each panel on its OWN y-scale, so a side's swings aren't flattened (long ~20M and short ~45M no longer share one axis). The price panel plots long/short whale (庄家) average entry against mark price, so you can see whether the whales are in profit or underwater; a 0-position side's avg no longer anchors the axis at $0. `buildChart` is now async.
- **Mark price is captured per snapshot** — new `price` column (auto-migrated via `ALTER TABLE`), filled from a single batch `ticker/price` call each sweep. `get_change` now returns `price` + per-side `whaleAvg` so a text report can show 现价 vs 庄家均价 P&L. Pre-1.9.4 rows backfill the price line from `klines` at render time (best-effort).

**Correctness**
- **`smartMoneyShareOfOI` no longer double-counts** — it summed both sides (long + short gross notional) but divided by single-sided Open Interest, so it overstated ~2× and could print >100%. Now `gross / (2 × OI)`, clamped to [0,1] (SM's share of total open position-sides).
- **`scanExtreme` no longer drops all-short symbols** — the `longShortRatio > 0` filter excluded symbols with 0 long traders (LSR 0), i.e. exactly the most-short case `mostShort` should surface; replaced with a finite-ratio check (the `minTraders` gate already drops no-data rows).
- **TG push 名义多空比 is a ratio, not a percent** — it rendered `1.5` as "150.00%"; now matches the HTML panel's plain `1.50`.
- **Ticker 24h change / volume are null-guarded** — a malformed payload made `priceChangePct24h` NaN → "NaN%" in the push header; non-finite now degrades to "—".
- **Sub-10-min cache collapse avoided** — the tracker forces a fresh fetch per sweep (a positive-cache hit returned the same snapshot with a frozen `ts`, so `INSERT OR REPLACE` collapsed the series when the interval was under the 10-min cache TTL).

**Proxy (hardening the 1.9.3 feature)**
- Proxy is now resolved **per request** (call-time env + per-host `NO_PROXY`), not once at module load — a `HTTPS_PROXY` set after import, or a `NO_PROXY` excluding one Binance host, is honored. Agents are cached by proxy target so keep-alive holds.
- `proxy-from-env` is now a declared dependency (it was only present transitively via axios, so strict installs — pnpm / Yarn PnP — could silently disable proxying).

**Ops & DX**
- **Daemon liveness** — after 3 consecutive empty sweeps the tracker logs an escalated `STUCK` error, so a permanently blocked IP / dead proxy is visible instead of looping silently while the supervisor shows "online".
- **Tracker `bin`** — `binance-smart-money-oi-monitor-track` lets npm-install (non-clone) users run the tracker without cloning.
- **MCP `period` validated** against the enum before hitting Binance (a bad value was forwarded and returned a misleading "unsupported").
- **CLIs** (`change`/`scan`/`chart`) print an actionable hint on a broken/absent `better-sqlite3` (e.g. ABI mismatch after a Node upgrade) instead of a raw stack trace.
- **Dashboard** binds `127.0.0.1` by default (opt into `0.0.0.0` via `SMART_MONEY_DASHBOARD_HOST`, with a security warning), HTML-escapes reflected `symbol` params (was reflected-XSS), and `/api/*` routes return JSON errors + handle a missing DB gracefully.
- **Docs** — README (EN + 中文) and TROUBLESHOOTING now document `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`, correct the tool count (10 = 7 live + 3 DB-backed), fix the "no native modules at runtime" wording (native module loads only when a DB tool is called), and show npm-install users how to run the tracker.

## 1.9.3

Proxy support + preflight resilience — makes the tracker and live tools actually work in the geo-restricted setups the docs point at.

- **HTTP(S) proxy support** — `binanceHttp` now honors `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`, tunneling through a proxy agent when the env names one (and falling back to a direct keep-alive agent otherwise). Previously the custom keep-alive agent silently disabled axios's built-in env-proxy handling, so every request went direct — which made `doctor`'s own "use a proxy / VPS" advice impossible to actually follow from a restricted region. Adds `https-proxy-agent` as a dependency.
- **Preflight retry** — `preflightBinanceFapi()` now retries a transient network blip (socket hang up / ECONNRESET / timeout — common on the first request behind a flaky proxy) up to 3× before declaring the region unreachable, instead of skipping the whole sweep on a single failure. A real WAF block (418 / 403 / 429) still aborts immediately without retry-hammering.

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
