// Library entry — re-exports the high-level surface for consumers.
// For runtime usage, prefer the dedicated scripts in src/scripts/.

export {
  getSmartMoneyOverview,
  getSmartMoneyOverviewBatch,
  smartMoneyNotionalUsd,
  smartMoneyShareOfOI,
  type SmartMoneyOverview,
} from './binance-smart-money';

export {
  getTopTraderSnapshot,
  getTopTraderSnapshotsBatch,
  type TopTraderSnapshot,
  type TopTraderPeriod,
} from './binance-top-trader';

export {
  getOpenInterest,
  getOpenInterestBatch,
  type OpenInterestSnapshot,
} from './binance-open-interest';

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
} from './binance-rate-limit';

export { storage } from './storage';
export type { SmartMoneySnapshotRow, TopTraderSnapshotRow, OISnapshotRow } from './storage';
