// Renders a shareable "Smart Money overview" panel (the binance.com Smart Signal
// card look) as a self-contained dark HTML file — screenshot it for a tweet, or
// embed the string in your own site. Powered by the same library data.

import {
  getSmartMoneyOverview,
  smartMoneyNotionalUsd,
  smartMoneyShareOfOI,
  type SmartMoneyOverview,
} from './binance-smart-money.js';
import { getTicker24h } from './binance-ticker.js';
import { getOpenInterest, type OpenInterestSnapshot } from './binance-open-interest.js';
import { getTopTraderSnapshot, type TopTraderSnapshot } from './binance-top-trader.js';

export interface PanelSide {
  traders: number;
  whales: number;
  notionalUsd: number;
  avgEntry: number;
  profitPct: number;      // 0..1
  pnlUsd: number | null;  // null when current price is unknown
}

export interface PanelData {
  symbol: string;
  price: number | null;
  generatedAt: number;
  totalNotionalUsd: number;
  totalTraders: number;
  longShareOfTotal: number;   // 0..1 (by notional) — for the split bar
  longShortNotionalRatio: number | null;
  long: PanelSide;
  short: PanelSide;
  topPositionLsr: number | null;
  takerBsr: number | null;
  smShareOfOI: number | null;
  oiNowUsd: number | null;
  oiChg1h: number | null;
  oiChg4h: number | null;
}

/** Pure: derive the panel from an overview + current price (+ optional extras). */
export function computePanel(
  sm: SmartMoneyOverview,
  price: number | null,
  extras: { oi?: OpenInterestSnapshot | null; tt?: TopTraderSnapshot | null } = {},
): PanelData {
  const longNotional = sm.longTradersQty * sm.longTradersAvgEntryPrice;
  const shortNotional = sm.shortTradersQty * sm.shortTradersAvgEntryPrice;
  const total = longNotional + shortNotional;
  const { oi, tt } = extras;
  return {
    symbol: sm.symbol,
    price,
    generatedAt: Date.now(),
    totalNotionalUsd: smartMoneyNotionalUsd(sm),
    totalTraders: sm.totalTraders || sm.longTraders + sm.shortTraders,
    longShareOfTotal: total > 0 ? longNotional / total : 0.5,
    longShortNotionalRatio: shortNotional > 0 ? longNotional / shortNotional : null,
    long: {
      traders: sm.longTraders,
      whales: sm.longWhales,
      notionalUsd: longNotional,
      avgEntry: sm.longTradersAvgEntryPrice,
      profitPct: sm.longTraders ? sm.longProfitTraders / sm.longTraders : 0,
      pnlUsd: price != null ? sm.longTradersQty * (price - sm.longTradersAvgEntryPrice) : null,
    },
    short: {
      traders: sm.shortTraders,
      whales: sm.shortWhales,
      notionalUsd: shortNotional,
      avgEntry: sm.shortTradersAvgEntryPrice,
      profitPct: sm.shortTraders ? sm.shortProfitTraders / sm.shortTraders : 0,
      pnlUsd: price != null ? sm.shortTradersQty * (sm.shortTradersAvgEntryPrice - price) : null,
    },
    topPositionLsr: tt?.topPositionLSR ?? null,
    takerBsr: tt?.takerBSR ?? null,
    smShareOfOI: oi ? smartMoneyShareOfOI(sm, oi.oiNowUsd) : null,
    oiNowUsd: oi?.oiNowUsd ?? null,
    oiChg1h: oi?.oiChg1h ?? null,
    oiChg4h: oi?.oiChg4h ?? null,
  };
}

/** Fetch live data for a symbol and build the panel, or null if unavailable. */
export async function buildPanel(symbol: string): Promise<PanelData | null> {
  const sym = symbol.trim().toUpperCase().endsWith('USDT')
    ? symbol.trim().toUpperCase()
    : `${symbol.trim().toUpperCase()}USDT`;
  const [sm, tk, oi, tt] = await Promise.all([
    getSmartMoneyOverview(sym),
    getTicker24h(sym),
    getOpenInterest(sym),
    getTopTraderSnapshot(sym, '5m'),
  ]);
  if (!sm) return null;
  return computePanel(sm, tk?.lastPrice ?? null, { oi, tt });
}

// ── HTML rendering ───────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function fmtUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
const fmtPct = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(2)}%`);
const fmtChg = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`);
function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v >= 1 ? v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : v.toPrecision(4);
}

/** Self-contained dark HTML for the panel (no external assets). */
export function renderPanelHtml(d: PanelData): string {
  const base = esc(d.symbol.replace(/USDT$/, ''));
  const longPct = Math.max(2, Math.min(98, d.longShareOfTotal * 100));
  const when = new Date(d.generatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const side = (label: string, s: PanelSide, up: boolean) => {
    const col = up ? '#2ebd85' : '#f6465d';
    const state = s.pnlUsd == null ? '' : s.pnlUsd >= 0 ? '↗ 盈利中' : '↘ 亏损中';
    return `
    <div style="border:1px solid ${col}33;background:${col}14;border-radius:10px;padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="color:${col};font-weight:600">${up ? '▲' : '▼'} ${label} · ${s.traders} 交易员（${s.whales} 大户）</span>
        <span style="color:${col};font-size:13px">${state}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:14px;color:#b7bdc6">
        <span>当前仓位 <b style="color:#eaecef;font-weight:500">${fmtUsd(s.notionalUsd)}</b></span>
        <span>平均开仓价 <b style="color:#eaecef;font-weight:500">${fmtPrice(s.avgEntry)}</b></span>
        <span>预估 PNL <b style="color:${col};font-weight:500">${fmtUsd(s.pnlUsd)}</b></span>
        <span>盈利比例 <b style="color:${col};font-weight:500">${fmtPct(s.profitPct)}</b></span>
      </div>
      <div style="margin-top:10px;height:6px;border-radius:99px;background:#2b3139">
        <div style="width:${(s.profitPct * 100).toFixed(1)}%;height:6px;border-radius:99px;background:${col}"></div>
      </div>
    </div>`;
  };
  const stat = (label: string, val: string) =>
    `<div style="min-width:92px"><div style="color:#848e9c;font-size:12px">${label}</div><div style="color:#eaecef;font-size:16px;margin-top:2px">${val}</div></div>`;

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${base} 聪明钱总览</title></head>
<body style="margin:0;background:#0b0e11;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif">
<div style="max-width:520px;margin:24px auto;background:#151a21;border:1px solid #2b3139;border-radius:14px;overflow:hidden">
  <div style="padding:16px 18px 12px">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div style="color:#eaecef;font-size:18px;font-weight:600">${base} <span style="color:#848e9c;font-size:13px;font-weight:400">聪明钱总览</span></div>
      <div style="color:#848e9c;font-size:12px">${d.price != null ? '$' + fmtPrice(d.price) : ''}</div>
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin:14px 0 12px">
      ${stat('总持仓', fmtUsd(d.totalNotionalUsd))}
      ${stat('交易者', String(d.totalTraders))}
      ${stat('名义多空比', d.longShortNotionalRatio != null ? (d.longShortNotionalRatio * 100).toFixed(2) + '%' : '—')}
    </div>
    <div style="display:flex;height:8px;border-radius:99px;overflow:hidden">
      <div style="width:${longPct}%;background:#2ebd85"></div><div style="flex:1;background:#f6465d"></div>
    </div>
  </div>
  <div style="padding:0 18px 14px;display:flex;flex-direction:column;gap:12px">
    ${side('多头', d.long, true)}
    ${side('空头', d.short, false)}
    <div style="display:flex;gap:18px;flex-wrap:wrap;padding-top:2px;font-size:13px;color:#b7bdc6">
      <span>头部持仓LSR <b style="color:#eaecef;font-weight:500">${d.topPositionLsr != null ? d.topPositionLsr.toFixed(2) : '—'}</b></span>
      <span>Taker买卖比 <b style="color:#eaecef;font-weight:500">${d.takerBsr != null ? d.takerBsr.toFixed(2) : '—'}</b></span>
      <span>SM占OI <b style="color:#eaecef;font-weight:500">${fmtPct(d.smShareOfOI)}</b></span>
      <span>总OI <b style="color:#eaecef;font-weight:500">${fmtUsd(d.oiNowUsd)}</b> <span style="color:${(d.oiChg4h ?? 0) >= 0 ? '#2ebd85' : '#f6465d'}">${fmtChg(d.oiChg4h)}(4h)</span></span>
    </div>
  </div>
  <div style="padding:10px 18px;border-top:1px solid #2b3139;display:flex;justify-content:space-between;color:#5e6673;font-size:11px">
    <span>${when}</span>
    <span>binance-smart-money-oi-monitor · @0xBenniee</span>
  </div>
</div>
</body></html>`;
}
