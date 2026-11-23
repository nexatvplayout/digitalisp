// DIGITAL ISP · os modelos de layout: os 30 e tantos com gadgets por segmento, os de elevador e os conjuntos de várias TVs
// (menu board de shopping). Todo modelo passa na validação do servidor; cada conjunto aponta para telas que existem, na
// mesma orientação; os segmentos e os exemplos das zonas "Gadget" existem.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../public/shared/tvcorp-tipos.js');
const K = await import('../server/tvcorp-core.js');
const M = T.TVC_LAYOUT_MODELS;

test('todo modelo passa na validação do servidor e tem um segmento conhecido', () => {
  const segs = new Set(T.TVC_LAYOUT_SEGMENTS.map((x) => x.key));
  for (const m of M) {
    const l = K.cleanLayout({ factoryKey: m.key });
    assert.equal(l.zones.length, m.zones.length, m.key);
    assert.ok(segs.has(m.segment), `${m.key}: segmento ${m.segment}`);
  }
  assert.equal(new Set(M.map((m) => m.key)).size, M.length, 'chaves sem repetir');
});

test('30 ou mais modelos novos com gadgets, deitados e em pé, em vários segmentos', () => {
  const gadget = new Set(['widget', 'clock', 'weather', 'countdown', 'safety', 'worldclock', 'news', 'quotes', 'qr', 'queue']);
  const novos = M.filter((m) => !m.set && m.segment !== 'elevador' && m.zones.some((z) => gadget.has(z.kind))).filter((m) => !['recepcao', 'chao-de-fabrica', 'refeitorio'].includes(m.key));
  assert.ok(novos.length >= 30, `só ${novos.length}`);
  assert.ok(novos.some((m) => m.orientation === 'port') && novos.some((m) => m.orientation === 'land'));
  assert.ok(new Set(novos.map((m) => m.segment)).size >= 10, 'vários segmentos');
  for (const m of M) for (const z of m.zones) if (z.kind === 'widget') assert.ok(['clock', 'weather', 'agenda', 'dashboard', 'reviews', 'directions'].includes(z.sample), `${m.key}/${z.id}: exemplo da prévia`);
});

test('elevador: em pé e deitado, com hora, avisos (texto rolante) e anúncios', () => {
  const el = M.filter((m) => m.segment === 'elevador');
  assert.ok(el.length >= 4);
  assert.ok(el.some((m) => m.orientation === 'port') && el.some((m) => m.orientation === 'land'));
  for (const m of el) {
    assert.ok(m.zones.some((z) => z.kind === 'ticker'), `${m.key}: avisos`);
    assert.ok(m.zones.some((z) => z.kind === 'playlist'), `${m.key}: anúncios`);
    assert.ok(m.zones.some((z) => z.kind === 'clock' || z.sample === 'clock'), `${m.key}: hora`);
  }
});

test('conjuntos de várias TVs: 2, 3 e 4 telas, deitadas e em pé, cada tela um modelo do mesmo conjunto e orientação', () => {
  const sets = T.TVC_LAYOUT_SETS;
  assert.deepEqual([...new Set(sets.map((s) => s.screens.length))].sort(), [2, 3, 4]);
  assert.ok(sets.some((s) => s.orientation === 'port') && sets.some((s) => s.orientation === 'land'));
  const used = new Set();
  for (const s of sets) for (const k of s.screens) {
    const m = T.TVC_LAYOUT_MODEL[k];
    assert.ok(m, `${s.key}: ${k}`); assert.equal(m.set, s.key); assert.equal(m.orientation, s.orientation);
    used.add(k);
  }
  assert.deepEqual(M.filter((m) => m.set).map((m) => m.key).sort(), [...used].sort(), 'toda tela de conjunto está num conjunto');
});

test('zonas por cima da imagem: a de cima pode ficar sobre a de baixo, duas da mesma camada não; o vídeo não vai por cima', () => {
  const base = { id: 'main', kind: 'playlist', x: 0, y: 0, w: 100, h: 100 };
  const zs = K.cleanZones([{ id: 'clock', kind: 'clock', x: 78, y: 3, w: 20, h: 16, overlay: true, opacity: 40 }, base]);
  assert.deepEqual(zs.map((z) => z.id), ['main', 'clock'], 'a camada de cima vai por último (ordem de desenhar)');
  assert.equal(zs[1].opacity, 40); assert.equal(zs[0].overlay, undefined);
  assert.equal(K.cleanZone({ id: 'q', kind: 'qr', x: 0, y: 0, w: 20, h: 20, qr: 'https://exemplo.com.br', overlay: true }).opacity, 60, 'fundo padrão 60%');
  assert.throws(() => K.cleanZones([base, { id: 'b', kind: 'clock', x: 10, y: 10, w: 20, h: 20 }]), /uma por cima da outra/);
  assert.throws(() => K.cleanZones([base, { id: 'a', kind: 'clock', x: 10, y: 10, w: 20, h: 20, overlay: true }, { id: 'b', kind: 'weather', x: 20, y: 20, w: 20, h: 20, overlay: true }]), /uma por cima da outra/);
  assert.throws(() => K.cleanZone({ id: 'v', kind: 'video', x: 0, y: 0, w: 20, h: 20, overlay: true }), /vídeo/);
  assert.throws(() => K.cleanZone({ id: 'c', kind: 'clock', x: 0, y: 0, w: 20, h: 20, overlay: true, opacity: 150 }), /0 a 100/);
  const ov = M.filter((m) => m.zones.some((z) => z.overlay));
  assert.ok(ov.length >= 5, 'modelos prontos com widgets por cima');
});
