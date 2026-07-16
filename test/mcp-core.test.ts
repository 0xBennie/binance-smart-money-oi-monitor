import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, TOOLS, SERVER_INFO, RATIO_HINT } from '../src/mcp-core.js';

test('tools/list exposes all five+ tools including render_panel and render_push', async () => {
  const resp: any = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names = resp.result.tools.map((t: any) => t.name);
  for (const n of ['get_smart_money', 'get_top_trader', 'get_open_interest', 'get_full_picture', 'get_funding', 'render_panel', 'render_push', 'get_change', 'scan_extreme', 'render_chart']) {
    assert.ok(names.includes(n), `tools/list missing ${n}`);
  }
  // every tool advertises an object input schema; all require symbol except the
  // market-wide scan (scan_extreme takes no symbol).
  for (const t of resp.result.tools) {
    assert.equal(t.inputSchema.type, 'object');
    if (t.name !== 'scan_extreme') assert.ok(t.inputSchema.required.includes('symbol'));
  }
});

test('initialize reports serverInfo version 1.12.1', async () => {
  const resp: any = await handle({ jsonrpc: '2.0', id: 2, method: 'initialize' });
  assert.equal(resp.result.serverInfo.version, '1.12.1');
  assert.equal(SERVER_INFO.version, '1.12.1');
});

test('render_panel and render_push expose a lang enum (per-call card language)', async () => {
  const resp: any = await handle({ jsonrpc: '2.0', id: 6, method: 'tools/list' });
  const byName = Object.fromEntries(resp.result.tools.map((t: any) => [t.name, t]));
  for (const name of ['render_panel', 'render_push']) {
    const lang = byName[name]?.inputSchema?.properties?.lang;
    assert.ok(lang, `${name} should expose a lang property`);
    assert.deepEqual(lang.enum, ['zh', 'en']);
  }
});

test('editorial DB tools attach the shared disclaimer', () => {
  for (const name of ['get_change', 'get_profit_trend', 'render_chart']) {
    assert.match(String(TOOLS[name]!.fn), /DISCLAIMER/, `${name} must attach DISCLAIMER`);
  }
});

test('disclaimer is uniform: every data-returning tool attaches DISCLAIMER', () => {
  // Previously get_top_trader / get_open_interest omitted it — the rule is now
  // "every tool carries it, uniformly". Source-match, same as the DB-tools test.
  for (const name of Object.keys(TOOLS)) {
    assert.match(String(TOOLS[name]!.fn), /DISCLAIMER/, `${name} must attach DISCLAIMER`);
  }
});

test('get_top_trader and get_open_interest now include the disclaimer', () => {
  for (const name of ['get_top_trader', 'get_open_interest']) {
    assert.match(String(TOOLS[name]!.fn), /disclaimer:\s*DISCLAIMER/, `${name} must attach DISCLAIMER`);
  }
});

test('longShortRatio hint is count-based, never notional', () => {
  // longShortRatio = longTraders ÷ shortTraders (a count ratio); the notional ratio
  // is a separate field. The hint must describe it as a trader/count ratio and must
  // NOT describe this count field as "notional".
  assert.doesNotMatch(RATIO_HINT, /notional/i, 'ratio hint must not call longShortRatio notional');
  assert.match(RATIO_HINT, /longShortRatio/);
  assert.match(RATIO_HINT, /count/i);
  assert.match(RATIO_HINT, /trader/i);
});

test('get_smart_money and get_full_picture both carry the corrected ratio note', () => {
  // Both tools surface longShortRatio, so both must attach the shared RATIO_HINT.
  for (const name of ['get_smart_money', 'get_full_picture']) {
    assert.match(String(TOOLS[name]!.fn), /RATIO_HINT/, `${name} must attach RATIO_HINT`);
  }
});

test('render_push metadata is language-neutral (no hardcoded Chinese term)', () => {
  // An English (lang:'en') call must not get a Chinese term back in the note. The
  // note lives in the fn body (the description is a separate property that may stay
  // bilingual), so the fn source must be free of the hardcoded Chinese term.
  assert.doesNotMatch(String(TOOLS.render_push!.fn), /巨鲸总览/, 'render_push note must be language-neutral');
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
