# Troubleshooting

Every gotcha we (or an audit) actually hit, and the fix. Severity: 🔴 common / will-block · 🟡 situational · 🟢 minor. [简体版见 README.zh-CN.md 的「常见问题」](README.zh-CN.md#常见问题).

## Data availability & rate limits

**🔴 A symbol returns `no data — the symbol may be unsupported` but the perp clearly exists (e.g. POWER).**
Two different causes wear the same message:
- **Transient blip** — Binance's `bapi` Smart Money endpoint occasionally returns empty for a symbol that *does* have data. **Retry once or twice** — it usually comes back. (If `get_open_interest` / `get_funding` for the same symbol work, the perp is fine; it was a blip.)
- **Genuinely uncovered** — some low-volume perps have no Smart Signal whale data at all; `smartMoney` stays null while OI/funding still work. Check the coin's Smart Money tab on binance.com — blank there = no whale data; use OI/funding as fallback.

> Don't conclude "unsupported" from a single null. Retry first.

**🔴 Every tool — even the live ones — returns `Binance is temporarily rate-limited/blocked`.**
The 7-layer circuit breaker tripped process-wide on a 418 (soft, ~5 min) / 403 (hard, ~90 min, usually a CloudFront geo-block) / a `Retry-After`. All calls short-circuit **by design** — never retry-loop a 418. Wait for the TTL printed to stderr (`[binance-blocked] … ttl=Xs`); for a hard/geo block, run from a Binance-reachable region/VPS.

**🔴 Running locally in a Binance-blocked region → everything is empty.**
`bapi`/`fapi` are geo-restricted (e.g. mainland China without a proxy, or US for some endpoints). The MCP server / tracker must run somewhere that can reach Binance. Fix: set `HTTPS_PROXY=http://host:port` (since 1.9.3 the client tunnels its Binance calls through it; `NO_PROXY` bypasses named hosts), or run it on a VPS in the EU / Singapore / US-west. Quick test: `curl -v https://fapi.binance.com/fapi/v1/ping`.

## MCP & tools

**🔴 `get_change` / `scan_extreme` / `render_chart` say "no data" even though the tracker is running.**
These read a **local** `data/snapshots.db` at `process.cwd()/data/snapshots.db`. If the MCP server starts from a different directory than the tracker, they read different files. Fix: register with an explicit absolute `cwd` and run the tracker from that same root:
```jsonc
{ "mcpServers": { "smartmoney": { "command": "npx", "args": ["tsx", "src/scripts/mcp-server.ts"], "cwd": "/abs/path/to/repo" } } }
```
The 7 live tools (get_smart_money / get_full_picture / render_panel / …) need no DB and work from any cwd — only the 3 time-series tools need it.

**🔴 `get_change` says "not enough local history (need ≥2 snapshots)".**
The tracker hasn't recorded 2+ snapshots for that symbol yet (or they aged past 30-day retention). Run the tracker and let it accumulate; a 15-min window needs ~2 sweeps. Verify: `sqlite3 data/snapshots.db 'SELECT symbol, COUNT(*) c FROM ob_smart_money_snapshots GROUP BY symbol ORDER BY c DESC LIMIT 5;'`.

**🟡 `get_full_picture` is slow (~10 s) on the first call for a symbol.**
Live tools fan out to Binance; a cache miss = network, and `bapi` is deliberately paced (rate-sensitive). Expected on first/cold calls; the 10-min cache warms popular symbols. This is the speed-for-not-getting-banned trade-off.

**🟢 `render_panel` HTML won't render / `render_push` looks wrong.**
`render_panel` is a standalone page — save it with a `.html` extension. `render_push` is a Telegram message body — send it via `sendMessage` with `parse_mode=HTML`, don't open it as a file.

## Install

**🔴 `better-sqlite3` fails to build (`gyp ERR!`, `gcc failed`) — then DB features throw at runtime.**
It's an optional (native) dependency; the build can fail silently while the package still installs. Install a toolchain first (macOS `xcode-select --install`; Windows: VS Build Tools + Python 3; Linux: `build-essential`), then `rm -rf node_modules package-lock.json && npm install`. If you only want the live MCP tools, you can skip it — but the tracker and the 3 time-series tools need it.

**🔴 Dashboard: `Cannot find module 'express'`.**
`express` is also an optional dependency. `npm install`; if it's still missing, `npm install express`. (The live MCP tools don't need express — only the dashboard does.)

## Tracking & time-series (the daemon)

**🔴 Oversized watchlist + short interval → overlapping sweeps / `database is locked` / lost data.**
Sweeping is ~12 s/symbol, so ≤ ~70 symbols fit a 15-min cadence; more overruns it and concurrent sweeps contend on the SQLite WAL lock. Keep the watchlist small for high cadence, or lengthen `SMART_MONEY_INTERVAL_MIN`. Heed the ETA warning printed at startup.

**🟡 Hard-killing the daemon (SIGKILL) mid-sweep can leave a locked/again-slow DB.**
Always stop with SIGTERM/SIGINT (pm2/systemd/`docker stop` do this) so it closes the WAL cleanly. After an unclean kill: `sqlite3 data/snapshots.db 'PRAGMA integrity_check;'`.

**🟡 For long-term 24/7, prefer external cron over daemon mode.**
`SMART_MONEY_INTERVAL_MIN` (self-scheduling) is convenient, but for unattended deploys an external cron entry (or `docker compose` restart policy) recovers more predictably from repeated 418s.

## Publishing / releasing (maintainers)

**🔴 `npm publish` fails with `EOTP` (one-time password required).**
Your token lacks 2FA bypass, and a security-key/passkey 2FA has no TOTP code to pass via `--otp`. Fix: create an npm **Automation** token, or a **Granular** token with **"Bypass two-factor authentication (2FA)" checked** + read-write — that publishes without a prompt. (A plain read-write token authenticates but still demands an OTP.) A one-time **recovery code** also works as `--otp=<code>`.

**🔴 The Release-triggered `publish.yml` fails with `ENEEDAUTH`.**
No auth is configured. Pick one:
- **Trusted Publisher (recommended, no token):** npm → the package → Settings → Trusted Publishing → add GitHub Actions with owner `0xBennie`, repo `binance-smart-money-oi-monitor`, workflow `publish.yml`. Then Releases publish via OIDC — nothing to rotate or leak.
- **Token:** add an Automation/Bypass-2FA token as the repo secret `NPM_TOKEN`.

**🟢 `publish.yml` says "v… is already on npm — skipping".**
Not an error — the workflow no-ops when the version already exists. Bump `version` in `package.json` (and `SERVER_INFO` in `src/mcp-core.ts`) before the Release.

## Deploy — altmonitor (Telegram bot)

**🔴 Bot starts but no alerts / logs show "subscribed 0 streams" or "OI: N/A".**
The symbol-list or OI fetch hit a 418/429 or geo-block. Check startup logs for "subscribed ~530 streams"; if 0, wait out the backoff or move to a Binance-reachable region (see geo note above).

**🔴 `docker compose up` runs but the bot does nothing.**
You didn't fill credentials. `cp altmonitor/.env.example altmonitor/.env` and set `TG_BOT_TOKEN` + `TG_CHAT_ID` before `docker compose up -d`. State/history persist in the named volume, so a restart keeps your tuning.
