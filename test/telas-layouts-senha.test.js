// NEXA Telas, os painéis de senha do §15 do contrato (15/11, do dono): o catálogo das chaves novas, o tema (cor e claro/escuro),
// a fila de cada chamada e as filas com a última senha (byService), as duas filas do queue-duo (pair), o layout que sem a
// chamada de senha vira "full" e a prévia "Como aparece na TV" de cada layout novo (desenhada num DOM mínimo, sem navegador).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const TT = await import('../public/shared/telas-tipos.js');
const C = await import('../server/telas-core.js');
const S = await import('../server/telas-senha-core.js');
const AM = await import('../public/shared/telas-amostras.js');

const NEW = ['queue-table', 'queue-big', 'queue-cards', 'queue-header', 'queue-info', 'queue-mosaic', 'queue-duo', 'queue-grid', 'queue-list'];

test('catálogo: as 9 chaves novas pedem a chamada de senha, com nome e descrição curtos', () => {
  assert.deepEqual(TT.QUEUE_LAYOUT_KEYS, ['queue', ...NEW]);
  for (const k of NEW) {
    const l = TT.LAYOUTS.find((x) => x.key === k);
    assert.ok(l && l.queue === true && typeof l.video === 'boolean', k);
    assert.ok(l.label.length <= 30 && l.desc.length <= 140, `${k}: texto curto`);
    assert.ok(TT.LAYOUT_KEYS.includes(k) && TT.isQueueLayout(k));
  }
  assert.equal(TT.isQueueLayout('side'), false); assert.equal(TT.isQueueLayout('queue-x'), false);
  // sem vídeo: só a senha gigante e as duas filas
  assert.deepEqual(TT.LAYOUTS.filter((l) => l.queue && !l.video).map((l) => l.key), ['queue-big', 'queue-duo']);
  // tipos sem o módulo de senha não oferecem nenhum painel de senha
  assert.ok(!AM.layoutsFor('escola').some(TT.isQueueLayout));
  assert.ok(NEW.every((k) => AM.layoutsFor('upa').includes(k)));
  assert.equal(TT.serviceColor(0), '#2563eb'); assert.equal(TT.serviceColor(8), '#2563eb'); assert.equal(TT.themeColorKey('#15803D'), 'verde'); assert.equal(TT.themeColorKey('#123456'), 'azul');
});

test('tema: só as cores da lista (hex ou chave), claro ou escuro; de fábrica azul escuro; herda como os outros campos', () => {
  assert.deepEqual(C.cleanTheme({ color: 'verde', mode: 'light' }), { color: '#15803d', mode: 'light' });
  assert.deepEqual(C.cleanTheme({ color: '#9F1239' }), { color: '#9f1239', mode: 'dark' });
  assert.throws(() => C.cleanTheme({ color: '#123456' }), /cor fora da lista/);
  assert.throws(() => C.cleanTheme({ color: 'azul', mode: 'neon' }), /claro/);
  assert.throws(() => C.cleanTheme('azul'), /Tema/);
  assert.deepEqual(C.mergeConfig({}, { theme: { color: 'roxo', mode: 'dark' } }), { theme: { color: '#6d28d9', mode: 'dark' } });
  assert.deepEqual(C.mergeConfig({ theme: { color: '#6d28d9', mode: 'dark' } }, { theme: null }), {}, 'null volta a herdar');
  assert.ok(C.OFFICE_DEVICE_CONFIG_KEYS.includes('theme'), 'o gestor da repartição escolhe o tema da tela');
  assert.ok(!C.GROUP_CONFIG_KEYS.includes('theme'), 'o grupo não define o tema');
  const eff = C.effectiveConfig({ defaults: { theme: { color: '#0f766e', mode: 'dark' } }, office: { theme: { color: '#c2410c', mode: 'light' } } });
  assert.deepEqual(eff.theme, { color: '#c2410c', mode: 'light' }, 'a repartição vence o padrão');
  assert.deepEqual(C.effectiveConfig({}).theme, TT.THEME_DEFAULT);
});

test('contrato: os layouts novos só com a chamada de senha ligada (senão "full"); theme e queue.pair sempre presentes', () => {
  const base = { eff: { ...C.FACTORY, pin: { hash: 'h', salt: 's' } }, device: { id: 1, name: 'T' }, office: { name: 'UPA', type: 'upa' }, stream: { hls: 'https://x.test/a.m3u8' } };
  for (const k of NEW) {
    const eff = { ...base.eff, layout: k };
    assert.equal(C.contractConfig({ ...base, eff }).layout, 'full', `${k} sem a senha`);
    assert.equal(C.contractConfig({ ...base, eff, queue: { enabled: true, title: 'A' } }).layout, k, `${k} com a senha`);
  }
  const on = C.contractConfig({ ...base, queue: { enabled: true, title: 'A', pair: [7, '9', 0, 3] } });
  assert.deepEqual(on.queue.pair, [7, 9], 'só ids válidos, até 2');
  assert.deepEqual(on.theme, { color: '#1d4ed8', mode: 'dark' });
  assert.deepEqual(C.contractConfig(base).queue.pair, []);
  const lit = C.contractConfig({ ...base, eff: { ...base.eff, theme: { color: '#15803d', mode: 'light' } } });
  assert.deepEqual(lit.theme, { color: '#15803d', mode: 'light' }); assert.notEqual(C.revOf(lit), C.revOf(C.contractConfig(base)), 'o tema muda o rev');
});

test('filas: o nome da fila em cada chamada, byService com a cor, a última chamada e quem espera; pair validado', () => {
  assert.equal(S.callDto({ id: 1, code: 'A001', desk: 'G1', priority: 0, at: 5, service: 'Geral' }).service, 'Geral');
  assert.equal(S.callDto({ id: 1, code: 'A001', desk: 'G1', priority: 0, at: 5 }).service, null);
  const services = [{ id: 3, name: 'Geral', active: 1 }, { id: 4, name: 'Antiga', active: 0 }, { id: 5, name: 'Vacina', active: 1 }];
  const dto = (c) => S.callDto({ ...c, at: c.shown_at }, { showName: false, risk: true });
  const out = S.byServiceOf(services, [{ id: 10, service_id: 5, code: 'V002', desk: 'Sala 1', name: 'Ana S.', priority: 0, risk: 'verde', shown_at: 99 }], [{ service_id: 3 }, { service_id: 3 }, { service_id: 5 }], dto);
  assert.deepEqual(out, [
    { id: 3, name: 'Geral', color: '#2563eb', current: null, waiting: 2 },
    { id: 5, name: 'Vacina', color: '#16a34a', current: { id: 10, ticket: 'V002', desk: 'Sala 1', name: null, priority: false, at: 99, risk: 'verde', service: 'Vacina' }, waiting: 1 },
  ], 'a fila desativada sai; o nome só com showName');
  assert.equal(S.byServiceOf(Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `F${i}`, active: 1 })), [], [], dto).length, S.BY_SERVICE_MAX);
  assert.deepEqual(S.cleanPair([5, '3']), [5, 3]); assert.deepEqual(S.cleanPair(null), []); assert.deepEqual(S.cleanPair([5, 5]), [5]);
  assert.throws(() => S.cleanPair([1, 2, 3]), /no máximo 2/); assert.throws(() => S.cleanPair(['x']), /inválida/); assert.throws(() => S.cleanPair('1'), /lista/);
  assert.deepEqual(S.queueConfigOf({ pair: [1, 2, 3] }, 'ubs').pair, [1, 2], 'o guardado estranho não derruba');
  assert.deepEqual(S.cleanQueueConfig({ pair: [8] }, {}, 'ubs').pair, [8]);
  assert.deepEqual(S.cleanQueueConfig({ title: 'X' }, { pair: [8, 9] }, 'ubs').pair, [8, 9], 'sem pair no pedido, fica o guardado');
});

/* ------------------------------------------------------------------ a prévia num DOM mínimo */
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.className = ''; this.nodeType = 1; }
  append(...k) { for (const x of k) this.children.push(typeof x === 'string' ? new Text(x) : x); }
  setAttribute(k, v) { this.attrs[k] = v; }
  get classList() { const n = this; return { add: (...c) => { n.className = [...new Set([...n.className.split(' ').filter(Boolean), ...c])].join(' '); }, contains: (c) => n.className.split(' ').includes(c) }; }
  get textContent() { return this.children.map((c) => c.textContent).join(' '); }
  all(cls) { const out = []; const walk = (n) => { if (n.className?.split?.(' ').includes(cls)) out.push(n); for (const c of n.children || []) walk(c); }; walk(this); return out; }
}
class Text { constructor(t) { this.text = t; this.nodeType = 3; } get textContent() { return this.text; } }
globalThis.document = { createElement: (t) => new Node(t), createTextNode: (t) => new Text(t), createElementNS: (_, t) => new Node(t) };
const P = await import('../public/shared/telas-previa.js');

test('prévia: cada layout novo desenha a senha atual, as anteriores em caixas, o tema e, quando tem, o vídeo', () => {
  const css = fs.readFileSync(new URL('../public/shared/telas-previa.css', import.meta.url), 'utf8');
  for (const k of NEW) {
    const cfg = { ...AM.sampleFor('upa', k, 'UPA Norte'), office: 'UPA Norte', theme: { color: '#15803d', mode: 'light' }, clock: '14:32', date: 'sábado, 15 de novembro' };
    const n = P.tvPreview(cfg);
    assert.ok(n.className.includes(`l-${k}`) && n.classList.contains('qx') && n.classList.contains('th-verde') && n.classList.contains('th-light'), `${k}: ${n.className}`);
    const txt = n.textContent;
    if (k === 'queue-duo' || k === 'queue-grid') assert.ok(txt.includes('Clínica geral'), `${k}: o nome da fila`);
    else assert.ok(txt.includes('C 047'), `${k}: a senha atual`);
    assert.equal(n.all('vid').length > 0, TT.LAYOUTS.find((l) => l.key === k).video, `${k}: vídeo`);
    assert.ok(new RegExp(`\\.l-${k}\\b`).test(css) || ['queue-header', 'queue-cards'].includes(k), `${k}: tem estilo`);
    assert.ok(!/dor no peito|febre/i.test(txt), 'nunca o motivo da triagem');
  }
  // UPA: a cor do risco no cartão grande (legível: classe rkbg-*) e o nível em palavras, nunca o problema
  const big = P.tvPreview({ ...AM.sampleFor('upa', 'queue-header'), office: 'UPA' });
  assert.equal(big.all('rkbg-amarelo').length, 1); assert.ok(big.textContent.includes('URGENTE'));
  // o painel "queue" de sempre: últimas chamadas em caixas ao lado do cartão grande; em atendimento também em caixas
  const q = P.tvPreview(AM.sampleFor('central-cidadao', 'queue'));
  assert.ok(q.textContent.includes('Últimas chamadas')); assert.equal(q.all('qlc')[0].all('qb').length, 4); assert.ok(q.all('qsv')[0].all('qb').length >= 1);
  // a coluna lateral: a senha atual e até 3 anteriores em caixas menores
  const side = P.tvPreview({ layout: 'side', side: { widgets: ['queue'], queue: ['A 1', 'G 1'], queueLast: ['A 0', 'B 9', 'C 8', 'D 7'] } });
  assert.equal(side.all('snb').length, 3);
  // o desaparecido em tela cheia nunca cobre um painel de senha (só a faixa)
  const m = P.tvPreview({ ...AM.sampleFor('upa', 'queue-table'), missing: { mode: 'full', name: 'Teste' } });
  assert.ok(!m.className.includes('l-missing') && m.all('mb').length === 1);
});
