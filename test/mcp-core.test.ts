import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, TOOLS, SERVER_INFO } from '../src/mcp-core.js';

test('tools/list exposes all five+ tools including render_panel and render_push', async () => {
  const resp: any = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names = resp.result.tools.map((t: any) => t.name);
  for (const n of ['get_smart_money', 'get_top_trader', 'get_open_interest', 'get_full_picture', 'render_panel', 'render_push']) {
    assert.ok(names.includes(n), `tools/list missing ${n}`);
  }
  // every tool advertises an object input schema requiring symbol
  for (const t of resp.result.tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.inputSchema.required.includes('symbol'));
  }
});

test('initialize reports serverInfo version 1.3.0', async () => {
  const resp: any = await handle({ jsonrpc: '2.0', id: 2, method: 'initialize' });
  assert.equal(resp.result.serverInfo.version, '1.4.0');
  assert.equal(SERVER_INFO.version, '1.4.0');
});

test('tools/call marks isError=true when a tool returns an error result', async () => {
  const orig = TOOLS.get_smart_money.fn;
  TOOLS.get_smart_money.fn = async () => ({ symbol: 'X', error: 'no data' });
  try {
    const resp: any = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_smart_money', arguments: { symbol: 'X' } } });
    assert.equal(resp.result.isError, true);
    assert.match(resp.result.content[0].text, /no data/);
  } finally {
    TOOLS.get_smart_money.fn = orig;
  }
});

test('tools/call marks isError=false for a normal result', async () => {
  const orig = TOOLS.get_smart_money.fn;
  TOOLS.get_smart_money.fn = async () => ({ symbol: 'X', longWhales: 5 });
  try {
    const resp: any = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_smart_money', arguments: { symbol: 'X' } } });
    assert.equal(resp.result.isError, false);
  } finally {
    TOOLS.get_smart_money.fn = orig;
  }
});

test('unknown tool returns a JSON-RPC method-not-found error', async () => {
  const resp: any = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(resp.error.code, -32601);
});

test('a notification (no id) yields no response', async () => {
  const resp = await handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(resp, null);
});
