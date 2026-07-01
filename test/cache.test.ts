import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capSet } from '../src/cache.js';

test('capSet evicts the oldest entry when over the cap', () => {
  const m = new Map<string, number>();
  for (let i = 0; i < 5; i++) capSet(m, 'k' + i, i, 3);
  assert.equal(m.size, 3);
  assert.ok(!m.has('k0') && !m.has('k1'), 'oldest two evicted');
  assert.ok(m.has('k2') && m.has('k3') && m.has('k4'), 'newest three kept');
});

test('capSet updating an existing key does not grow the map', () => {
  const m = new Map<string, number>();
  capSet(m, 'a', 1, 2);
  capSet(m, 'b', 2, 2);
  capSet(m, 'a', 9, 2);
  assert.equal(m.size, 2);
  assert.equal(m.get('a'), 9);
});

test('capSet under the cap keeps everything', () => {
  const m = new Map<string, number>();
  capSet(m, 'x', 1);   // default cap
  assert.equal(m.size, 1);
  assert.equal(m.get('x'), 1);
});
