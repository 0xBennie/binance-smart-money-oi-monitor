// MCP protocol core — tool implementations + JSON-RPC handler, with NO transport
// side-effects (no readline, no dotenv). The stdio bootstrap lives in
// scripts/mcp-server.ts and imports handle() from here; tests import handle()/TOOLS
// directly without starting a stdin loop.
import {
  getSmartMoneyOverview,
  smartMoneyNotionalUsd,
  smartMoneyShareOfOI,
  smartMoneySide,
} from './binance-smart-money.js';
import { getTopTraderSnapshot, type TopTraderPeriod } from './binance-top-trader.js';
import { getOpenInterest } from './binance-open-interest.js';
import { buildPanel, renderPanelHtml } from './panel.js';
import { buildPush } from './push.js';
import { getFundingInfo, getFundingIntervalHours, fundingCountdownString } from './binance-ticker.js';
import { fundingCost } from './funding.js';
import { isBinanceApiBlocked } from './binance-rate-limit.js';
import { normalizeSymbol } from './symbol.js';

export const SERVER_INFO = { name: 'binance-smart-money', version: '1.8.1' };
export const PROTOCOL_VERSION = '2025-06-18';
// Auto-attached to every analysis result. This tool reports on-chain/exchange data
// and structure — it deliberately does NOT emit buy/sell or directional signals.
export const DISCLAIMER = '仅供数据分析,不构成投资建议。Data & analysis only — not financial advice.';

// Distinguish "Binance is unreachable / rate-limited right now" from "this symbol
// isn't supported" — otherwise both look like a bare "no data" to the caller.
function noData(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    ...fields,
    error: isBinanceApiBlocked()
      ? 'Binance is temporarily rate-limited/blocked — retry shortly, or run from a region where Binance is reachable.'
      : 'no data — the symbol may be unsupported (not a Binance USDT-perpetual).',
  };
}
const TT_PERIODS = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'];

function hoursAgo(ms: number | undefined): number | null {
  if (!ms) return null;
  return Math.round(((Date.now() - ms) / 3_600_000) * 10) / 10;
}

// ── Tool implementations ────────────────────────────────────────────────────

async function toolGetSmartMoney(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required, e.g. "BTC" or "BTCUSDT"' };
  const sm = await getSmartMoneyOverview(symbol);
  if (!sm) return noData({ symbol });

  return {
    symbol,
    longShortRatio: sm.longShortRatio,
    totalNotionalUsd: Math.round(smartMoneyNotionalUsd(sm)),
    long: smartMoneySide(sm, 'long'),
    short: smartMoneySide(sm, 'short'),
    signalDayAgeHours: hoursAgo(sm.signalDay),
    note: 'Per side: smartMoneyUsd = all smart-money traders position (qty×entry, USD); whalesUsd = whale-only position; avgEntry / profitPct / whaleProfitPct are bapi-only (not in public fapi). whalesUsd is 0 when Binance returns no whale qty.',
    disclaimer: DISCLAIMER,
  };
}

async function toolGetTopTrader(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required' };
  const period = (args.period as TopTraderPeriod) || '5m';
  const tt = await getTopTraderSnapshot(symbol, period);
  if (!tt) return noData({ symbol, period });
  return {
    symbol,
    period,
    topAccountLsr: tt.topAccountLSR,
    topPositionLsr: tt.topPositionLSR,
    takerBuySellRatio: tt.takerBSR,
    takerBuyVol: tt.takerBuyVol,
    takerSellVol: tt.takerSellVol,
  };
}

async function toolGetOpenInterest(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required' };
  const oi = await getOpenInterest(symbol);
  if (!oi) return noData({ symbol });
  return {
    symbol,
    oiNowUsd: Math.round(oi.oiNowUsd),
    oiNowCoins: oi.oiNowCoins,
    oiChg5m: oi.oiChg5m,
    oiChg15m: oi.oiChg15m,
    oiChg1h: oi.oiChg1h,
    oiChg4h: oi.oiChg4h,
  };
}

async function toolGetFullPicture(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required' };
  const [sm, tt, oi, funding, intervalHours] = await Promise.all([
    getSmartMoneyOverview(symbol),
    getTopTraderSnapshot(symbol, (args.period as TopTraderPeriod) || '5m'),
    getOpenInterest(symbol),
    getFundingInfo(symbol),
    getFundingIntervalHours(symbol),
  ]);
  if (!sm && !tt && !oi) return noData({ symbol });

  const share = sm && oi ? smartMoneyShareOfOI(sm, oi.oiNowUsd) : null;
  const fc = funding ? fundingCost(funding.lastFundingRate, intervalHours, 10_000) : null;
  return {
    symbol,
    price: funding ? funding.markPrice : null,
    smartMoney: sm && {
      longShortRatio: sm.longShortRatio,
      totalNotionalUsd: Math.round(smartMoneyNotionalUsd(sm)),
      long: smartMoneySide(sm, 'long'),
      short: smartMoneySide(sm, 'short'),
    },
    topTrader: tt && { topPositionLsr: tt.topPositionLSR, takerBuySellRatio: tt.takerBSR },
    openInterest: oi && { oiNowUsd: Math.round(oi.oiNowUsd), oiChg1h: oi.oiChg1h, oiChg4h: oi.oiChg4h },
    funding: fc && {
      ratePct: fc.ratePct,
      intervalHours: fc.intervalHours,
      annualizedPct: fc.annualizedPct,
      per10kPerSettlementUsd: fc.perSettlementUsd,
      longPays: fc.longPays,
    },
    smartMoneyShareOfOI: share == null ? null : Math.round(share * 1000) / 1000,
    disclaimer: DISCLAIMER,
  };
}

async function toolGetFunding(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required' };
  const notionalUsd = Number(args.notionalUsd) > 0 ? Number(args.notionalUsd) : 10_000;
  const [funding, intervalHours] = await Promise.all([
    getFundingInfo(symbol),
    getFundingIntervalHours(symbol),
  ]);
  if (!funding) return noData({ symbol });
  const cost = fundingCost(funding.lastFundingRate, intervalHours, notionalUsd);
  return {
    symbol,
    price: funding.markPrice,
    ...cost,
    nextFundingCountdown: fundingCountdownString(funding.nextFundingTime),
    note: `Rate is per ${cost.intervalHours}h settlement; ${cost.longPays ? 'LONGS pay shorts' : 'SHORTS pay longs'}. `
      + `perSettlementUsd / dailyUsd / annualUsd are for a $${cost.notionalUsd} position, signed from the long side (>0 = long pays).`,
    disclaimer: DISCLAIMER,
  };
}

async function toolRenderPanel(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required' };
  const data = await buildPanel(symbol);
  if (!data) return noData({ symbol });
  // Rich enough to reason about without parsing the html blob.
  const summary = {
    price: data.price,
    totalNotionalUsd: Math.round(data.totalNotionalUsd),
    totalTraders: data.totalTraders,
    longShortNotionalRatio: data.longShortNotionalRatio,
    long: { avgEntry: data.long.avgEntry, profitPct: Math.round(data.long.profitPct * 100), whales: data.long.whales },
    short: { avgEntry: data.short.avgEntry, profitPct: Math.round(data.short.profitPct * 100), whales: data.short.whales },
    topPositionLsr: data.topPositionLsr,
    takerBsr: data.takerBsr,
    smShareOfOI: data.smShareOfOI == null ? null : Math.round(data.smShareOfOI * 1000) / 1000,
    oiNowUsd: data.oiNowUsd == null ? null : Math.round(data.oiNowUsd),
  };
  const out: any = {
    symbol,
    summary,
    note: 'summary has the numbers to talk about; html (when included) is a complete standalone document — save it to a .html file and screenshot it if your client can write files.',
  };
  // includeHtml defaults true; pass false to save context when you only need the numbers.
  if (args.includeHtml !== false) out.html = renderPanelHtml(data);
  return out;
}

async function toolRenderPush(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required' };
  const html = await buildPush(symbol);
  if (!html) return noData({ symbol });
  return {
    symbol,
    html,
    note: 'Telegram-ready message body (parse_mode: HTML) — the compact 巨鲸总览 card. Send it via the Bot API sendMessage.',
    disclaimer: DISCLAIMER,
  };
}

// These three read the local snapshot DB (better-sqlite3). Load it lazily so the
// live tools above never require the native module — and if it's missing/empty,
// degrade to a clear message instead of crashing the server.
const DB_HINT = 'This reads the local snapshot DB. Run the tracker (smart-money-tick, ideally in daemon/watchlist mode) so it accumulates history — and better-sqlite3 must be installed.';

async function toolGetChange(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required' };
  const minutes = Number(args.minutes) > 0 ? Number(args.minutes) : 60;
  try {
    const { getChange } = await import('./tracking.js');
    return getChange(symbol, minutes);
  } catch (e: any) {
    return { symbol, error: `local DB unavailable (${e?.message ?? e}). ${DB_HINT}` };
  }
}

async function toolScanExtreme(args: any) {
  const limit = Number(args.limit) > 0 ? Math.min(Number(args.limit), 30) : 10;
  const maxAgeMin = Number(args.maxAgeMin) > 0 ? Number(args.maxAgeMin) : 180;
  try {
    const { scanExtreme } = await import('./tracking.js');
    return { ...scanExtreme({ limit, maxAgeMin }), disclaimer: DISCLAIMER };
  } catch (e: any) {
    return { error: `local DB unavailable (${e?.message ?? e}). ${DB_HINT}` };
  }
}

async function toolRenderChart(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required' };
  const hours = Number(args.hours) > 0 ? Number(args.hours) : 24;
  try {
    const { buildChart, renderChartHtml } = await import('./chart.js');
    const data = buildChart(symbol, hours);
    if (data.rows.length < 2) return { symbol, error: `not enough local history for ${symbol}. ${DB_HINT}` };
    return { symbol, points: data.rows.length, html: renderChartHtml(data), note: 'Save html to a .html file and open/screenshot it.' };
  } catch (e: any) {
    return { symbol, error: `local DB unavailable (${e?.message ?? e}). ${DB_HINT}` };
  }
}

export const TOOLS: Record<string, { fn: (args: any) => Promise<any>; description: string; properties: any; required?: string[] }> = {
  get_smart_money: {
    fn: toolGetSmartMoney,
    description:
      "Binance Smart Money (Smart Signal) overview for a symbol. Returns PER SIDE (long/short) both " +
      "the smart-money (all traders) position and the whale-only position in USD, with average entry " +
      "prices and how-many-in-profit — bapi-only fields the public fapi API can't give you.",
    properties: { symbol: { type: 'string', description: 'e.g. "BTC" or "BTCUSDT"' } },
    required: ['symbol'],
  },
  get_top_trader: {
    fn: toolGetTopTrader,
    description:
      "Binance top-trader (top 20% by margin) long/short ratio + Taker buy/sell ratio for a symbol. " +
      "Complements get_smart_money with shorter-horizon flow.",
    properties: {
      symbol: { type: 'string', description: 'e.g. "ETH" or "ETHUSDT"' },
      period: { type: 'string', enum: TT_PERIODS, description: 'top-trader window (default 5m)' },
    },
    required: ['symbol'],
  },
  get_open_interest: {
    fn: toolGetOpenInterest,
    description: "Total market Open Interest (USD + coins) and its 5m/15m/1h/4h velocity for a symbol.",
    properties: { symbol: { type: 'string', description: 'e.g. "SOL" or "SOLUSDT"' } },
    required: ['symbol'],
  },
  get_full_picture: {
    fn: toolGetFullPicture,
    description:
      "One-shot combined view: per-side smart-money + whale positions (long/short USD, avg entry, " +
      "profit%), top-trader flow, open interest, and Smart Money's share of total OI. The single most " +
      "useful call for 'what's the positioning on X'.",
    properties: {
      symbol: { type: 'string', description: 'e.g. "BTC" or "BTCUSDT"' },
      period: { type: 'string', enum: TT_PERIODS, description: 'top-trader period (default 5m)' },
    },
    required: ['symbol'],
  },
  get_funding: {
    fn: toolGetFunding,
    description:
      "Funding rate for a symbol, turned into money: the per-interval rate, its annualized %, and the " +
      "USD you pay/receive per settlement / per day / per year on a position (default $10,000 — pass " +
      "notionalUsd to change). Detects the real 8h/4h/1h settlement interval. rate>0 = longs pay shorts.",
    properties: {
      symbol: { type: 'string', description: 'e.g. "BTC" or "BTCUSDT"' },
      notionalUsd: { type: 'number', description: 'position size in USD (default 10000)' },
    },
    required: ['symbol'],
  },
  render_panel: {
    fn: toolRenderPanel,
    description:
      "Render a shareable Smart Money overview panel for a symbol as a self-contained dark HTML card " +
      "(the binance.com Smart Signal look). Returns { summary, html }: summary has the key numbers " +
      "(price, avg entries, profit %, LSR/Taker, OI share) to talk about; html is a standalone " +
      "document to save/screenshot for social. Pass includeHtml:false for summary-only (saves context).",
    properties: {
      symbol: { type: 'string', description: 'e.g. "BEAT" or "BEATUSDT"' },
      includeHtml: { type: 'boolean', description: 'include the full HTML document (default true)' },
    },
    required: ['symbol'],
  },
  render_push: {
    fn: toolRenderPush,
    description:
      "Render the Telegram '巨鲸总览' push card for a symbol as a parse_mode:HTML message body " +
      "(whale counts, avg entry, unrealized PNL, profit %). Complements render_panel: render_panel " +
      "returns a full standalone HTML page to screenshot; render_push returns the compact Telegram " +
      "message you can send straight to a chat via the Bot API.",
    properties: { symbol: { type: 'string', description: 'e.g. "BTC" or "BTCUSDT"' } },
    required: ['symbol'],
  },
  get_change: {
    fn: toolGetChange,
    description:
      "How much each side ADDED or REDUCED over the last N minutes, from the local snapshot DB. " +
      "Position deltas are in qty (contract count), not USD — so a price move isn't mistaken for a " +
      "position change. Needs the tracker (smart-money-tick) to have recorded ≥2 snapshots for the symbol.",
    properties: {
      symbol: { type: 'string', description: 'e.g. "MAGMA" or "MAGMAUSDT"' },
      minutes: { type: 'number', description: 'lookback window in minutes (default 60)' },
    },
    required: ['symbol'],
  },
  scan_extreme: {
    fn: toolScanExtreme,
    description:
      "Market-wide long/short-imbalance scan from the local DB: the most long-heavy and most " +
      "short-heavy symbols by smart-money long/short ratio (with each side's in-profit %). Needs the " +
      "tracker to have populated snapshots; results are as fresh as the last sweep.",
    properties: {
      limit: { type: 'number', description: 'top N per side (default 10, max 30)' },
      maxAgeMin: { type: 'number', description: 'ignore snapshots older than this many minutes (default 180)' },
    },
  },
  render_chart: {
    fn: toolRenderChart,
    description:
      "Time-series chart of a symbol's smart-money long/short position (qty) and average entry over " +
      "time, as a self-contained dark HTML page (inline SVG, no external assets). Reads the local DB.",
    properties: {
      symbol: { type: 'string', description: 'e.g. "BEAT" or "BEATUSDT"' },
      hours: { type: 'number', description: 'lookback window in hours (default 24)' },
    },
    required: ['symbol'],
  },
};

// ── JSON-RPC handling ───────────────────────────────────────────────────────

export async function handle(req: any): Promise<any | null> {
  const { method, id } = req;
  const ok = (result: any) => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return ok({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    case 'notifications/initialized':
      return null; // notification, no response
    case 'tools/list':
      return ok({
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: { type: 'object', properties: t.properties, required: t.required ?? [] },
        })),
      });
    case 'tools/call': {
      const name = req.params?.name;
      const tool = name && TOOLS[name];
      if (!tool) return err(-32601, `Unknown tool: ${name}`);
      try {
        const result = await tool.fn(req.params?.arguments ?? {});
        // Surface soft failures ({ error: ... }) as MCP tool errors so clients
        // don't mistake "no data" for a successful answer.
        const isError = !!(result && typeof result === 'object' && 'error' in result);
        return ok({ content: [{ type: 'text', text: JSON.stringify(result) }], isError });
      } catch (e: any) {
        return err(-32000, e?.message ?? String(e));
      }
    }
    default:
      // ignore other notifications; error on unknown requests that carry an id
      return id === undefined ? null : err(-32601, `Unknown method: ${method}`);
  }
}
