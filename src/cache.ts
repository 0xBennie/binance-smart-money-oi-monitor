// Bound a short-TTL per-symbol cache so a long-lived process (the MCP server or
// the Express dashboard) that scans many symbols can't grow the Map without
// limit. Not a true LRU — updates don't refresh recency — but TTLs here are
// short, so an occasional over-eviction just triggers a cheap re-fetch.
export function capSet<K, V>(m: Map<K, V>, key: K, value: V, max = 2000): void {
  m.set(key, value);
  if (m.size > max) {
    const oldest = m.keys().next().value as K | undefined;
    if (oldest !== undefined && oldest !== key) m.delete(oldest);
  }
}
