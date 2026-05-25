// Smart Money push formatter — Binance "巨鲸总览" UI style for Telegram.
//
// Pure rendering. No network, no DB. Pass in the snapshots you already have
// and get back a Telegram-HTML string ready for sendMessage.
//
// Output uses parse_mode: HTML (<b>/<i>/<code>) plus monospace alignment +
// emoji color cues that mimic the binance Smart Money dashboard.

import type { SmartMoneyOverview } from './binance-smart-money';
import type { OpenInterestSnapshot } from './binance-open-interest';

export interface FormatterInput {
  symbol: string;
  contractType?: string;              // default "永续"
  sm: SmartMoneyOverview;
  oi: OpenInterestSnapshot;
  // Optional ticker fields. If null/undefined we render "—" in place.
  price?: number;                     // last/mark price; if absent we derive from oi
  change24hPct?: number;              // already in %, e.g. +19.14
  vol24hUsd?: number;
  fundingRate?: number;               // decimal, e.g. 0.00005
  fundingCountdown?: string;          // "00:27:08"
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(digits)}K`;
  return `$${n.toFixed(digits)}`;
}

function fmtSignedUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '−';
  return sign + fmtUsd(Math.abs(n));
}

function fmtPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits) + '%';
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(5);
}

function bar(pct: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(pct / 100 * width)));
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

// ── main ──────────────────────────────────────────────────────────────────────

export function formatSmartMoneyPush(input: FormatterInput): string {
  const { symbol, sm, oi } = input;
  const contractType = input.contractType || '永续';

  // markPrice: prefer explicit price, else derive from oi (sumOpenInterestValue / sumOpenInterest)
  const markPrice = input.price ??
    (oi.oiNowCoins > 0 ? oi.oiNowUsd / oi.oiNowCoins : NaN);

  const longUsd = sm.longWhalesQty * markPrice;
  const shortUsd = sm.shortWhalesQty * markPrice;
  const totalWhalePosUsd = longUsd + shortUsd;
  const notionalRatio = shortUsd > 0 ? (longUsd / shortUsd) * 100 : 0;
  const whaleCount = sm.longWhales + sm.shortWhales;

  const longPnl = sm.longWhalesQty * (markPrice - sm.longWhalesAvgEntryPrice);
  const shortPnl = sm.shortWhalesQty * (sm.shortWhalesAvgEntryPrice - markPrice);

  const longProfitPct = sm.longWhales > 0 ? (sm.longProfitWhales / sm.longWhales) * 100 : 0;
  const shortProfitPct = sm.shortWhales > 0 ? (sm.shortProfitWhales / sm.shortWhales) * 100 : 0;

  const longStatus = longPnl >= 0 ? '📈 盈利中' : '📉 亏损中';
  const shortStatus = shortPnl >= 0 ? '📈 盈利中' : '📉 亏损中';

  const lines: string[] = [];

  // Header
  const priceStr = fmtPrice(markPrice);
  const chgStr = input.change24hPct == null ? ''
    : ` <b>${input.change24hPct >= 0 ? '+' : ''}${input.change24hPct.toFixed(2)}%</b>`;
  lines.push(`<b>${symbol}</b>  <i>${contractType}</i>  $${priceStr}${chgStr}`);

  // Subheader
  const volStr = input.vol24hUsd != null ? fmtUsd(input.vol24hUsd, 2) : '—';
  const oiStr = fmtUsd(oi.oiNowUsd, 2);
  const frStr = input.fundingRate != null
    ? `${(input.fundingRate * 100).toFixed(4)}%${input.fundingCountdown ? ' (' + input.fundingCountdown + ')' : ''}`
    : '—';
  lines.push(`<code>24h Vol ${volStr}  •  OI ${oiStr}  •  FR ${frStr}</code>`);
  lines.push('');

  // 巨鲸总览
  lines.push('🐋 <b>巨鲸总览</b>');
  lines.push(
    `<code>总持仓 ${fmtUsd(totalWhalePosUsd)}  •  鲸鱼 ${whaleCount}  •  名义多空比 ${notionalRatio.toFixed(2)}%</code>`
  );
  lines.push('');

  // 🟢 多头 card
  lines.push(`🟢 <b>多头 ${sm.longWhales} 个鲸鱼</b>  [${longStatus}]`);
  lines.push(`<code>仓位 ${fmtUsd(longUsd)}  •  均价 $${fmtPrice(sm.longWhalesAvgEntryPrice)}</code>`);
  lines.push(`<code>未实现盈亏 ${fmtSignedUsd(longPnl)}</code>`);
  lines.push(`<code>${bar(longProfitPct)} 盈利比例 ${fmtPct(longProfitPct)}</code>`);
  lines.push('');

  // 🔴 空头 card
  lines.push(`🔴 <b>空头 ${sm.shortWhales} 个鲸鱼</b>  [${shortStatus}]`);
  lines.push(`<code>仓位 ${fmtUsd(shortUsd)}  •  均价 $${fmtPrice(sm.shortWhalesAvgEntryPrice)}</code>`);
  lines.push(`<code>未实现盈亏 ${fmtSignedUsd(shortPnl)}</code>`);
  lines.push(`<code>${bar(shortProfitPct)} 盈利比例 ${fmtPct(shortProfitPct)}</code>`);

  if (sm.ts) {
    lines.push('');
    lines.push(`<i>数据时间 ${new Date(sm.ts).toISOString().slice(0, 19).replace('T', ' ')} UTC</i>`);
  }

  return lines.join('\n');
}

/** Strip HTML tags for plain-text channels (logs, stdout, non-TG bots). */
export function formatSmartMoneyPushPlain(input: FormatterInput): string {
  return formatSmartMoneyPush(input)
    .replace(/<\/?[bi]>/g, '')
    .replace(/<\/?code>/g, '');
}
