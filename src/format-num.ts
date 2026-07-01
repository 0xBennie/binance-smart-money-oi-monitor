// Shared number formatters used by BOTH the Telegram formatter (format.ts) and
// the shareable HTML panel (panel.ts), so the two halves of the product render
// identical numbers. All helpers guard non-finite / null → '—'.

/** Compact USD: $1.50B / $2.50M / $1.5K / $500. Negative keeps its sign. null/NaN → '—'. */
export function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}

/** A 0..1 fraction as a percent: 0.1234 → '12.34%'. null/NaN → '—'. */
export function fmtPct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(2)}%`;
}

/** A signed change ALREADY expressed in percent: 4.05 → '+4.05%', -5.12 → '-5.12%'.
 * null/NaN → '—'. (Change fields here — oiChg*, priceChangePct — are already percents,
 * unlike the 0..1 fractions that go through fmtPct.) */
export function fmtChg(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** Price with thousands grouping for large values, trimmed decimals for mid,
 * 5 sig-figs for sub-$1. Non-finite or <=0 → '—'. */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4).replace(/\.?0+$/, '');
  return v.toPrecision(5);
}
