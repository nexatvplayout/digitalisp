// DIGITAL ISP · os gadgets da tela (aba Barras e blocos): clima e previsão, relógio digital e analógico, agenda e salas,
// avaliações, painel de indicadores, como chegar e página da internet. A validação do servidor, o tipo de item do contrato,
// a zona "Gadget" do layout e o desenho de cada um (sem "undefined" na tela; o relógio anda).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const D = await import('../server/tvcorp-dados.js');
const K = await import('../server/tvcorp-core.js');
const T = await import('../public/shared/tvcorp-tipos.js');

const ok = (kind, data) => D.cleanWidget(kind, { name: 'Teste', data }).data;
const bad = (kind, data, re) => assert.throws(() => D.cleanWidget(kind, { data }), re);

test('os tipos novos existem no catálogo, no contrato e na zona "Gadget" do layout', () => {
  for (const k of ['weather', 'clock', 'agenda', 'reviews', 'dashboard', 'directions', 'web']) {
    assert.ok(D.WIDGET_KINDS[k], `servidor: ${k}`);
    assert.ok(T.TVC_WIDGETS.some((w) => w.key === k), `catálogo: ${k}`);
    assert.ok(T.TVC_ITEM_KINDS.includes(k), `contrato: ${k}`);
  }
  assert.deepEqual(K.cleanZone({ id: 'g', kind: 'widget', x: 0, y: 0, w: 30, h: 30, widget: 9 }), { id: 'g', kind: 'widget', x: 0, y: 0, w: 30, h: 30, widget: 9 });
  assert.equal(K.cleanZone({ id: 'g', kind: 'widget', x: 0, y: 0, w: 30, h: 30, sample: 'reviews' }).sample, 'reviews', 'o tipo pedido pelo modelo fica (a TV recebe um gadget desse tipo)');
  assert.equal('sample' in K.cleanZone({ id: 'g', kind: 'widget', x: 0, y: 0, w: 30, h: 30, sample: '<x>' }), false);
});

test('validação: cada gadget guarda só o que serve e recusa o que não presta', () => {
  assert.deepEqual(ok('clock', { face: 'analog', tz: 'Europe/Lisbon', label: 'Lisboa' }), { face: 'analog', tz: 'Europe/Lisbon', label: 'Lisboa', showSeconds: true, date: true });
  assert.equal(ok('clock', { showSeconds: false }).showSeconds, false, 'showSeconds (não seconds: seconds é a duração na playlist)');
  assert.equal(ok('clock', {}).face, 'digital');
  bad('clock', { tz: 'Marte/Base' }, /fuso/);
  assert.deepEqual(ok('weather', { feedId: '3', days: 9 }), { feedId: 3, days: 4, title: '' });
  const ag = ok('agenda', { title: 'Sala 2', events: [{ date: '2027-01-05', time: '14:00', end: '15:00', title: 'Reunião de vendas', place: 'Sala 2' }, { date: '2027-01-02', title: 'Treinamento' }] });
  assert.deepEqual(ag.events.map((e) => e.date), ['2027-01-02', '2027-01-05'], 'em ordem de data');
  bad('agenda', { events: [{ date: '2027-01-05', time: '9h', title: 'Reunião' }] }, /HH:MM/);
  bad('agenda', { events: [{ title: 'Sem data' }] }, /data/);
  const rv = ok('reviews', { items: [{ name: 'Ana P.', stars: 9, text: 'Atendimento excelente!' }], qr: 'https://exemplo.com.br/avaliar' });
  assert.equal(rv.items[0].stars, 5); assert.match(rv.qr, /^https:\/\/exemplo\.com\.br\/avaliar\/?$/);
  bad('reviews', { items: [] }, /Avaliações/);
  bad('reviews', { items: [{ text: 'Ótimo' }], qr: 'http://inseguro.exemplo' }, /https/);
  assert.deepEqual(ok('dashboard', { kpis: [1, '2', 2] }).kpis, [1, 2]);
  bad('dashboard', { kpis: [1, 2, 3, 4, 5, 6, 7] }, /1 a 6/);
  assert.equal(ok('directions', { address: 'Rua das Flores, 100 - Centro' }).title, 'Como chegar');
  bad('directions', { address: '' }, /endereço/);
  assert.equal(ok('web', { url: 'https://exemplo.com.br/painel', refreshMin: 2 }).refreshMin, 5, 'recarregar: no mínimo 5 min');
  assert.equal(ok('web', { url: 'https://exemplo.com.br/painel' }).refreshMin, 0);
  bad('web', { url: 'http://exemplo.com.br' }, /https/);
});

/* ------------------------------------------------------------------ o desenho */
class Tx { constructor(t) { this.data = String(t); this.nodeType = 3; } get textContent() { return this.data; } }
class Nd {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.kids = []; this.attrs = {}; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); }
  append(...k) { for (const x of k) this.kids.push(typeof x === 'string' ? new Tx(x) : x); }
  get textContent() { return this.kids.map((c) => c.textContent).join(' '); }
  set textContent(v) { this.kids = [new Tx(v)]; }
  all(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.kids) if (c.nodeType === 1) c.all(pred, out); return out; }
}
test('desenho: cada gadget aparece com o seu conteúdo, sem "undefined", e o relógio anda', async () => {
  const prev = globalThis.document;
  globalThis.document = { createElement: (t) => new Nd(t), createElementNS: (_, t) => new Nd(t), createTextNode: (t) => new Tx(t) };
  try {
    const PV = await import('../public/shared/tvcorp-previa.js');
    const items = {
      weather: { kind: 'weather', city: 'Recife', uf: 'PE', tempC: 29.4, text: 'Sol entre nuvens', days: [{ weekday: 'seg', min: 24, max: 31, text: 'Sol' }], source: 'INMET' },
      clock: { kind: 'clock', face: 'digital', tz: 'America/Sao_Paulo', label: 'Brasília' },
      agenda: { kind: 'agenda', title: 'Sala 2', today: '2027-01-02', events: [{ date: '2027-01-02', time: '09:00', end: '10:00', title: 'Reunião geral', place: 'Auditório' }, { date: '2027-01-05', title: 'Treinamento' }] },
      reviews: { kind: 'reviews', title: 'Clientes', items: [{ name: 'Ana P.', stars: 4, text: 'Muito bom!' }], qr: 'https://exemplo.com.br/avaliar' },
      dashboard: { kind: 'dashboard', title: 'Resultados', items: [{ name: 'Vendas', value: 112, target: 100, unit: '%', band: 'ok' }, { name: 'Entregas', value: 95, target: 98, unit: '%', band: 'warn' }] },
      directions: { kind: 'directions', title: 'Como chegar', address: 'Rua das Flores, 100', reference: 'Em frente à praça', qr: 'https://exemplo.com.br/mapa' },
      web: { kind: 'web', url: 'https://exemplo.com.br/painel', refreshMin: 10 },
    };
    const want = { weather: /Recife · PE 29° Sol entre nuvens seg 24° \/ 31°/, clock: /Brasília \d\d:\d\d:\d\d/, agenda: /Hoje 09:00–10:00 Reunião geral Auditório 05\/01 Treinamento/,
      reviews: /★★★★ Muito bom! Ana P\./, dashboard: /Vendas 112 % Meta: 100 %/, directions: /Rua das Flores, 100 Em frente à praça/, web: /exemplo\.com\.br\/painel Recarrega a cada 10 min/ };
    for (const [k, it] of Object.entries(items)) {
      const n = PV.itemPreview(it, { theme: { color: '#1d4ed8', mode: 'dark' } });
      const txt = n.textContent.replace(/\s+/g, ' ');
      assert.ok(!/undefined|null|NaN|\[object/.test(txt), `${k}: ${txt}`);
      assert.match(txt, want[k], k);
    }
    // relógio analógico: os ponteiros giram pela hora do fuso
    const an = PV.itemPreview({ kind: 'clock', face: 'analog', tz: 'UTC', date: false, seconds: 30 });
    PV.tickWidgets(an, Date.UTC(2027, 0, 1, 3, 15, 30));
    const rot = (cls) => an.all((x) => x.attrs.class === cls)[0].attrs.transform;
    assert.equal(rot('tvc-clk-h'), 'rotate(97.5 50 50)'); assert.equal(rot('tvc-clk-m'), 'rotate(93 50 50)'); assert.equal(rot('tvc-clk-s'), 'rotate(180 50 50)');
    assert.ok(an.className.includes('tvc-tick'));
    assert.equal(PV.itemPreview(items.web).attrs['data-url'], 'https://exemplo.com.br/painel');
  } finally { globalThis.document = prev; }
});

test('página: o servidor descobre se o site aceita ser aberto dentro de outro (X-Frame-Options e CSP frame-ancestors)', async () => {
  assert.equal(D.embeddableFrom({}), true);
  assert.equal(D.embeddableFrom({ 'X-Frame-Options': 'DENY' }), false);
  assert.equal(D.embeddableFrom({ 'x-frame-options': 'SAMEORIGIN' }), false);
  assert.equal(D.embeddableFrom({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self' https://exemplo.com.br" }), false);
  assert.equal(D.embeddableFrom({ 'content-security-policy': "frame-ancestors 'none'" }), false);
  assert.equal(D.embeddableFrom({ 'content-security-policy': 'frame-ancestors *' }), true);
  assert.equal(D.embeddableFrom({ 'content-security-policy': "default-src 'self'" }), true, 'sem frame-ancestors: aceita');
  // HEAD recusado: tenta o GET; site fora do ar: não se sabe (null); prazo curto e no máximo 2 redirecionamentos
  const calls = [];
  const fake = (res) => async (url, o) => { calls.push([o.method, o.timeout, o.redirects]); if (typeof res === 'function') return res(o); return res; };
  assert.equal(await D.checkEmbeddable('https://exemplo.com.br', fake((o) => (o.method === 'HEAD' ? { status: 405, headers: {} } : { status: 200, headers: { 'x-frame-options': 'DENY' } }))), false);
  assert.deepEqual(calls, [['HEAD', 4000, 2], ['GET', 4000, 2]]);
  assert.equal(await D.checkEmbeddable('https://exemplo.com.br', fake(() => { throw new Error('fora do ar'); })), null);
  assert.equal(await D.checkEmbeddable('https://exemplo.com.br', fake({ status: 200, headers: {} })), true);
});

test('relógio digital sem os segundos quando showSeconds é false (o seconds do item é a duração e não interfere)', async () => {
  const prev = globalThis.document;
  globalThis.document = { createElement: (t) => new Nd(t), createElementNS: (_, t) => new Nd(t), createTextNode: (t) => new Tx(t) };
  try {
    const PV = await import('../public/shared/tvcorp-previa.js');
    const sem = PV.itemPreview({ kind: 'clock', face: 'digital', tz: 'UTC', showSeconds: false, seconds: 300, date: false });
    PV.tickWidgets(sem, Date.UTC(2027, 0, 1, 3, 15, 30));
    assert.equal(sem.textContent.trim(), '03:15');
    const com = PV.itemPreview({ kind: 'clock', face: 'digital', tz: 'UTC', seconds: 12, date: false });
    PV.tickWidgets(com, Date.UTC(2027, 0, 1, 3, 15, 30));
    assert.equal(com.textContent.trim(), '03:15:30', 'sem o campo: mostra os segundos');
    const bloq = PV.itemPreview({ kind: 'web', url: 'https://exemplo.com.br', embeddable: false });
    assert.equal(bloq.attrs['data-embeddable'], 'false'); assert.match(bloq.textContent, /não deixa ser aberto dentro de outro/);
  } finally { globalThis.document = prev; }
});
