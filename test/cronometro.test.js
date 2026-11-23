// DIGITAL ISP · o gadget de contagem regressiva: a zona do layout aceita o gadget escolhido direto (sem playlist), o
// contador guarda o fim opcional ("termina em") e o desenho mostra dias, horas, minutos e segundos, andando a cada segundo.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const K = await import('../server/tvcorp-core.js');
const D = await import('../server/tvcorp-dados.js');

test('zona do layout: contador, dias sem acidente e relógio mundial aceitam o gadget; as outras não', () => {
  assert.deepEqual(K.cleanZone({ id: 'cd', kind: 'countdown', x: 0, y: 0, w: 30, h: 30, widget: '7' }), { id: 'cd', kind: 'countdown', x: 0, y: 0, w: 30, h: 30, widget: 7 });
  assert.equal(K.cleanZone({ id: 'sa', kind: 'safety', x: 0, y: 0, w: 30, h: 30, widget: 3 }).widget, 3);
  assert.equal(K.cleanZone({ id: 'wc', kind: 'worldclock', x: 0, y: 0, w: 30, h: 30, widget: 4, title: 'Fusos' }).widget, 4);
  assert.equal('widget' in K.cleanZone({ id: 'cd', kind: 'countdown', x: 0, y: 0, w: 30, h: 30 }), false, 'sem gadget: pela playlist da grade');
  assert.equal('widget' in K.cleanZone({ id: 'tx', kind: 'text', x: 0, y: 0, w: 30, h: 30, widget: 7, text: 'Oi' }), false, 'zona de texto não leva gadget');
  assert.throws(() => K.cleanZone({ id: 'cd', kind: 'countdown', x: 0, y: 0, w: 30, h: 30, widget: 'abc' }), /gadget/);
});

test('contador: o fim é opcional e vem depois do começo', () => {
  const at = Date.UTC(2027, 0, 10, 12);
  assert.deepEqual(D.cleanWidget('countdown', { name: 'Promoção', data: { title: 'Liquidação', at, until: at + 3 * 86400_000, text: 'Corra!' } }).data, { title: 'Liquidação', at, text: 'Corra!', until: at + 3 * 86400_000 });
  assert.equal('until' in D.cleanWidget('countdown', { data: { title: 'SIPAT', at } }).data, false);
  assert.throws(() => D.cleanWidget('countdown', { data: { title: 'Promoção', at, until: at - 1000 } }), /fim vem depois/);
});

/* ------------------------------------------------------------------ o desenho */
class Tx { constructor(t) { this.data = String(t); this.nodeType = 3; } get textContent() { return this.data; } }
class Nd {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.kids = []; this.attrs = {}; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); }
  append(...k) { for (const x of k) this.kids.push(typeof x === 'string' ? new Tx(x) : x); }
  get textContent() { return this.kids.map((c) => c.textContent).join(' '); }
  set textContent(v) { this.kids = [new Tx(v)]; }
}
test('contador na tela: "Começa em", depois "Termina em" e "Encerrado", com dias, horas, minutos e segundos', async () => {
  const prev = globalThis.document;
  globalThis.document = { createElement: (t) => new Nd(t), createElementNS: (_, t) => new Nd(t), createTextNode: (t) => new Tx(t) };
  try {
    const PV = await import('../public/shared/tvcorp-previa.js');
    const now = Date.now();
    const at = now + ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000 + 500; // 2 dias, 3 h, 4 min e 5 s
    const n = PV.itemPreview({ kind: 'countdown', title: 'Liquidação', target: at, until: at + 3600_000, text: 'Só nesta semana' });
    const txt = () => n.textContent.replace(/\s+/g, ' ');
    assert.match(txt(), /Liquidação Começa em 2 dias 03 horas 04 min 05 seg Só nesta semana/);
    assert.equal(n.attrs['data-tvc-at'], String(at)); assert.equal(n.attrs['data-tvc-until'], String(at + 3600_000));
    PV.tickCountdowns(n, at + 1000);
    assert.match(txt(), /Termina em 0 dias 00 horas 59 min 59 seg/, 'depois de começar, conta para terminar');
    PV.tickCountdowns(n, at + 3600_000 + 1);
    assert.match(txt(), /Encerrado 0 dias 00 horas 00 min 00 seg/);
    PV.tickCountdowns(n, at - 86400_000 - 3600_000);
    assert.match(txt(), /Começa em 1 dia 01 hora 00 min 00 seg/, 'singular: 1 dia, 1 hora');
    const semFim = PV.itemPreview({ kind: 'countdown', title: 'SIPAT', target: '2099-01-01' });
    assert.match(semFim.textContent, /Começa em/);
    PV.tickCountdowns(semFim, new Date(2099, 0, 1, 10).getTime());
    assert.match(semFim.textContent, /É hoje!/, 'sem fim: no dia, "É hoje!"');
  } finally { globalThis.document = prev; }
});
