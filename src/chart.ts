// Time-series chart of a symbol's smart-money positioning, from the local snapshot DB:
//   panel 1  多头持仓 (long qty)          — own y-scale, so its swings aren't flattened
//   panel 2  空头持仓 (short qty)         — own y-scale (long ~20M vs short ~45M no longer collide)
//   panel 3  庄家均价 vs 现价             — long/short whale avg entry + mark price, so you see
//                                           whether the 庄家 (whales) are in profit or underwater
// Self-contained dark HTML + inline SVG (no chart library, no external assets).
import { storage, type SmartMoneyHistoryRow } from './storage.js';
import { normalizeSymbol } from './symbol.js';
import { fmtPrice, fmtQty } from './format-num.js';
import { binanceHttp } from './binance-rate-limit.js';

export interface ChartData {
  symbol: string;
  rows: SmartMoneyHistoryRow[];
}

/** Backfill mark price for rows saved before 1.9.4 (price=null) from fapi klines, so
 * the 现价 line has history. Best-effort — on any failure, leaves price null (the line
 * simply omits those points). */
async function backfillPrices(symbol: string, rows: SmartMoneyHistoryRow[]): Promise<void> {
  const missing = rows.filter((r) => r.price == null);
  if (!missing.length || rows.length < 2) return;
  const t0 = rows[0]!.ts, t1 = rows[rows.length - 1]!.ts;
  const spanMs = t1 - t0;
  const interval = spanMs <= 16 * 3600_000 ? '1m' : spanMs <= 3 * 86400_000 ? '15m' : '1h';
  const stepMs = interval === '1m' ? 60_000 : interval === '15m' ? 900_000 : 3600_000;
  try {
    const resp = await binanceHttp.get('https://fapi.binance.com/fapi/v1/klines', {
      params: { symbol, interval, startTime: t0 - stepMs, endTime: t1 + stepMs, limit: 1000 },
      timeout: 10_000,
    });
    const kl = ((resp.data as any[][]) || []).map((k) => ({ t: k[0] as number, close: parseFloat(k[4]) }));
    if (!kl.length) return;
    // Both `missing` (subset of rows, ts ASC) and `kl` (klines, ts ASC) are sorted,
    // so advance a single kline pointer instead of rescanning kl from 0 per row.
    let ki = 0;
    for (const r of missing) {
      while (ki + 1 < kl.length && kl[ki + 1]!.t <= r.ts) ki++;   // last bucket at/before r.ts
      const best = kl[ki]!;
      if (best && Number.isFinite(best.close)) r.price = best.close;
    }
  } catch { /* leave price null */ }
}

export async function buildChart(symbol: string, hours = 24): Promise<ChartData> {
  const sym = normalizeSymbol(symbol);
  const rows = storage.smartMoneyHistory(sym, Date.now() - hours * 3_600_000);
  await backfillPrices(sym, rows);
  return { symbol: sym, rows };
}

const W = 780, PLOT_H = 150, GAP = 46, PAD_L = 8, PAD_R = 8;
const PLOT_W = W - PAD_L - PAD_R;
const GREEN = '#2ebd85', RED = '#f6465d', AMBER = '#f0b90b';

interface Series { label: string; color: string; getVal: (r: SmartMoneyHistoryRow) => number | null; }

function valid(v: number | null, dropNonPositive: boolean): v is number {
  return v != null && Number.isFinite(v) && (!dropNonPositive || v > 0);
}

function linePanel(
  title: string, rows: SmartMoneyHistoryRow[], topY: number,
  series: Series[], fmt: (v: number) => string, dropNonPositive = false,
): string {
  const t0 = rows[0]!.ts, t1 = rows[rows.length - 1]!.ts;
  // Materialize each series' valid (ts, v) points ONCE — getVal was previously
  // evaluated 3× per row (range scan + polyline vertices + last-label). Invalid
  // vertices (non-finite, or ≤0 when dropNonPositive — a 0 whale-avg = "no position"
  // that must NOT anchor the price axis at $0) are dropped here.
  const materialized = series.map((s) => {
    const pts: { ts: number; v: number }[] = [];
    for (const r of rows) { const v = s.getVal(r); if (valid(v, dropNonPositive)) pts.push({ ts: r.ts, v }); }
    return { s, pts };
  });
  const rangeVals = materialized.flatMap(({ pts }) => pts.map((p) => p.v));
  const vmin = rangeVals.length ? Math.min(...rangeVals) : 0;
  const vmax = rangeVals.length ? Math.max(...rangeVals) : 1;
  const pad = (vmax - vmin) * 0.08 || vmax * 0.08 || 1;
  const lo = Math.max(0, vmin - pad), hi = vmax + pad;
  const tSpan = t1 - t0 || 1, vSpan = hi - lo || 1;
  const lines = materialized.map(({ s, pts }) => {
    const str = pts.map(({ ts, v }) => {
      const x = PAD_L + ((ts - t0) / tSpan) * PLOT_W;
      const y = topY + PLOT_H - ((v - lo) / vSpan) * PLOT_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return str ? `<polyline points="${str}" fill="none" stroke="${s.color}" stroke-width="1.75"/>` : '';
  }).join('');
  const labels = materialized.map(({ s, pts }, i) => {
    const last = pts.length ? pts[pts.length - 1]!.v : null;
    return `<text x="${PAD_L + 4}" y="${topY + 14 + i * 14}" fill="${s.color}" font-size="11">${s.label} ${last != null ? fmt(last) : '—'}</text>`;
  }).join('');
  return `
    <text x="${PAD_L}" y="${topY - 6}" fill="#848e9c" font-size="12">${title}</text>
    <text x="${W - PAD_R}" y="${topY + 12}" fill="#5e6673" font-size="10" text-anchor="end">${fmt(hi)}</text>
    <text x="${W - PAD_R}" y="${topY + PLOT_H}" fill="#5e6673" font-size="10" text-anchor="end">${fmt(lo)}</text>
    <rect x="${PAD_L}" y="${topY}" width="${PLOT_W}" height="${PLOT_H}" fill="none" stroke="#2b3139"/>
    ${lines}${labels}`;
}

export function renderChartHtml(data: ChartData): string {
  const base = data.symbol.replace(/USDT$/, '').replace(/[^A-Z0-9]/g, '');
  const rows = data.rows;
  if (rows.length < 2) {
    return `<!doctype html><meta charset="utf-8"><body style="background:#0b0e11;color:#eaecef;font-family:sans-serif;padding:24px">
      <h3>${base}: 暂无足够的时序数据</h3>
      <p style="color:#848e9c">本地快照不足 2 条。先让 smart-money-tick 把 ${base} 采集一段时间（watchlist 里加上它），再来画图。</p></body>`;
  }
  const t0 = new Date(rows[0]!.ts).toISOString().slice(5, 16).replace('T', ' ');
  const t1 = new Date(rows[rows.length - 1]!.ts).toISOString().slice(5, 16).replace('T', ' ');
  const p1 = 52, p2 = 52 + PLOT_H + GAP, p3 = 52 + 2 * (PLOT_H + GAP);
  const H = p3 + 14 + PLOT_H + 34;
  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <text x="${PAD_L}" y="24" fill="#eaecef" font-size="18" font-weight="600">${base} <tspan fill="#848e9c" font-size="12" font-weight="400">聪明钱多空持仓 + 庄家均价 · 时序</tspan></text>
    <text x="${W - PAD_R}" y="24" fill="#5e6673" font-size="11" text-anchor="end">${rows.length} 点 · ${t0} → ${t1} UTC</text>
    <g transform="translate(0,${p1})">${linePanel('多头持仓 (张)', rows, 14, [{ label: '多头', color: GREEN, getVal: (r) => r.longQty }], fmtQty)}</g>
    <g transform="translate(0,${p2})">${linePanel('空头持仓 (张)', rows, 14, [{ label: '空头', color: RED, getVal: (r) => r.shortQty }], fmtQty)}</g>
    <g transform="translate(0,${p3})">${linePanel('庄家均价 vs 现价', rows, 14, [
      { label: '多头庄家', color: GREEN, getVal: (r) => r.longWhaleAvg },
      { label: '空头庄家', color: RED, getVal: (r) => r.shortWhaleAvg },
      { label: '现价', color: AMBER, getVal: (r) => r.price },
    ], (v) => fmtPrice(v), true)}</g>
    <text x="${PAD_L}" y="${H - 8}" fill="#5e6673" font-size="10">binance-smart-money-oi-monitor · @0xBenniee · 仅数据分析,非投资建议</text>
  </svg>`;
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${base} 聪明钱时序</title></head>
<body style="margin:0;background:#0b0e11;padding:16px">
<div style="max-width:${W + 32}px;margin:0 auto;background:#151a21;border:1px solid #2b3139;border-radius:14px;padding:12px 16px">${svg}</div>
</body></html>`;
}
