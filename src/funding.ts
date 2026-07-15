// Funding-rate cost math. Pure — no network. Turns a per-interval funding rate
// into an annualized %, and the actual USD you pay (or receive) on a position
// of a given size, per settlement / per day / per year.
//
// Sign convention (Binance): rate > 0 → longs pay shorts; rate < 0 → shorts pay
// longs. `perSettlementUsd` is signed from the LONG's perspective (>0 = a cost to
// the long, i.e. income to the short).

export interface FundingCost {
  ratePct: number;            // funding rate per interval, in % (e.g. 0.01)
  intervalHours: number;      // settlement interval — 8 / 4 / 1 (defaults to 8)
  settlementsPerDay: number;  // 24 / intervalHours
  annualizedPct: number;      // ratePct × settlementsPerDay × 365, in %
  notionalUsd: number;        // position size these figures are for
  perSettlementUsd: number;   // signed: >0 = long pays this per settlement
  dailyUsd: number;           // per-settlement × settlements/day
  annualUsd: number;          // notional × annualized rate
  longPays: boolean;          // rate > 0 (longs pay shorts)
}

const round = (x: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

/**
 * @param ratePerInterval funding rate as a decimal for one interval (e.g. 0.0001 = 0.01%)
 * @param intervalHours   settlement interval in hours (8 default; some alts are 4 or 1)
 * @param notionalUsd     position size in USD (default $10,000)
 */
export function fundingCost(
  ratePerInterval: number | null | undefined,
  intervalHours = 8,
  notionalUsd = 10_000,
): FundingCost {
  const rate = typeof ratePerInterval === 'number' && Number.isFinite(ratePerInterval) ? ratePerInterval : 0;
  const interval = Number.isFinite(intervalHours) && intervalHours > 0 ? intervalHours : 8;
  const notional = Number.isFinite(notionalUsd) && notionalUsd > 0 ? notionalUsd : 10_000;

  const settlementsPerDay = 24 / interval;
  const annualRate = rate * settlementsPerDay * 365;

  return {
    ratePct: round(rate * 100, 4),
    intervalHours: interval,
    settlementsPerDay,
    annualizedPct: round(annualRate * 100, 2),
    notionalUsd: notional,
    perSettlementUsd: round(notional * rate, 2),
    dailyUsd: round(notional * rate * settlementsPerDay, 2),
    annualUsd: round(notional * annualRate, 2),
    longPays: rate > 0,
  };
}
