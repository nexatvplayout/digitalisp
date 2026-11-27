// A PERMUTA (server/tvcorp-permuta.js): a propaganda obrigatória da revenda nas telas do cliente final.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limparPermuta, telaNaPermuta, intercalar, zonaDaPermuta } from '../server/tvcorp-permuta.js';

test('permuta: limpa, só telas marcadas ou todas', () => {
  const p = limparPermuta({ on: 1, scope: 'x', devices: [3, '3', -1, 'a', 7], items: [{ kind: 'media', id: 5 }, { kind: 'media', id: 5 }, { kind: 'playlist', id: '2' }, { kind: 'zzz', id: 0 }] });
  assert.deepEqual(p, { on: true, scope: 'permuta', devices: [3, 7], items: [{ kind: 'media', id: 5 }, { kind: 'playlist', id: 2 }] });
  assert.equal(telaNaPermuta(p, 3), true);
  assert.equal(telaNaPermuta(p, 4), false);
  assert.equal(telaNaPermuta({ ...p, scope: 'all' }, 4), true);
  assert.equal(telaNaPermuta({ ...p, on: false }, 3), false);
  assert.equal(telaNaPermuta({ ...p, items: [] }, 3), false);
});

test('permuta: a propaganda espalhada na programação e nunca cortada', () => {
  assert.deepEqual(intercalar(['a', 'b', 'c', 'd'], ['X', 'Y'], 50), ['a', 'b', 'X', 'c', 'd', 'Y']);
  assert.deepEqual(intercalar(['a'], ['X', 'Y'], 50), ['a', 'X', 'Y']);
  assert.deepEqual(intercalar([], ['X'], 50), ['X']);
  assert.deepEqual(intercalar(['a', 'b', 'c'], ['X'], 3), ['a', 'b', 'X']); // corta o do cliente, não a propaganda
});

test('permuta: entra na zona de playlist maior', () => {
  const z = zonaDaPermuta([{ id: 'v', kind: 'video', w: 80, h: 80 }, { id: 'p1', kind: 'playlist', w: 20, h: 50 }, { id: 'p2', kind: 'playlist', w: 40, h: 50 }]);
  assert.equal(z.id, 'p2');
  assert.equal(zonaDaPermuta([{ id: 'v', kind: 'video', w: 100, h: 100 }]), null);
});
