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
import { smartMoneyNotionalUsd } from '../binance-smart-money.js';
import { fmtChg } from '../format-num.js';

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
      const smNotionalUsd = smartMoneyNotionalUsd({
        longTradersQty: r.long_traders_qty,
        longTradersAvgEntryPrice: r.long_traders_avg_entry_price,
        shortTradersQty: r.short_traders_qty,
        shortTradersAvgEntryPrice: r.short_traders_avg_entry_price,
      });
      const smRatio = r.oi_now_usd && r.oi_now_usd > 0 && smNotionalUsd > 0
        ? smNotionalUsd / r.oi_now_usd
        : null;
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

const fmtPct = (v: number, digits = 0) => (v * 100).toFixed(digits) + '%';
const fmtNum = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 4 });
const fmtTs  = (ts: number) => new Date(ts).toISOString().slice(0, 19).replace('T', ' ');
const fmtOiUsd = (v: number | null): string => {
  if (v == null) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
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
  const sortFn = sorters[sort] || sorters.profitDiff;
  const sorted = [...rows].sort(sortFn);

  const trs = sorted.map(r => {
    const verdict =
      r.shortProfitPct - r.longProfitPct > 0.2 ? '🔴 空头大赢 (跌)' :
      r.longProfitPct - r.shortProfitPct > 0.2 ? '🟢 多头大赢 (涨)' :
      r.shortProfitPct - r.longProfitPct > 0.1 ? '🟡 空头略优' :
      r.longProfitPct - r.shortProfitPct > 0.1 ? '🟡 多头略优' : '⚪ 势均';
    const spreadStyle = r.whalePriceSpread > 0.05 ? 'color:#ef4444' : r.whalePriceSpread < -0.05 ? 'color:#22c55e' : '';
    return `
      <tr>
        <td><a href="/symbol/${encodeURIComponent(r.symbol)}">${htmlEscape(r.symbol)}</a></td>
        <td>${r.long_traders + r.short_traders} (W ${r.long_whales + r.short_whales})</td>
        <td>${r.long_short_ratio.toFixed(2)}</td>
        <td class="g">${fmtPct(r.longProfitPct)}</td>
        <td class="r">${fmtPct(r.shortProfitPct)}</td>
        <td class="g">${fmtPct(r.longWhaleProfitPct)}</td>
        <td class="r">${fmtPct(r.shortWhaleProfitPct)}</td>
        <td>${fmtNum(r.long_whales_avg_entry_price)}</td>
        <td>${fmtNum(r.short_whales_avg_entry_price)}</td>
        <td style="${spreadStyle}">${fmtPct(r.whalePriceSpread, 1)}</td>
        <td>${fmtOiUsd(r.oi_now_usd)}</td>
        <td ${chgClass(r.oi_chg_1h)}>${fmtChg(r.oi_chg_1h)}</td>
        <td ${chgClass(r.oi_chg_4h)}>${fmtChg(r.oi_chg_4h)}</td>
        <td>${r.smRatio == null ? '—' : fmtPct(r.smRatio, 1)}</td>
        <td>${verdict}</td>
        <td class="ts">${fmtTs(r.ts)}</td>
      </tr>`;
  }).join('');

  const sortLink = (key: string, label: string) =>
    `<a href="?sort=${key}" class="${sort === key ? 'active' : ''}">${label}</a>`;

  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><title>Smart Money Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif; background:#0a0a0a; color:#e4e4e7; margin:0; padding:16px; }
  h1 { font-size:18px; margin:0 0 4px; font-weight:600; }
  .meta { color:#71717a; font-size:12px; margin-bottom:12px; }
  .sortbar { margin-bottom:8px; display:flex; gap:12px; flex-wrap:wrap; font-size:12px; }
  .sortbar a { color:#71717a; text-decoration:none; padding:2px 6px; border-radius:4px; }
  .sortbar a.active { color:#fafafa; background:#27272a; }
  .sortbar a:hover { color:#fafafa; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  th, td { padding:6px 8px; text-align:right; border-bottom:1px solid #18181b; white-space:nowrap; }
  th { background:#18181b; color:#a1a1aa; font-weight:500; text-align:right; position:sticky; top:0; }
  th:first-child, td:first-child { text-align:left; }
  td:first-child a { color:#60a5fa; text-decoration:none; font-weight:500; }
  td:first-child a:hover { text-decoration:underline; }
  td.g { color:#86efac; }
  td.r { color:#fca5a5; }
  td.ts { color:#52525b; font-size:11px; }
  tr:hover { background:#18181b; }
</style></head>
<body>
  <h1>Smart Money Dashboard</h1>
  <div class="meta">${sorted.length} symbols · source: <code>binance bapi/futures/v1/public/future/smart-money/signal/overview</code> · refresh hourly</div>
  <div class="sortbar">
    <span style="color:#a1a1aa">sort:</span>
    ${sortLink('profitDiff', 'Profit Diff')}
    ${sortLink('whaleDiff', 'Whale Profit Diff')}
    ${sortLink('priceSpread', 'Whale Avg Spread')}
    ${sortLink('longShort', 'LSR Extreme')}
    ${sortLink('whales', 'Whale Count')}
    ${sortLink('oi', 'OI (USD)')}
    ${sortLink('oiChg1h', 'OI Δ 1h')}
    ${sortLink('oiChg4h', 'OI Δ 4h')}
    ${sortLink('smShare', 'SM Share')}
    ${sortLink('symbol', 'A-Z')}
  </div>
  <table>
    <thead><tr>
      <th>Symbol</th>
      <th>Traders (Whales)</th>
      <th>LSR</th>
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
      <th>SM Share</th>
      <th>Verdict</th>
      <th>Updated</th>
    </tr></thead>
    <tbody>${trs}</tbody>
  </table>
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
        <td style="color:#86efac">${fmtPct(r.long_profit_traders / Math.max(r.long_traders, 1))}</td>
        <td style="color:#fca5a5">${fmtPct(r.short_profit_traders / Math.max(r.short_traders, 1))}</td>
        <td>${fmtNum(r.long_whales_avg_entry_price)}</td>
        <td>${fmtNum(r.short_whales_avg_entry_price)}</td>
      </tr>`).join('\n')}
    </tbody>
  </table>
</body></html>`;
}

const app = express();

// CORS — README advertises /api/* as a JSON API; allow cross-origin GETs so
// frontends on other domains can consume it. Read-only, no credentials,
// so wildcard origin is safe.
app.use((_req, res, next) => {
  res.set('access-control-allow-origin', '*');
  res.set('access-control-allow-methods', 'GET, OPTIONS');
  res.set('access-control-allow-headers', 'content-type');
  next();
});

app.get('/', (req, res) => {
  const sort = String(req.query.sort || 'profitDiff');
  try {
    const rows = getLatestSnapshots();
    res.set('content-type', 'text/html; charset=utf-8').send(renderHtml(rows, sort));
  } catch (e: any) {
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
