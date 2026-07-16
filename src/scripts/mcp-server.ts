#!/usr/bin/env node
/**
 * MCP stdio server — exposes the Binance Smart Money / Top Trader / Open Interest
 * library over the Model Context Protocol, so any MCP-compatible terminal AI
 * (Claude Code, Claude Desktop, Codex CLI, Gemini CLI, Cursor, Windsurf, Cline,
 * Zed, Continue, …) can query live whale positioning as a tool.
 *
 * Transport: stdio, one JSON-RPC message per line. No extra dependencies — it
 * speaks the protocol directly, the same way the rest of this repo avoids heavy
 * frameworks. The protocol logic (tools + handler) lives in ../mcp-core.ts so it
 * can be unit-tested without a stdin loop; this file is just the transport.
 *
 * Usage:
 *   npx tsx src/scripts/mcp-server.ts          # or: npm run mcp
 *
 * Register it with your AI client — one line, no clone, no build:
 *   claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
 *
 * All calls hit Binance live through the library's built-in 7-layer rate-limit
 * protection + memory cache, so they are safe to call ad hoc — no cron or local
 * database required.
 */
import 'dotenv/config';
import readline from 'node:readline';
import { handle, SERVER_INFO } from '../mcp-core.js';

const argv = process.argv.slice(2);
if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write(SERVER_INFO.version + '\n');
  process.exit(0);
}
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    `binance-smart-money-oi-monitor v${SERVER_INFO.version}\n\n` +
    `This binary is an MCP stdio server. Register it with your AI client:\n` +
    `  claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest\n\n` +
    `Other commands (from a clone, via npm run):\n` +
    `  npm run analyze -- <SYMBOL>   one-shot readable report for a coin\n` +
    `  npm run panel -- <SYMBOL>     shareable dark-HTML Smart Money card\n` +
    `  npm run track              tracker daemon (SMART_MONEY_WATCHLIST, _INTERVAL_MIN)\n` +
    `  npm run change -- <SYM> [min] [--json]  position change (needs tracker)\n` +
    `  npm run trend -- <SYM> [min] [--json]   profit trend (needs tracker)\n` +
    `  npm run scan               market-wide most long/short-heavy (needs tracker)\n` +
    `  npm run chart -- <SYMBOL>  long/short position + avg-entry time-series chart\n` +
    `  npm run dashboard          Express dashboard + JSON API (PORT=3001)\n` +
    `  npm run doctor             diagnose Binance reachability / DB / deps\n\n` +
    `Env: SMART_MONEY_DB_PATH (shared db path), SMART_MONEY_WATCHLIST, SMART_MONEY_INTERVAL_MIN.\n` +
    `Docs: https://github.com/0xBennie/binance-smart-money-oi-monitor\n`,
  );
  process.exit(0);
}

// Run bare in a terminal (not piped by an MCP client) it just waits on stdin,
// which looks like a hang. Tell the user what this is instead of going silent.
if (process.stdin.isTTY) {
  process.stderr.write(
    'binance-smart-money MCP server (stdio) — meant to be launched by an MCP client,\n' +
    'not run by hand. It is now waiting for JSON-RPC on stdin. Register it, e.g.:\n' +
    '  claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest\n' +
    '(Ctrl-C to exit.)\n',
  );
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
