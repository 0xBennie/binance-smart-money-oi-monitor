// Fetch live data for a symbol and render the Telegram "巨鲸总览" push card
// (parse_mode: HTML), or null if the core data is unavailable. This is to the
// Telegram formatter what buildPanel() is to the HTML panel — a one-call
// convenience so library/MCP consumers don't have to assemble FormatterInput
// from four separate fetchers by hand.
import { getSmartMoneyOverview } from './binance-smart-money.js';
import { getOpenInterest } from './binance-open-interest.js';
import { getTicker24h, getFundingInfo, fundingCountdownString } from './binance-ticker.js';
import { formatSmartMoneyPush, type CardLang } from './format.js';
import { normalizeSymbol } from './symbol.js';

export async function buildPush(symbol: string, lang?: CardLang): Promise<string | null> {
  const sym = normalizeSymbol(symbol);
  if (!sym) return null;
  const [sm, oi, ticker, funding] = await Promise.all([
    getSmartMoneyOverview(sym),
    getOpenInterest(sym),
    getTicker24h(sym),
    getFundingInfo(sym),
  ]);
  if (!sm || !oi) return null;   // sm + oi are the required inputs to the formatter
  return formatSmartMoneyPush({
    symbol: sym,
    sm,
    oi,
    price: funding?.markPrice ?? undefined,
    change24hPct: ticker?.priceChangePct24h,
    vol24hUsd: ticker?.quoteVolume24hUsd,
    fundingRate: funding?.lastFundingRate ?? undefined,
    fundingCountdown: funding ? fundingCountdownString(funding.nextFundingTime) : undefined,
  }, lang);
}
