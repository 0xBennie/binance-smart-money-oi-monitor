#!/usr/bin/env node
/**
 * MCP stdio server — exposes the Binance Smart Money / Top Trader / Open Interest
 * library over the Model Context Protocol, so any MCP-compatible terminal AI
 * (Claude Code, Claude Desktop, Codex CLI, Gemini CLI, Cursor, Windsurf, Cline,
 * Zed, Continue, …) can query live whale positioning as a tool.
 *
 * Transport: stdio, one JSON-RPC message per line. No extra dependencies — it
 * speaks the protocol directly, the same way the rest of this repo avoids heavy
 * frameworks.
 *
 * Usage:
 *   npx tsx src/scripts/mcp-server.ts          # or: npm run mcp
 *
 * Register in Claude Code (~/.claude.json or project .mcp.json):
 *   {
 *     "mcpServers": {
 *       "binance-smart-money": {
 *         "command": "npx",
 *         "args": ["tsx", "src/scripts/mcp-server.ts"],
 *         "cwd": "/absolute/path/to/binance-smart-money-tracker"
 *       }
 *     }
 *   }
 *
 * All calls hit Binance live through the library's built-in 7-layer rate-limit
 * protection + memory cache, so they are safe to call ad hoc — no cron or local
 * database required.
 */
import 'dotenv/config';
import readline from 'node:readline';
import {
  getSmartMoneyOverview,
  smartMoneyNotionalUsd,
  smartMoneyShareOfOI,
  getTopTraderSnapshot,
  getOpenInterest,
  type TopTraderPeriod,
} from '../index';

const SERVER_INFO = { name: 'binance-smart-money', version: '1.0.0' };
const PROTOCOL_VERSION = '2025-06-18';

function normalizeSymbol(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return '';
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

function hoursAgo(ms: number | undefined): number | null {
  if (!ms) return null;
  return Math.round(((Date.now() - ms) / 3_600_000) * 10) / 10;
}

// ── Tool implementations ────────────────────────────────────────────────────

async function toolGetSmartMoney(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required, e.g. "BTC" or "BTCUSDT"' };
  const sm = await getSmartMoneyOverview(symbol);
  if (!sm) return { symbol, error: 'no data (symbol unsupported or Binance temporarily blocked)' };

  const notionalUsd = smartMoneyNotionalUsd(sm);
  const longProfitPct = sm.longTraders ? Math.round((sm.longProfitTraders / sm.longTraders) * 100) : null;
  const shortProfitPct = sm.shortTraders ? Math.round((sm.shortProfitTraders / sm.shortTraders) * 100) : null;
  return {
    symbol,
    longShortRatio: sm.longShortRatio,
    longWhales: sm.longWhales,
    shortWhales: sm.shortWhales,
    longWhalesAvgEntryPrice: sm.longWhalesAvgEntryPrice,
    shortWhalesAvgEntryPrice: sm.shortWhalesAvgEntryPrice,
    longProfitTraders: sm.longProfitTraders,
    shortProfitTraders: sm.shortProfitTraders,
    longProfitWhales: sm.longProfitWhales,
    shortProfitWhales: sm.shortProfitWhales,
    longProfitPct,
    shortProfitPct,
    notionalUsd: Math.round(notionalUsd),
    signalDayAgeHours: hoursAgo(sm.signalDay),
    note: 'longWhalesAvgEntryPrice / profitTraders are bapi-only fields not exposed by public fapi.',
  };
}

async function toolGetTopTrader(args: any) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) return { error: 'symbol is required' };
  const period = (args.period as TopTraderPeriod) || '5m';
  const tt = await getTopTraderSnapshot(symbol, period);
  if (!tt) return { symbol, period, error: 'no data' };
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
  if (!oi) return { symbol, error: 'no data' };
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
  const [sm, tt, oi] = await Promise.all([
    getSmartMoneyOverview(symbol),
    getTopTraderSnapshot(symbol, (args.period as TopTraderPeriod) || '5m'),
    getOpenInterest(symbol),
  ]);
  if (!sm && !tt && !oi) return { symbol, error: 'no data from any source' };

  const share = sm && oi ? smartMoneyShareOfOI(sm, oi.oiNowUsd) : null;
  return {
    symbol,
    smartMoney: sm && {
      longShortRatio: sm.longShortRatio,
      longWhalesAvgEntryPrice: sm.longWhalesAvgEntryPrice,
      shortWhalesAvgEntryPrice: sm.shortWhalesAvgEntryPrice,
      longProfitPct: sm.longTraders ? Math.round((sm.longProfitTraders / sm.longTraders) * 100) : null,
      shortProfitPct: sm.shortTraders ? Math.round((sm.shortProfitTraders / sm.shortTraders) * 100) : null,
      notionalUsd: Math.round(smartMoneyNotionalUsd(sm)),
    },
    topTrader: tt && { topPositionLsr: tt.topPositionLSR, takerBuySellRatio: tt.takerBSR },
    openInterest: oi && { oiNowUsd: Math.round(oi.oiNowUsd), oiChg1h: oi.oiChg1h, oiChg4h: oi.oiChg4h },
    smartMoneyShareOfOI: share == null ? null : Math.round(share * 1000) / 1000,
  };
}

const TOOLS: Record<string, { fn: (args: any) => Promise<any>; description: string; properties: any; required?: string[] }> = {
  get_smart_money: {
    fn: toolGetSmartMoney,
    description:
      "Binance Smart Money (Smart Signal) whale overview for a symbol: long/short whale counts, " +
      "their average entry prices, and how many traders/whales are currently in profit. These " +
      "bapi-only fields are not exposed by the public fapi API.",
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
      period: { type: 'string', description: 'one of 5m/15m/30m/1h/2h/4h/6h/12h/1d (default 5m)' },
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
      "One-shot combined view: smart-money whales + top-trader flow + open interest + Smart Money's " +
      "share of total OI. The single most useful call for 'what's the positioning on X'.",
    properties: {
      symbol: { type: 'string', description: 'e.g. "BTC" or "BTCUSDT"' },
      period: { type: 'string', description: 'top-trader period (default 5m)' },
    },
    required: ['symbol'],
  },
};

// ── JSON-RPC handling ───────────────────────────────────────────────────────

async function handle(req: any): Promise<any | null> {
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
        return ok({ content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (e: any) {
        return err(-32000, e?.message ?? String(e));
      }
    }
    default:
      // ignore other notifications; error on unknown requests that carry an id
      return id === undefined ? null : err(-32601, `Unknown method: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: any;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return; // ignore non-JSON lines
  }
  const resp = await handle(req);
  if (resp !== null) process.stdout.write(JSON.stringify(resp) + '\n');
});
