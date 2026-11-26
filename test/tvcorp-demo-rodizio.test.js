// O rodízio de DEMONSTRAÇÃO (server/tvcorp-demo-rodizio.js): a limpeza do que vem do painel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limparRodizio, RODIZIO_MIN_S, RODIZIO_MAX_S } from '../server/tvcorp-demo-rodizio.js';

test('rodízio: intervalo entre 10 s e 1 h, ids limpos e sem repetir', () => {
  const r = limparRodizio({ on: 1, seconds: 3, layoutIds: [3, '3', 1, -2, 'x'], devices: [7, 7] }, 1000);
  assert.equal(r.on, true);
  assert.equal(r.seconds, RODIZIO_MIN_S);
  assert.deepEqual(r.layoutIds, [3, 1]);
  assert.deepEqual(r.devices, [7]);
  assert.equal(r.startedAt, 1000);
  assert.equal(limparRodizio({ seconds: 99999 }).seconds, RODIZIO_MAX_S);
  assert.equal(limparRodizio({}).seconds, 30);
  assert.equal(limparRodizio({}).on, false);
});
