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
 * Register in Claude Code (~/.claude.json or project .mcp.json):
 *   {
 *     "mcpServers": {
 *       "binance-smart-money": {
 *         "command": "npx",
 *         "args": ["tsx", "src/scripts/mcp-server.ts"],
 *         "cwd": "/absolute/path/to/binance-smart-money-oi-monitor"
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
import { handle } from '../mcp-core.js';

// Run bare in a terminal (not piped by an MCP client) it just waits on stdin,
// which looks like a hang. Tell the user what this is instead of going silent.
if (process.stdin.isTTY) {
  process.stderr.write(
    'binance-smart-money MCP server (stdio) — meant to be launched by an MCP client,\n' +
    'not run by hand. It is now waiting for JSON-RPC on stdin. Register it, e.g.:\n' +
    '  claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor\n' +
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
