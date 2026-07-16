/**
 * Smart Money Dashboard — server-side rendered, single-file Express app.
 *
 * Usage:
 *   PORT=3001 tsx src/scripts/smart-money-dashboard.ts
 *
 * Routes:
 *   GET /                          — HTML dashboard with sortable table
 *   GET /symbol/:symbol            — single-symbol 30d history
 *   GET /api/snapshots             — JSON of all latest snapshots
 *   GET /api/symbol/:symbol/history?days=30  — single symbol history JSON
 *   GET /health                    — health probe
 */
import 'dotenv/config';
import { storage } from '../storage.js';
import { smartMoneyNotionalUsd, smartMoneyShareOfOI } from '../binance-smart-money.js';
import { fmtUsd, fmtPct, fmtChg } from '../format-num.js';

// express is an optional dependency (only the dashboard needs it). Load it
// dynamically so a missing/failed install gives a clear message, not a crash.
const _expressMod = await import('express').catch(() => null);
if (!_expressMod) {
  console.error('[dashboard] "express" is not installed — run: npm install express');
  process.exit(1);
}
const express = _expressMod.default;

const PORT = parseInt(process.env.SMART_MONEY_DASHBOARD_PORT || process.env.PORT || '3001', 10);
// Bind loopback by default so the snapshot DB + JSON API are NOT exposed to the
// whole network. A user can OPT IN to a public bind by setting
// SMART_MONEY_DASHBOARD_HOST=0.0.0.0 (e.g. behind their own auth/proxy).
const HOST = process.env.SMART_MONEY_DASHBOARD_HOST || '127.0.0.1';

/** Escape a string for safe interpolation into HTML text or double-quoted attrs. */
function htmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** True when a DB read failed because the snapshot file doesn't exist yet. */
function isMissingDbError(e: any): boolean {
  const code = e?.code;
  if (code === 'SQLITE_CANTOPEN' || code === 'ENOENT') return true;
  return /unable to open database file|no such file/i.test(String(e?.message || ''));
}

/** Friendly "run the tracker first" HTML for the no-DB-yet case (paired with the
 * JSON 503 the /api routes return), so a fresh install shows guidance not a raw 500. */
function missingDbHtml(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>Smart Money Dashboard — no data yet</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;background:#0a0a0a;color:#e4e4e7;margin:0;padding:32px;max-width:640px}
h1{font-size:18px}code{background:#18181b;padding:2px 6px;border-radius:4px;color:#fafafa}a{color:#60a5fa}</style></head>
<body>
  <h1>还没有本地数据</h1>
  <p>快照数据库还不存在——先把 tracker 跑起来采集一段时间,看板才有数据可显示。</p>
  <p>例如:<br><code>SMART_MONEY_WATCHLIST=BEAT,BILL SMART_MONEY_DB_PATH=/abs/path/snapshots.db npx binance-smart-money-oi-monitor-track</code></p>
  <p>确认 <code>SMART_MONEY_DB_PATH</code> 与看板指向<b>同一个库</b>。详见
  <a href="https://github.com/0xBennie/binance-smart-money-oi-monitor#readme">README</a>。</p>
</body></html>`;
}

interface SnapRow {
  symbol: string;
  ts: number;
  total_positions: number; total_traders: number; long_short_ratio: number;
  long_traders: number; long_traders_qty: number; long_traders_avg_entry_price: number;
  short_traders: number; short_traders_qty: number; short_traders_avg_entry_price: number;
  long_whales: number; long_whales_qty: number; long_whales_avg_entry_price: number;
  short_whales: number; short_whales_qty: number; short_whales_avg_entry_price: number;
  long_profit_traders: number; short_profit_traders: number;
  long_profit_whales: number; short_profit_whales: number;
  // Joined from ob_oi_snapshots (may be null if no OI snapshot yet)
  oi_now_usd: number | null; oi_chg_5m: number | null;
  oi_chg_15m: number | null; oi_chg_1h: number | null; oi_chg_4h: number | null;
}

interface EnrichedRow extends SnapRow {
  longProfitPct: number;
  shortProfitPct: number;
  longWhaleProfitPct: number;
  shortWhaleProfitPct: number;
  profitDiff: number;
  whaleProfitDiff: number;
  whalePriceSpread: number;
  // Smart Money notional in USD, derived from longTradersQty × avgEntry +
  // shortTradersQty × avgEntry (NOT from `totalPositions` whose unit is
  // ambiguous in binance's response).
  smNotionalUsd: number;
  // Share of total market OI (0..1), null if OI snapshot missing.
  smRatio: number | null;
}

function getLatestSnapshots(): EnrichedRow[] {
  const db = storage.getDbReadonly();
  try {
    // Latest smart-money row per symbol, LEFT-joined with latest OI row per symbol
    const rows = db.prepare(`
      SELECT s.*,
        o.oi_now_usd, o.oi_chg_5m, o.oi_chg_15m, o.oi_chg_1h, o.oi_chg_4h
      FROM ob_smart_money_snapshots s
      INNER JOIN (
        SELECT symbol, MAX(ts) AS max_ts
        FROM ob_smart_money_snapshots
        GROUP BY symbol
      ) latest ON s.symbol = latest.symbol AND s.ts = latest.max_ts
      LEFT JOIN (
        SELECT o2.* FROM ob_oi_snapshots o2
        INNER JOIN (
          SELECT symbol, MAX(ts) AS max_ts
          FROM ob_oi_snapshots
          GROUP BY symbol
        ) lo ON o2.symbol = lo.symbol AND o2.ts = lo.max_ts
      ) o ON s.symbol = o.symbol
      ORDER BY s.symbol
    `).all() as SnapRow[];

    return rows.map(r => {
      const lp = r.long_traders ? r.long_profit_traders / r.long_traders : 0;
      const sp = r.short_traders ? r.short_profit_traders / r.short_traders : 0;
      const lwp = r.long_whales ? r.long_profit_whales / r.long_whales : 0;
      const swp = r.short_whales ? r.short_profit_whales / r.short_whales : 0;
      const spread = r.long_whales_avg_entry_price
        ? (r.short_whales_avg_entry_price - r.long_whales_avg_entry_price) / r.long_whales_avg_entry_price
        : 0;
      // Derive SM USD notional from quantity × avg-entry (units are known),
      // not from `totalPositions` (binance returns inconsistent units).
      const smFields = {
        longTradersQty: r.long_traders_qty,
        longTradersAvgEntryPrice: r.long_traders_avg_entry_price,
        shortTradersQty: r.short_traders_qty,
        shortTradersAvgEntryPrice: r.short_traders_avg_entry_price,
      };
      const smNotionalUsd = smartMoneyNotionalUsd(smFields);
      // Use the canonical library helper: gross-both-sides ÷ (2 × single-sided OI),
      // clamped to [0,1]. The old inline `smNotionalUsd / oi_now_usd` omitted the /2,
      // so it double-counted (~2× every other surface) and could exceed 100%.
      const smRatio = smartMoneyShareOfOI(smFields, r.oi_now_usd);
      return {
        ...r,
        longProfitPct: lp,
        shortProfitPct: sp,
        longWhaleProfitPct: lwp,
        shortWhaleProfitPct: swp,
        profitDiff: Math.abs(sp - lp),
        whaleProfitDiff: Math.abs(swp - lwp),
        whalePriceSpread: spread,
        smNotionalUsd,
        smRatio,
      };
    });
  } finally {
    db.close();
  }
}

function getSymbolHistory(symbol: string, days = 30): SnapRow[] {
  const db = storage.getDbReadonly();
  try {
    return db.prepare(`
      SELECT * FROM ob_smart_money_snapshots
      WHERE symbol = ? AND ts > ?
      ORDER BY ts ASC
    `).all(symbol, Date.now() - days * 86400_000) as SnapRow[];
  } finally {
    db.close();
  }
}

// fmtPct (0..1 → %) and fmtUsd come from the shared format-num module (single
// source of truth for the ×100 convention + USD scaling). fmtNum/fmtTs/chgClass
// stay local — they're dashboard-specific (avg-entry precision, ISO ts, CSS class).
const fmtNum = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 4 });
const fmtTs  = (ts: number) => new Date(ts).toISOString().slice(0, 19).replace('T', ' ');
const chgClass = (v: number | null): string => {
  if (v == null) return '';
  if (v > 1) return 'class="g"';
  if (v < -1) return 'class="r"';
  return '';
};

function renderHtml(rows: EnrichedRow[], sort: string): string {
  const sorters: Record<string, (a: EnrichedRow, b: EnrichedRow) => number> = {
    symbol:       (a, b) => a.symbol.localeCompare(b.symbol),
    profitDiff:   (a, b) => b.profitDiff - a.profitDiff,
    whaleDiff:    (a, b) => b.whaleProfitDiff - a.whaleProfitDiff,
    priceSpread:  (a, b) => Math.abs(b.whalePriceSpread) - Math.abs(a.whalePriceSpread),
    longShort:    (a, b) => Math.abs(b.long_short_ratio - 1) - Math.abs(a.long_short_ratio - 1),
    whales:       (a, b) => (b.long_whales + b.short_whales) - (a.long_whales + a.short_whales),
    oi:           (a, b) => (b.oi_now_usd ?? 0) - (a.oi_now_usd ?? 0),
    oiChg1h:      (a, b) => Math.abs(b.oi_chg_1h ?? 0) - Math.abs(a.oi_chg_1h ?? 0),
    oiChg4h:      (a, b) => Math.abs(b.oi_chg_4h ?? 0) - Math.abs(a.oi_chg_4h ?? 0),
    smShare:      (a, b) => (b.smRatio ?? 0) - (a.smRatio ?? 0),
  };
  const sortFn = sorters[sort] || sorters.oi;
  const sorted = [...rows].sort(sortFn);
  const latestTs = rows.reduce((max, row) => Math.max(max, row.ts || 0), 0);
  const dataAsOf = latestTs > 0 ? fmtTs(latestTs) : '—';
  const loadedAt = fmtTs(Date.now());

  const trs = sorted.map(r => {
    return `
      <tr>
        <td><a href="/symbol/${encodeURIComponent(r.symbol)}">${htmlEscape(r.symbol)}</a></td>
        <td>${r.long_traders + r.short_traders} (W ${r.long_whales + r.short_whales})</td>
        <td>${r.long_short_ratio.toFixed(2)}</td>
        <td class="g">${fmtPct(r.longProfitPct, 0)}</td>
        <td class="r">${fmtPct(r.shortProfitPct, 0)}</td>
        <td class="g">${fmtPct(r.longWhaleProfitPct, 0)}</td>
        <td class="r">${fmtPct(r.shortWhaleProfitPct, 0)}</td>
        <td>${fmtNum(r.long_whales_avg_entry_price)}</td>
        <td>${fmtNum(r.short_whales_avg_entry_price)}</td>
        <td>${fmtPct(r.whalePriceSpread, 1)}</td>
        <td>${fmtUsd(r.oi_now_usd)}</td>
        <td ${chgClass(r.oi_chg_1h)}>${fmtChg(r.oi_chg_1h)}</td>
        <td ${chgClass(r.oi_chg_4h)}>${fmtChg(r.oi_chg_4h)}</td>
        <td>${r.smRatio == null ? '—' : fmtPct(r.smRatio, 1)}</td>
        <td class="ts">${fmtTs(r.ts)}</td>
      </tr>`;
  }).join('');

  const sortLink = (key: string, label: string) =>
    `<a href="?sort=${key}" class="${sort === key ? 'active' : ''}">${label}</a>`;
  const emptyRow = '<tr><td colspan="15" class="empty">No snapshots yet — the tracker has not captured a sweep. Check back in a few minutes.</td></tr>';
  const bodyRows = sorted.length ? trs : emptyRow;

  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><title>Smart Money Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif; background:#0a0a0a; color:#e4e4e7; margin:0; padding:16px; }
  h1 { font-size:18px; margin:0 0 4px; font-weight:600; }
  .meta { color:#71717a; font-size:12px; margin-bottom:8px; }
  .toolbar { margin-bottom:8px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .search-label { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
  #symbol-search { background:#18181b; border:1px solid #27272a; color:#fafafa; border-radius:6px; padding:5px 10px; font-size:12px; width:min(220px,100%); }
  #match-count, .sort-label { color:#71717a; font-size:12px; }
  .sortbar { margin-bottom:8px; display:flex; gap:12px; flex-wrap:wrap; font-size:12px; }
  .sortbar a { color:#71717a; text-decoration:none; padding:2px 6px; border-radius:4px; }
  .sortbar a.active { color:#fafafa; background:#27272a; }
  .sortbar a:hover { color:#fafafa; }
  .table-wrap { overflow-x:auto; border:1px solid #18181b; border-radius:6px; }
  table { border-collapse:collapse; width:100%; min-width:1120px; font-size:12px; }
  th, td { padding:6px 8px; text-align:right; border-bottom:1px solid #18181b; white-space:nowrap; }
  th { background:#18181b; color:#a1a1aa; font-weight:500; text-align:right; position:sticky; top:0; }
  th:first-child, td:first-child { text-align:left; }
  td:first-child a { color:#60a5fa; text-decoration:none; font-weight:500; }
  td:first-child a:hover { text-decoration:underline; }
  td.g { color:#86efac; }
  td.r { color:#fca5a5; }
  td.ts { color:#52525b; font-size:11px; }
  td.empty { text-align:center; color:#a1a1aa; padding:32px 8px; font-size:13px; }
  tr:hover { background:#18181b; }
  details.legend { margin-top:14px; color:#a1a1aa; font-size:12px; }
  details.legend summary { cursor:pointer; color:#71717a; }
  details.legend dl { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; margin:10px 0 0; max-width:720px; }
  details.legend dt { color:#fafafa; white-space:nowrap; }
  details.legend dd { margin:0; }
</style></head>
<body>
  <h1>Smart Money Dashboard</h1>
  <div class="meta">${sorted.length} symbols · source: <code>binance bapi/futures/v1/public/future/smart-money/signal/overview</code></div>
  <div class="meta">Data as of ${dataAsOf} UTC · Loaded ${loadedAt} UTC</div>
  <div class="toolbar">
    <label class="search-label" for="symbol-search">Filter by symbol</label>
    <input id="symbol-search" type="search" placeholder="Filter by symbol…" autocomplete="off" spellcheck="false">
    <span id="match-count"></span>
  </div>
  <div class="sortbar">
    <span class="sort-label">sort:</span>
    ${sortLink('oi', 'OI (USD)')}
    ${sortLink('symbol', 'A-Z')}
    ${sortLink('profitDiff', 'Profit Diff')}
    ${sortLink('whaleDiff', 'Whale Profit Diff')}
    ${sortLink('priceSpread', 'Whale Avg Spread')}
    ${sortLink('longShort', 'LSR Extreme')}
    ${sortLink('whales', 'Whale Count')}
    ${sortLink('oiChg1h', 'OI Δ 1h')}
    ${sortLink('oiChg4h', 'OI Δ 4h')}
    ${sortLink('smShare', 'SM Share')}
  </div>
  <div class="table-wrap">
  <table>
    <thead><tr>
      <th>Symbol</th>
      <th title="Total smart-money traders; Whales are the top 20% by margin balance">Traders (Whales)</th>
      <th title="Long/Short Ratio: above 1 is net long, below 1 is net short">LSR</th>
      <th>Long Profit%</th>
      <th>Short Profit%</th>
      <th>Long Whale Profit%</th>
      <th>Short Whale Profit%</th>
      <th>Long Whale Avg</th>
      <th>Short Whale Avg</th>
      <th>Spread</th>
      <th>OI</th>
      <th>OI Δ1h</th>
      <th>OI Δ4h</th>
      <th title="Smart Money notional divided by 2 × total OI, clamped to 100%">SM Share</th>
      <th>Updated</th>
    </tr></thead>
    <tbody id="dashboard-rows">${bodyRows}</tbody>
  </table>
  </div>
  <details class="legend">
    <summary>图例 / Legend</summary>
    <dl>
      <dt>LSR</dt><dd>Smart-money long ÷ short ratio.</dd>
      <dt>SM Share</dt><dd>Smart Money share of total OI, clamped to 100%.</dd>
      <dt>Spread</dt><dd>Difference between short- and long-whale average entries.</dd>
    </dl>
  </details>
  <script>
    (function () {
      var input = document.getElementById('symbol-search');
      var tbody = document.getElementById('dashboard-rows');
      var count = document.getElementById('match-count');
      if (!input || !tbody || !count) return;
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr')).filter(function (row) {
        return row.querySelector('td a');
      });
      input.addEventListener('input', function () {
        var query = input.value.trim().toUpperCase();
        var shown = 0;
        rows.forEach(function (row) {
          var link = row.querySelector('td a');
          var match = !query || (link && link.textContent.toUpperCase().indexOf(query) !== -1);
          row.hidden = !match;
          if (match) shown++;
        });
        count.textContent = query ? shown + ' / ' + rows.length + ' match' : '';
      });
    })();
  </script>
</body></html>`;
}

function renderSymbolHistoryHtml(symbol: string, rows: SnapRow[]): string {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><title>${htmlEscape(symbol)} — Smart Money History</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif; background:#0a0a0a; color:#e4e4e7; margin:0; padding:16px; }
  h1 { font-size:18px; margin:0 0 4px; }
  .meta { color:#71717a; font-size:12px; margin-bottom:12px; }
  a { color:#60a5fa; }
  table { border-collapse:collapse; width:100%; font-size:11px; margin-top:12px; }
  th,td { padding:4px 8px; border-bottom:1px solid #18181b; text-align:right; }
  th:first-child,td:first-child { text-align:left; }
  th { color:#a1a1aa; background:#18181b; }
</style></head>
<body>
  <h1><a href="/">←</a> ${htmlEscape(symbol)}</h1>
  <div class="meta">${rows.length} snapshots · 30 day history</div>
  <table>
    <thead><tr>
      <th>Time</th>
      <th>LSR</th>
      <th>Long/Short traders</th>
      <th>Long/Short whales</th>
      <th>Long Profit%</th>
      <th>Short Profit%</th>
      <th>Long Whale Avg</th>
      <th>Short Whale Avg</th>
    </tr></thead>
    <tbody>
${rows.slice().reverse().map(r => `      <tr>
        <td>${fmtTs(r.ts)}</td>
        <td>${r.long_short_ratio.toFixed(2)}</td>
        <td>${r.long_traders}/${r.short_traders}</td>
        <td>${r.long_whales}/${r.short_whales}</td>
        <td style="color:#86efac">${fmtPct(r.long_profit_traders / Math.max(r.long_traders, 1), 0)}</td>
        <td style="color:#fca5a5">${fmtPct(r.short_profit_traders / Math.max(r.short_traders, 1), 0)}</td>
        <td>${fmtNum(r.long_whales_avg_entry_price)}</td>
        <td>${fmtNum(r.short_whales_avg_entry_price)}</td>
      </tr>`).join('\n')}
    </tbody>
  </table>
</body></html>`;
}

const app = express();

// CORS — OFF by default. A wildcard `*` on a loopback server lets ANY website the
// user visits read the snapshot DB / watchlist cross-origin (the browser sends the
// request from the user's machine, which can reach 127.0.0.1). Opt in by setting
// SMART_MONEY_DASHBOARD_CORS=<origin> to allow exactly that one origin (reflected,
// with `Vary: Origin`). No CORS header at all for the 127.0.0.1 default.
const CORS_ORIGIN = process.env.SMART_MONEY_DASHBOARD_CORS;
if (CORS_ORIGIN) {
  app.use((_req, res, next) => {
    res.set('access-control-allow-origin', CORS_ORIGIN);
    res.set('vary', 'Origin');
    res.set('access-control-allow-methods', 'GET, OPTIONS');
    res.set('access-control-allow-headers', 'content-type');
    next();
  });
}

app.get('/', (req, res) => {
  const sort = String(req.query.sort || 'oi');
  try {
    const rows = getLatestSnapshots();
    res.set('content-type', 'text/html; charset=utf-8').send(renderHtml(rows, sort));
  } catch (e: any) {
    if (isMissingDbError(e)) {
      res.status(503).set('content-type', 'text/html; charset=utf-8').send(missingDbHtml());
      return;
    }
    res.status(500).send(`<pre>${htmlEscape(e?.message || 'internal error')}</pre>`);
  }
});

app.get('/symbol/:symbol', (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  try {
    const rows = getSymbolHistory(sym);
    if (rows.length === 0) {
      res.status(404).send(`<pre>no data for ${htmlEscape(sym)}</pre>`);
      return;
    }
    res.set('content-type', 'text/html; charset=utf-8').send(renderSymbolHistoryHtml(sym, rows));
  } catch (e: any) {
    if (isMissingDbError(e)) {
      res.status(503).set('content-type', 'text/html; charset=utf-8').send(missingDbHtml());
      return;
    }
    res.status(500).send(`<pre>${htmlEscape(e?.message || 'internal error')}</pre>`);
  }
});

app.get('/api/snapshots', (_req, res) => {
  try {
    res.json(getLatestSnapshots());
  } catch (e: any) {
    if (isMissingDbError(e)) {
      res.status(503).json({ error: 'no local DB yet — run the tracker first' });
      return;
    }
    res.status(500).json({ error: e?.message || 'internal error' });
  }
});

app.get('/api/symbol/:symbol/history', (req, res) => {
  try {
    // Guard the numeric query param so `?days=abc` doesn't become NaN.
    let days = Number(req.query.days);
    if (!Number.isFinite(days) || days <= 0) days = 30;
    res.json(getSymbolHistory(req.params.symbol.toUpperCase(), days));
  } catch (e: any) {
    if (isMissingDbError(e)) {
      res.status(503).json({ error: 'no local DB yet — run the tracker first' });
      return;
    }
    res.status(500).json({ error: e?.message || 'internal error' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, port: PORT }));

if (HOST === '0.0.0.0' || HOST === '::') {
  console.warn(`[SmartMoneyDashboard] SECURITY: binding ${HOST} exposes the snapshot DB + JSON API to the whole network — put it behind auth/a proxy or use 127.0.0.1.`);
}

app.listen(PORT, HOST, () => {
  console.log(`[SmartMoneyDashboard] listening on http://${HOST}:${PORT}`);
});
