// NEXA Telas: as regras sem banco da comunicação interna (server/telas-interna-core.js) e do som da chamada de senha
// (contrato §16, server/telas-core.js): os códigos de fábrica e a lista editável, o aviso interno, a chave de quem leu, o
// alcance por setor, e a precedência campo a campo do callSound (tela > repartição > padrão; null = o app decide).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../server/telas-interna-core.js';
import * as C from '../server/telas-core.js';

const status = (fn) => { try { fn(); return 200; } catch (e) { return e.status || 500; } };

test('códigos de emergência: os de fábrica, a lista editável e a cor do texto', () => {
  assert.deepEqual(I.DEFAULT_CODES.map((c) => [c.key, c.label]), [['azul', 'Código Azul'], ['vermelho', 'Código Vermelho'], ['rosa', 'Código Rosa'], ['laranja', 'Código Laranja'], ['cinza', 'Código Cinza'], ['amarelo', 'Código Amarelo']]);
  assert.deepEqual(I.cleanCodes([{ label: 'Código Branco', meaning: 'Falta de energia', color: '#EEEEEE' }]), [{ key: 'branco', label: 'Código Branco', meaning: 'Falta de energia', color: '#eeeeee' }]);
  assert.deepEqual(Object.values(I.cleanCodes([{ label: 'Código Pânico Geral', color: 'preto' }])[0]), ['panico-geral', 'Código Pânico Geral', '', '#212121'], 'a cor pela chave da paleta');
  for (const bad of [[], [{ label: 'A', color: '#000000' }], [{ label: 'Azul', color: 'celeste' }], [{ label: 'Azul', color: '#123456' }], [{ label: 'Azul', color: 'azul' }, { label: 'Código azul', color: 'azul' }], Array.from({ length: 13 }, (_, i) => ({ label: `Código ${i}x`, color: '#000000' }))]) assert.equal(status(() => I.cleanCodes(bad)), 400);
  assert.deepEqual([I.textOn('#1565c0'), I.textOn('#f9a825'), I.textOn('#eeeeee'), I.textOn('#c62828')], ['#ffffff', '#1a1a1a', '#1a1a1a', '#ffffff']);
  assert.deepEqual([I.cleanCodeMinutes(0), I.cleanCodeMinutes('45'), status(() => I.cleanCodeMinutes(-1)), status(() => I.cleanCodeMinutes(721))], [0, 45, 400, 400]);
  const t = 1e12;
  assert.equal(I.codeActive({ closed_at: null, until_at: null }, t), true, 'até encerrar');
  assert.equal(I.codeActive({ closed_at: null, until_at: t }, t), false, 'o tempo acabou');
  assert.equal(I.codeActive({ closed_at: t - 1, until_at: null }, t), false);
});

test('aviso interno, quem leu e o alcance por setor', () => {
  const now = 1.8e12;
  const n = I.cleanNotice({ title: '  Reunião  ', text: 'Linha 1\r\nLinha 2', sectors: [3, '3', 4, 'x'], days: 2 }, { now });
  assert.deepEqual([n.kind, n.title, n.body, n.sectors, n.seconds, n.startsAt, n.until], ['aviso', 'Reunião', 'Linha 1\nLinha 2', [3, 4], 15, now, now + 2 * 86400_000]);
  assert.equal(I.cleanNotice({ title: 'x1' }, { now }).until, now + 7 * 86400_000, '7 dias de padrão');
  for (const bad of [{ title: 'x' }, { title: 'ok', kind: 'outro' }, { title: 'ok', days: 61 }, { title: 'ok', seconds: 2 }, { title: 'ok', until: now + 1000 }]) assert.equal(status(() => I.cleanNotice(bad, { now })), 400, JSON.stringify(bad));
  assert.deepEqual(I.INT_KINDS.map((k) => k.key), ['aviso', 'escala', 'treinamento', 'protocolo', 'aniversariantes']);
  assert.equal(I.readerKey('  José   da SILVA '), 'jose da silva');
  assert.equal(I.readerKey('Ana Souza'), I.readerKey('ANA  souza'));
  assert.equal(status(() => I.cleanReader(' a ')), 400);
  assert.deepEqual(I.cleanStaff('Ana\n\nana\nBruno Lima\n  x  '), ['Ana', 'Bruno Lima']);
  assert.equal(status(() => I.cleanStaff(Array.from({ length: 301 }, (_, i) => `Pessoa ${i}`))), 400);
  assert.deepEqual([I.noticeHits([], 5), I.noticeHits([5], 5), I.noticeHits([6], 5), I.noticeHits([6], null)], [true, true, false, true], 'vazio = todos; tela sem setor recebe todos');
});

test('som da chamada (§16): limpeza e precedência campo a campo', () => {
  assert.deepEqual(C.FACTORY.callSound, { mode: null, volume: 100 });
  assert.deepEqual(C.cleanCallSound({ mode: 'voice', volume: '70' }), { mode: 'voice', volume: 70 });
  assert.equal(C.cleanCallSound({ mode: null, volume: 100 }), undefined, 'nada definido: herda');
  assert.deepEqual(C.cleanCallSound({ mode: '', volume: 30 }), { mode: null, volume: 30 });
  for (const bad of [null, [], { mode: 'grito' }, { mode: 'beep', volume: 101 }, { mode: 'beep', volume: -1 }]) assert.equal(status(() => C.cleanCallSound(bad)), 400);
  const eff = (levels) => C.effectiveConfig({ officeType: 'upa', ...levels }).callSound;
  assert.deepEqual(eff({}), { mode: null, volume: 100 }, 'de fábrica: o app decide (sem escolha lá, bipe + falada)');
  assert.deepEqual(eff({ defaults: { callSound: { mode: 'beep', volume: 50 } } }), { mode: 'beep', volume: 50 });
  assert.deepEqual(eff({ defaults: { callSound: { mode: 'beep', volume: 50 } }, office: { callSound: { mode: 'both', volume: 100 } } }), { mode: 'both', volume: 100 });
  assert.deepEqual(eff({ office: { callSound: { mode: 'beep', volume: 60 } }, device: { callSound: { mode: null, volume: 40 } } }), { mode: 'beep', volume: 40 }, 'o modo da repartição, o volume da tela');
  assert.deepEqual(C.mergeConfig({}, { callSound: { mode: 'voice', volume: 80 } }), { callSound: { mode: 'voice', volume: 80 } });
  assert.deepEqual(C.mergeConfig({ callSound: { mode: 'voice', volume: 80 } }, { callSound: null }), {}, 'null tira');
  assert.ok(C.OFFICE_DEVICE_CONFIG_KEYS.includes('callSound'), 'o gestor da repartição define por tela');
});
