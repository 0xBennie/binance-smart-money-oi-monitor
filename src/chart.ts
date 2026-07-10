// Time-series chart of a symbol's smart-money long/short position (qty) and average
// entry over time, from the local snapshot DB. Self-contained dark HTML + inline SVG
// (no chart library, no external assets) — open in a browser and screenshot.
import { storage, type SmartMoneyHistoryRow } from './storage.js';
import { normalizeSymbol } from './symbol.js';
import { fmtPrice } from './format-num.js';

export interface ChartData {
  symbol: string;
  rows: SmartMoneyHistoryRow[];
}

export function buildChart(symbol: string, hours = 24): ChartData {
  const sym = normalizeSymbol(symbol);
  const rows = storage.smartMoneyHistory(sym, Date.now() - hours * 3_600_000);
  return { symbol: sym, rows };
}

const W = 780, PLOT_H = 170, PAD_L = 8, PAD_R = 8;
const PLOT_W = W - PAD_L - PAD_R;

function fmtQty(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
}

/** Build an SVG polyline `points` string for one series over the plot area. */
function points(
  rows: SmartMoneyHistoryRow[], getVal: (r: SmartMoneyHistoryRow) => number,
  t0: number, t1: number, vmin: number, vmax: number, topY: number,
): string {
  const tSpan = t1 - t0 || 1;
  const vSpan = vmax - vmin || 1;
  return rows.map((r) => {
    const x = PAD_L + ((r.ts - t0) / tSpan) * PLOT_W;
    const y = topY + PLOT_H - ((getVal(r) - vmin) / vSpan) * PLOT_H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function panel(
  title: string, rows: SmartMoneyHistoryRow[], topY: number,
  longVal: (r: SmartMoneyHistoryRow) => number, shortVal: (r: SmartMoneyHistoryRow) => number,
  fmt: (v: number) => string,
): string {
  const t0 = rows[0]!.ts, t1 = rows[rows.length - 1]!.ts;
  // Include legit 0-qty points (a side can be flat 0 at some ticks) — only drop
  // non-finite values. Filtering v>0 pushed zero points far off-box.
  const vals = rows.flatMap((r) => [longVal(r), shortVal(r)]).filter((v) => Number.isFinite(v));
  // Empty vals → Math.min(...[]) is Infinity → NaN coords/labels. Use safe flat defaults.
  const vmin = vals.length ? Math.min(...vals) : 0;
  const vmax = vals.length ? Math.max(...vals) : 1;
  const pad = (vmax - vmin) * 0.08 || vmax * 0.08 || 1;
  const lo = Math.max(0, vmin - pad), hi = vmax + pad;
  const longPts = points(rows, longVal, t0, t1, lo, hi, topY);
  const shortPts = points(rows, shortVal, t0, t1, lo, hi, topY);
  const lastLong = longVal(rows[rows.length - 1]!);
  const lastShort = shortVal(rows[rows.length - 1]!);
  return `
    <text x="${PAD_L}" y="${topY - 6}" fill="#848e9c" font-size="12">${title}</text>
    <text x="${W - PAD_R}" y="${topY + 12}" fill="#5e6673" font-size="10" text-anchor="end">${fmt(hi)}</text>
    <text x="${W - PAD_R}" y="${topY + PLOT_H}" fill="#5e6673" font-size="10" text-anchor="end">${fmt(lo)}</text>
    <rect x="${PAD_L}" y="${topY}" width="${PLOT_W}" height="${PLOT_H}" fill="none" stroke="#2b3139"/>
    <polyline points="${shortPts}" fill="none" stroke="#f6465d" stroke-width="1.75"/>
    <polyline points="${longPts}" fill="none" stroke="#2ebd85" stroke-width="1.75"/>
    <text x="${PAD_L + 4}" y="${topY + 14}" fill="#2ebd85" font-size="11">多头 ${fmt(lastLong)}</text>
    <text x="${PAD_L + 4}" y="${topY + 28}" fill="#f6465d" font-size="11">空头 ${fmt(lastShort)}</text>`;
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
  const H = 60 + PLOT_H + 50 + PLOT_H + 40;
  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <text x="${PAD_L}" y="24" fill="#eaecef" font-size="18" font-weight="600">${base} <tspan fill="#848e9c" font-size="12" font-weight="400">聪明钱多空 · 时序</tspan></text>
    <text x="${W - PAD_R}" y="24" fill="#5e6673" font-size="11" text-anchor="end">${rows.length} 点 · ${t0} → ${t1} UTC</text>
    <g transform="translate(0,52)">${panel('持仓量 (qty)', rows, 14, (r) => r.longQty, (r) => r.shortQty, fmtQty)}</g>
    <g transform="translate(0,${52 + PLOT_H + 44})">${panel('平均开仓价', rows, 14, (r) => r.longAvg, (r) => r.shortAvg, (v) => fmtPrice(v))}</g>
    <text x="${PAD_L}" y="${H - 8}" fill="#5e6673" font-size="10">binance-smart-money-oi-monitor · @0xBenniee</text>
  </svg>`;
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${base} 聪明钱时序</title></head>
<body style="margin:0;background:#0b0e11;padding:16px">
<div style="max-width:${W + 32}px;margin:0 auto;background:#151a21;border:1px solid #2b3139;border-radius:14px;padding:12px 16px">${svg}</div>
</body></html>`;
}
