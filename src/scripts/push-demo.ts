/**
 * One-shot live demo: render any symbol in the binance "巨鲸总览" style.
 *
 *   tsx src/scripts/push-demo.ts BILLUSDT
 *
 * Pulls 4 endpoints (smart-money + openInterestHist + ticker24h + premiumIndex)
 * with polite spacing, then renders via the formatter. No DB, no cron, no TG
 * send — pure preview. If fapi/v1 endpoints are rate-limited, Vol/FR fall
 * back to "—" gracefully.
 */
import 'dotenv/config';
import { getSmartMoneyOverview } from '../binance-smart-money.js';
import { getOpenInterest } from '../binance-open-interest.js';
import { getTicker24h, getFundingInfo, fundingCountdownString } from '../binance-ticker.js';
import { formatSmartMoneyPush, formatSmartMoneyPushPlain } from '../format.js';

const SYMBOL = (process.argv[2] || 'BILLUSDT').toUpperCase();

async function main(): Promise<void> {
  console.log(`Fetching ${SYMBOL} from 4 endpoints with polite spacing …\n`);

  const sm = await getSmartMoneyOverview(SYMBOL);
  await new Promise(r => setTimeout(r, 2_000));
  const oi = await getOpenInterest(SYMBOL);
  await new Promise(r => setTimeout(r, 2_000));
  const ticker = await getTicker24h(SYMBOL);
  await new Promise(r => setTimeout(r, 2_000));
  const funding = await getFundingInfo(SYMBOL);

  if (!sm) { console.error('smart-money returned null'); process.exit(1); }
  if (!oi) { console.error('OI returned null'); process.exit(1); }

  const rendered = formatSmartMoneyPush({
    symbol: SYMBOL,
    sm, oi,
    price: funding?.markPrice ?? undefined,
    change24hPct: ticker?.priceChangePct24h,
    vol24hUsd: ticker?.quoteVolume24hUsd,
    fundingRate: funding?.lastFundingRate ?? undefined,
    fundingCountdown: funding ? fundingCountdownString(funding.nextFundingTime) : undefined,
  });

  console.log('──── Telegram HTML (parse_mode: HTML) ────');
  console.log(rendered);

  console.log('\n──── Plain-text preview ────');
  console.log(formatSmartMoneyPushPlain({
    symbol: SYMBOL,
    sm, oi,
    price: funding?.markPrice ?? undefined,
    change24hPct: ticker?.priceChangePct24h,
    vol24hUsd: ticker?.quoteVolume24hUsd,
    fundingRate: funding?.lastFundingRate ?? undefined,
    fundingCountdown: funding ? fundingCountdownString(funding.nextFundingTime) : undefined,
  }));

  console.log('\n──── Field availability ────');
  console.log(`  smart-money: ${sm ? 'OK' : 'NULL'}`);
  console.log(`  OI:          ${oi ? 'OK' : 'NULL'}`);
  console.log(`  Ticker 24h:  ${ticker ? 'OK' : 'NULL (fapi/v1 likely banned)'}`);
  console.log(`  Funding:     ${funding ? 'OK' : 'NULL (fapi/v1 likely banned)'}`);
}

main().catch(e => {
  console.error('demo failed:', e?.response?.status || e.message);
  process.exit(1);
});
