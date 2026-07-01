// Single source of truth for symbol normalization, shared by the library
// surface, the MCP server, and the panel builder so 'btc' → 'BTCUSDT'
// consistently everywhere. Returns '' for empty/nullish input.
export function normalizeSymbol(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return '';
  return s.endsWith('USDT') ? s : `${s}USDT`;
}
