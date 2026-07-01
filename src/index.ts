// Library entry — re-exports the high-level surface for consumers.
// For runtime usage, prefer the dedicated scripts in src/scripts/.

export {
  getSmartMoneyOverview,
  getSmartMoneyOverviewBatch,
  smartMoneyNotionalUsd,
  smartMoneyShareOfOI,
  smartMoneySide,
  type SmartMoneyOverview,
  type SmartMoneySidePositions,
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

export { fmtUsd, fmtPct, fmtChg, fmtPrice } from './format-num.js';
export { normalizeSymbol } from './symbol.js';

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

export {
  buildPanel,
  computePanel,
  renderPanelHtml,
  type PanelData,
  type PanelSide,
} from './panel.js';

// Fetch + render the Telegram "巨鲸总览" push card (parse_mode: HTML) in one call.
export { buildPush } from './push.js';
