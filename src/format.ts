// Smart Money push formatter — Binance "巨鲸总览" UI style for Telegram.
//
// Pure rendering. No network, no DB. Pass in the snapshots you already have
// and get back a Telegram-HTML string ready for sendMessage.
//
// Output uses parse_mode: HTML (<b>/<i>/<code>) plus monospace alignment +
// emoji color cues that mimic the binance Smart Money dashboard.

import type { SmartMoneyOverview } from './binance-smart-money.js';
import type { OpenInterestSnapshot } from './binance-open-interest.js';
// Shared formatters (single source of truth): fmtUsd (compact USD), fmtPct (0..1 →
// percent), fmtPrice. Only fmtSignedUsd + bar stay local — they're push-specific
// presentation (forced +/− sign; unicode profit bar) built ON TOP of fmtUsd.
import { fmtUsd, fmtPct, fmtPrice } from './format-num.js';

export interface FormatterInput {
  symbol: string;
  contractType?: string;              // default "永续"
  sm: SmartMoneyOverview;
  oi: OpenInterestSnapshot;
  // Optional ticker fields. If null/undefined we render "—" in place.
  price?: number;                     // last/mark price; if absent we derive from oi
  change24hPct?: number | null;       // already in %, e.g. +19.14 (null = malformed → "—")
  vol24hUsd?: number | null;
  fundingRate?: number;               // decimal, e.g. 0.00005
  fundingCountdown?: string;          // "00:27:08"
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Signed USD for P&L: forces a leading +/− and delegates scaling to fmtUsd. */
function fmtSignedUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '−';
  return sign + fmtUsd(Math.abs(n));
}

/** Unicode profit bar from a 0..1 fraction. */
function bar(frac: number, width = 10): string {
  const f = Number.isFinite(frac) ? frac : 0;
  const filled = Math.max(0, Math.min(width, Math.round(f * width)));
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

export type CardLang = 'zh' | 'en';

export function resolveCardLang(lang?: CardLang): CardLang {
  if (lang === 'zh' || lang === 'en') return lang;
  return process.env.SMART_MONEY_CARD_LANG === 'en' ? 'en' : 'zh';
}

const CARD_LABELS = {
  zh: {
    perp: '永续', overview: '巨鲸总览', totalPosition: '总持仓', whales: '鲸鱼',
    ratio: '名义多空比', long: '多头', short: '空头', whaleUnit: '个鲸鱼',
    inProfit: '📈 盈利中', inLoss: '📉 亏损中', position: '仓位', avgEntry: '均价',
    unrealizedPnl: '未实现盈亏', profitPct: '盈利比例', dataTime: '数据时间',
    volume24h: '24h Vol', openInterest: 'OI', fundingRate: 'FR',
    footer: '🐦 x.com/0xBenniee · 仅数据分析,非投资建议 / not financial advice',
  },
  en: {
    perp: 'Perp', overview: 'Whale Overview', totalPosition: 'Total Position', whales: 'whales',
    ratio: 'Notional L/S Ratio', long: 'Long', short: 'Short', whaleUnit: 'whales',
    inProfit: '📈 in profit', inLoss: '📉 in loss', position: 'Position', avgEntry: 'Avg Entry',
    unrealizedPnl: 'Unrealized PnL', profitPct: 'In-Profit %', dataTime: 'Data time',
    volume24h: '24h Volume', openInterest: 'Open Interest', fundingRate: 'Funding Rate',
    footer: '🐦 x.com/0xBenniee · Data and analysis only — not financial advice',
  },
} satisfies Record<CardLang, Record<string, string>>;

// ── main ──────────────────────────────────────────────────────────────────────

export function formatSmartMoneyPush(input: FormatterInput, lang?: CardLang): string {
  const { symbol, sm, oi } = input;
  const L = CARD_LABELS[resolveCardLang(lang)];
  const contractType = input.contractType || L.perp;

  // markPrice resolution order:
  //   1. explicit input.price (most accurate, from premiumIndex)
  //   2. derived from OI: sumOpenInterestValue / sumOpenInterest
  //   3. weighted whale avg-entry (last resort — biased but never NaN)
  const derivedFromOi = oi.oiNowCoins > 0 && oi.oiNowUsd > 0
    ? oi.oiNowUsd / oi.oiNowCoins
    : null;
  const totalWhaleQty = sm.longWhalesQty + sm.shortWhalesQty;
  const whaleAvgPrice = totalWhaleQty > 0
    ? (sm.longWhalesQty * sm.longWhalesAvgEntryPrice
       + sm.shortWhalesQty * sm.shortWhalesAvgEntryPrice) / totalWhaleQty
    : null;
  const markPrice = (Number.isFinite(input.price) && input.price! > 0) ? input.price!
    : (derivedFromOi && Number.isFinite(derivedFromOi) && derivedFromOi > 0) ? derivedFromOi
    : (whaleAvgPrice && Number.isFinite(whaleAvgPrice) && whaleAvgPrice > 0) ? whaleAvgPrice
    : NaN;

  const haveMarkPrice = Number.isFinite(markPrice) && markPrice > 0;
  const longUsd = haveMarkPrice ? sm.longWhalesQty * markPrice : NaN;
  const shortUsd = haveMarkPrice ? sm.shortWhalesQty * markPrice : NaN;
  const totalWhalePosUsd = haveMarkPrice ? longUsd + shortUsd : NaN;
  // null = "undefined" (no shorts), not zero. Renders as "—".
  // A RATIO (long÷short), not a percent — must match renderPanelHtml's plain
  // `.toFixed(2)`. (Was ×100 + "%", i.e. 1.5 mislabeled as "150.00%".)
  const notionalRatio: number | null = (haveMarkPrice && shortUsd > 0)
    ? (longUsd / shortUsd)
    : null;
  const whaleCount = sm.longWhales + sm.shortWhales;

  const longPnl = haveMarkPrice
    ? sm.longWhalesQty * (markPrice - sm.longWhalesAvgEntryPrice)
    : NaN;
  const shortPnl = haveMarkPrice
    ? sm.shortWhalesQty * (sm.shortWhalesAvgEntryPrice - markPrice)
    : NaN;

  // 0..1 fractions — bar() and fmtPct() both take a fraction (fmtPct does the ×100).
  const longProfitFrac = sm.longWhales > 0 ? sm.longProfitWhales / sm.longWhales : 0;
  const shortProfitFrac = sm.shortWhales > 0 ? sm.shortProfitWhales / sm.shortWhales : 0;

  // Default status to "—" if PnL unknown (markPrice unavailable)
  const longStatus = !haveMarkPrice ? '—' : (longPnl >= 0 ? L.inProfit : L.inLoss);
  const shortStatus = !haveMarkPrice ? '—' : (shortPnl >= 0 ? L.inProfit : L.inLoss);

  const lines: string[] = [];

  // Header
  const priceStr = fmtPrice(markPrice);
  const chgStr = input.change24hPct == null ? ''
    : ` <b>${input.change24hPct >= 0 ? '+' : ''}${input.change24hPct.toFixed(2)}%</b>`;
  lines.push(`<b>${symbol}</b>  <i>${contractType}</i>  $${priceStr}${chgStr}`);

  // Subheader
  const volStr = input.vol24hUsd != null ? fmtUsd(input.vol24hUsd, 2) : '—';
  const oiStr = fmtUsd(oi.oiNowUsd, 2);
  const frStr = Number.isFinite(input.fundingRate)
    ? `${(input.fundingRate! * 100).toFixed(4)}%${input.fundingCountdown ? ' (' + input.fundingCountdown + ')' : ''}`
    : '—';
  lines.push(`<code>${L.volume24h} ${volStr}  •  ${L.openInterest} ${oiStr}  •  ${L.fundingRate} ${frStr}</code>`);
  lines.push('');

  lines.push(`🐋 <b>${L.overview}</b>`);
  const ratioStr = notionalRatio == null ? '—' : notionalRatio.toFixed(2);
  lines.push(
    `<code>${L.totalPosition} ${fmtUsd(totalWhalePosUsd)}  •  ${L.whales} ${whaleCount}  •  ${L.ratio} ${ratioStr}</code>`
  );
  lines.push('');

  lines.push(`🟢 <b>${L.long} ${sm.longWhales} ${L.whaleUnit}</b>  [${longStatus}]`);
  lines.push(`<code>${L.position} ${fmtUsd(longUsd)}  •  ${L.avgEntry} $${fmtPrice(sm.longWhalesAvgEntryPrice)}</code>`);
  lines.push(`<code>${L.unrealizedPnl} ${fmtSignedUsd(longPnl)}</code>`);
  lines.push(`<code>${bar(longProfitFrac)} ${L.profitPct} ${fmtPct(longProfitFrac)}</code>`);
  lines.push('');

  lines.push(`🔴 <b>${L.short} ${sm.shortWhales} ${L.whaleUnit}</b>  [${shortStatus}]`);
  lines.push(`<code>${L.position} ${fmtUsd(shortUsd)}  •  ${L.avgEntry} $${fmtPrice(sm.shortWhalesAvgEntryPrice)}</code>`);
  lines.push(`<code>${L.unrealizedPnl} ${fmtSignedUsd(shortPnl)}</code>`);
  lines.push(`<code>${bar(shortProfitFrac)} ${L.profitPct} ${fmtPct(shortProfitFrac)}</code>`);

  if (sm.ts) {
    lines.push('');
    lines.push(`<i>${L.dataTime} ${new Date(sm.ts).toISOString().slice(0, 19).replace('T', ' ')} UTC</i>`);
  }
  lines.push('');
  lines.push(`<i>${L.footer}</i>`);

  return lines.join('\n');
}

/** Strip HTML tags for plain-text channels (logs, stdout, non-TG bots). */
export function formatSmartMoneyPushPlain(input: FormatterInput, lang?: CardLang): string {
  return formatSmartMoneyPush(input, lang)
    .replace(/<\/?[bi]>/g, '')
    .replace(/<\/?code>/g, '');
}
