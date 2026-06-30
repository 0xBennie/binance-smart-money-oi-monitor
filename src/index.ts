// Library entry — re-exports the high-level surface for consumers.
// For runtime usage, prefer the dedicated scripts in src/scripts/.

export {
  getSmartMoneyOverview,
  getSmartMoneyOverviewBatch,
  smartMoneyNotionalUsd,
  smartMoneyShareOfOI,
  type SmartMoneyOverview,
} from './binance-smart-money.js';

export {
  getTopTraderSnapshot,
  getTopTraderSnapshotsBatch,
  type TopTraderSnapshot,
  type TopTraderPeriod,
} from './binance-top-trader.js';

export {
  getOpenInterest,
  getOpenInterestBatch,
  type OpenInterestSnapshot,
} from './binance-open-interest.js';

export {
  getTicker24h,
  getFundingInfo,
  fundingCountdownString,
  type TickerInfo,
  type FundingInfo,
} from './binance-ticker.js';

export {
  formatSmartMoneyPush,
  formatSmartMoneyPushPlain,
  type FormatterInput,
} from './format.js';

export {
  isBinanceApiBlocked,
  markBinanceApiBlocked,
  markBinanceApiBlockedWithRetry,
  clearBinanceApiBlocked,
  detectBinanceBlockStatus,
  detectBinanceBlockDetails,
  updateBinanceUsedWeight,
  getBinanceWeightUtilization,
  waitForBinanceWeightHeadroom,
  preflightBinanceFapi,
} from './binance-rate-limit.js';

export { storage } from './storage.js';
export type { SmartMoneySnapshotRow, TopTraderSnapshotRow, OISnapshotRow } from './storage.js';
