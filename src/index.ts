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
  getFundingIntervalHours,
  fundingCountdownString,
  type TickerInfo,
  type FundingInfo,
} from './binance-ticker.js';

// Funding-rate cost math: per-interval rate → annualized % + USD per settlement/day/year.
export { fundingCost, type FundingCost } from './funding.js';

export {
  formatSmartMoneyPush,
  formatSmartMoneyPushPlain,
  type FormatterInput,
  type CardLang,
} from './format.js';

export { fmtUsd, fmtPct, fmtChg, fmtPrice, fmtQty } from './format-num.js';
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

// Time-series over the local snapshot DB: per-side added/reduced + market-wide scan.
export {
  computeChange,
  getChange,
  getProfitTrend,
  scanExtreme,
  type SideChange,
  type QtyDelta,
  type ChangeResult,
  type ProfitTrend,
  type ProfitSideTrend,
  type ExtremeEntry,
} from './tracking.js';
export type { SmartMoneyHistoryRow } from './storage.js';

// Time-series chart (self-contained dark HTML + inline SVG).
export { buildChart, renderChartHtml, type ChartData } from './chart.js';

// Opt-in Telegram alerts (off unless SMART_MONEY_ALERT_TG_TOKEN + _CHAT_ID set).
export { evaluateAlert, maybeAlert, type AlertResult } from './alerts.js';
