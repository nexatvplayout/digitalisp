// Painel "TV Corporativa" (docs/TV-CORPORATIVA.md §6, pacote C): o código do painel escreve só por textContent, sem estilo
// pelo script e sem endereço de fora; as abas saem pela permissão; o catálogo provisório confere com o contrato; e cada
// aba abre num DOM mínimo, com os dados de exemplo e com o servidor respondendo vazio, sem "null"/"undefined" na tela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const VIEWS = fs.readdirSync(path.join(root, 'public/admin/views')).filter((f) => /^tvcorp(-[a-z]+)?\.js$/.test(f)).map((f) => `public/admin/views/${f}`);
const SHARED = ['public/shared/tvcorp-previa.js', 'public/shared/pagina.js'];

/* ------------------------------------------------------------------ DOM mínimo */
class Text { constructor(t) { this.data = String(t); this.nodeType = 3; this.parentNode = null; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } remove() { this.parentNode?._drop(this); } }
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.nodeType = 1; this.childNodes = []; this.attrs = {}; this.className = ''; this.listeners = {}; this.parentNode = null; this.dataset = {}; this.hidden = false; this.value = ''; this.checked = false; this.disabled = false; this.files = null; this.open = false; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get classList() { const n = this; const list = () => n.className.split(/\s+/).filter(Boolean); return { add: (...c) => { n.className = [...new Set([...list(), ...c])].join(' '); }, remove: (...c) => { n.className = list().filter((x) => !c.includes(x)).join(' '); }, toggle: (c, on) => { const has = list().includes(c); const want = on === undefined ? !has : Boolean(on); if (want && !has) n.className = [...list(), c].join(' '); if (!want && has) n.className = list().filter((x) => x !== c).join(' '); return want; }, contains: (c) => list().includes(c) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); if (k === 'value') this.value = String(v); if (k === 'checked') this.checked = true; if (k === 'hidden') this.hidden = true; if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(t, ev = {}) { for (const fn of this.listeners[t] || []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...ev }); }
  _adopt(k) { const n = typeof k === 'string' ? new Text(k) : k; n.parentNode?._drop?.(n); n.parentNode = this; return n; }
  _drop(n) { this.childNodes = this.childNodes.filter((c) => c !== n); n.parentNode = null; }
  append(...k) { for (const x of k) this.childNodes.push(this._adopt(x)); }
  prepend(...k) { this.childNodes.unshift(...k.map((x) => this._adopt(x))); }
  replaceChildren(...k) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this.append(...k); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; const i = p.childNodes.indexOf(this); p.childNodes[i] = p._adopt(n); this.parentNode = null; }
  remove() { this.parentNode?._drop(this); }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === globalThis.document?.body; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(' '); }
  set textContent(v) { this.replaceChildren(new Text(v)); }
  showModal() { this.open = true; } close() { this.open = false; } focus() {} click() { this.dispatch('click'); }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 160, height: 90 }; }
  closest() { return null; }
  all(pred) { const out = []; const walk = (n) => { if (n.nodeType === 1) { if (pred(n)) out.push(n); n.childNodes.forEach(walk); } }; walk(this); return out; }
  byClass(c) { return this.all((n) => n.className.split(/\s+/).includes(c)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) { if (sel.startsWith('#')) return this.all((n) => n.attrs.id === sel.slice(1)); if (/^\.[a-z0-9-]+$/i.test(sel)) return this.byClass(sel.slice(1)); return []; }
}
const body = new El('body');
const toasts = new El('div'); toasts.setAttribute('id', 'toasts'); body.append(toasts);
globalThis.document = {
  body, hidden: false, activeElement: null,
  createElement: (t) => new El(t), createElementNS: (_, t) => new El(t), createTextNode: (t) => new Text(t),
  querySelector: (s) => body.querySelector(s), querySelectorAll: (s) => body.querySelectorAll(s),
  addEventListener() {}, removeEventListener() {},
};
globalThis.window = globalThis;
globalThis.location = { hash: '', origin: 'http://localhost:3000' };
globalThis.dispatchEvent = () => true;
globalThis.confirm = () => true; globalThis.prompt = () => ''; globalThis.print = () => {};
URL.createObjectURL = () => 'blob:teste'; URL.revokeObjectURL = () => {};
const memory = new Map();
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };

const lib = await import('../public/admin/lib.js');
const view = (await import('../public/admin/views/tvcorp.js')).default;
const { TABS, tabsFor, normalize } = await import('../public/admin/views/tvcorp.js');
const base = await import('../public/admin/views/tvcorp-base.js');
const C = await import('../public/admin/views/tvcorp-catalogo.js');
const PV = await import('../public/shared/tvcorp-previa.js');
const G = await import('../public/admin/views/tvcorp-grade.js');
const L = await import('../public/admin/views/tvcorp-layouts.js');
const RH = await import('../public/admin/views/tvcorp-rh.js');
const EX = await import('../public/admin/views/tvcorp-exemplo.js');
const PG = await import('../public/admin/views/tvcorp-pagina.js');
const PGS = await import('../public/shared/pagina.js');

const panel = new El('section'); panel.setAttribute('id', 'tcPanel');
const sec = new El('section'); sec.setAttribute('id', 'view-tvcorp'); sec.append(panel); body.append(sec);
lib.state.me = { permissions: ['tvcorp.manage'], planFeatures: { tvcorp: true } };
const BAD = /\bnull\b|\bundefined\b|\bNaN\b|\[object |Infinity|Invalid Date/;

test('código do painel: só textContent, sem estilo pelo script, sem script nem endereço de fora', () => {
  assert.ok(VIEWS.length >= 20, `os arquivos do painel (${VIEWS.length})`);
  for (const f of [...VIEWS, ...SHARED]) {
    const src = read(f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src), `${f}: texto só por textContent`);
    assert.ok(!/\.style\b|setAttribute\('style'|\bstyle: [`'"]/.test(src), `${f}: nenhum estilo pelo script`);
    assert.ok(!/<script|createElement\(['"]script|import\(['"]https?:|from ['"]https?:/.test(src), `${f}: nenhum script de fora`);
    assert.ok(!/https?:\/\/(?!…)[a-z]/i.test(src.replace(/'http:\/\/www\.w3\.org\/2000\/svg'/g, '').replace(/https:\/\/[a-z.]*exemplo\.com\.br[^'"`]*/g, '')), `${f}: nenhum endereço de fora`);
    assert.ok(!/xplayout|playbox|harmonic/i.test(src), `${f}: nenhum concorrente`);
  }
  const css = read('public/admin/tvcorp.css') + read('public/shared/tvcorp-previa.css');
  assert.ok(!/https?:\/\//.test(css), 'o CSS não busca nada de fora');
  // a captura e os arquivos abrem com a sessão no cabeçalho, nunca com o token no endereço
  assert.match(read('public/admin/views/tvcorp-base.js'), /'x-admin-token': state\.token/);
  assert.ok(!VIEWS.some((f) => /\?token=|&token=/.test(read(f))));
  // as rotas da rede saem por /api/tvcorp/rede, nunca pelas da prefeitura
  for (const f of VIEWS) assert.ok(!/\/api\/prefeitura/.test(read(f)), `${f}: não fala com /api/prefeitura`);
  // as artes de fundo existem e são só desenho (sem texto, sem imagem de fora)
  for (const a of C.ARTS.filter((x) => !x.photo)) { const svg = read(`public/tvcorp/arte/${a.key}.svg`); assert.match(svg, /^<svg /); assert.ok(!/<text|<image|<script|href=/.test(svg), a.key); }
  // as fotos próprias (geradas para o DIGITAL ISP): JPEG de verdade e leve
  for (const a of C.ARTS.filter((x) => x.photo)) { const b = fs.readFileSync(path.join(root, `public/tvcorp/arte/${a.key}.jpg`)); assert.ok(b[0] === 0xff && b[1] === 0xd8 && b.length < 200 * 1024, a.key); }
});

test('abas: todas as da §6, pela permissão tvcorp.manage', () => {
  const ids = TABS.map((t) => t.id);
  assert.deepEqual(ids, ['resumo', 'telas', 'unidades', 'midias', 'templates', 'qrcodes', 'aovivo', 'playlists', 'layouts', 'grade', 'dados', 'indicadores', 'rh', 'barras', 'alertas', 'aprovacoes', 'celular', 'relatorios', 'comandos', 'instalar', 'config']);
  assert.equal(tabsFor(() => false).length, 0, 'sem a permissão, nenhuma aba');
  assert.equal(tabsFor((p) => p === 'tvcorp.manage').length, TABS.length);
  assert.ok(TABS.every((t) => typeof t.paint === 'function' && t.perm === 'tvcorp.manage'));
  for (const id of ids.filter((x) => !['alertas', 'aprovacoes'].includes(x))) assert.ok(fs.existsSync(path.join(root, `public/admin/views/tvcorp-${id}.js`)), `views/tvcorp-${id}.js`);
});

test('catálogo: os modelos de layout passam na conferência do contrato; nome curto, dias, faixa do indicador', () => {
  for (const l of C.FACTORY_LAYOUTS) assert.equal(C.checkZones(l.zones), null, l.key);
  assert.equal(C.FACTORY_LAYOUTS.length, 216); assert.equal(C.FACTORY_SETS.length, 5); assert.equal(C.SLIDE_TEMPLATES.length, 17);
  assert.match(C.checkZones([{ id: 'a', kind: 'video', x: 0, y: 0, w: 50, h: 50 }, { id: 'b', kind: 'video', x: 50, y: 0, w: 50, h: 50 }]), /uma zona de vídeo/);
  assert.match(C.checkZones([{ id: 'a', kind: 'playlist', x: 60, y: 0, w: 50, h: 50 }]), /passa da borda/);
  assert.match(C.checkZones(Array.from({ length: 7 }, (_, i) => ({ id: `z${i}`, kind: 'clock', x: 0, y: 0, w: 10, h: 10 }))), /No máximo 6/);
  assert.equal(C.shortName('Ana Souza Lima'), 'Ana L.'); assert.equal(C.shortName('Ana'), 'Ana');
  assert.equal(C.daysText(''), 'todo dia'); assert.equal(C.daysText('0,1,5'), 'seg, sex, dom');
  assert.equal(C.hmToMin('07:30'), 450); assert.equal(C.minToHm(450), '07:30'); assert.equal(C.minToHm(null), '');
  assert.equal(C.kpiBand({ value: 100, target: 100 }), 'ok'); assert.equal(C.kpiBand({ value: 85, target: 100 }), 'warn'); assert.equal(C.kpiBand({ value: 50, target: 100 }), 'bad');
  assert.equal(C.kpiBand({ value: 1.8, target: 2, direction: 'down' }), 'ok'); assert.equal(C.kpiBand({ value: 3, target: 2, direction: 'down' }), 'bad');
  assert.equal(RH.yearsOfHouse('2019-03-11', new Date(2026, 10, 20).getTime()), 7);
});

test('grade: a faixa que vira a noite continua no dia seguinte; as que se cruzam ficam lado a lado', () => {
  assert.deepEqual(G.segmentsOf({ days: '5', timeFrom: 1320, timeTo: 360 }), [{ day: 5, from: 1320, to: 1440 }, { day: 6, from: 0, to: 360 }]);
  assert.equal(G.segmentsOf({ days: '', timeFrom: null, timeTo: null }).length, 7, 'sem dias e sem horário: a semana toda');
  const out = G.lanes([{ days: '1', timeFrom: 420, timeTo: 1080, priority: 1 }, { days: '1', timeFrom: 600, timeTo: 700, priority: 9 }, { days: '1', timeFrom: 1100, timeTo: 1200, priority: 1 }]);
  assert.deepEqual(out.map((g) => [g.lane, g.lanes]), [[0, 2], [1, 2], [0, 2]]);
});

test('prévia: o layout por zonas (posição só por atributo do SVG) e os itens no formato que o app lê', () => {
  const lay = PV.layoutPreview(C.FACTORY_LAYOUT['video-lateral-barra'], { labels: true, ticker: ['Aviso um'], items: { right: { kind: 'kpi', name: 'Produção', value: 82, target: 100, unit: '%', band: 'warn' } } });
  const fos = lay.all((n) => n.tagName === 'FOREIGNOBJECT');
  assert.equal(fos.length, 3);
  assert.deepEqual(fos.map((n) => [n.attrs.x, n.attrs.width]), [['0.00', '120.00'], ['120.00', '40.00'], ['0.00', '160.00']]);
  assert.ok(lay.textContent.includes('Aviso um') && lay.textContent.includes('Produção') && lay.textContent.includes('AO VIVO'));
  assert.equal(PV.layoutPreview(C.FACTORY_LAYOUT.totem).byClass('tvc-svg')[0].attrs.viewBox, '0 0 90 160', 'em pé: 9:16');
  const kinds = {
    image: { url: 'blob:x', caption: 'Legenda' }, post: { category: 'vaga', title: 'Vaga', body: 'Texto do post', qr: 'https://a.b/c' },
    birthdays: { title: 'Aniversariantes', people: [{ name: 'Ana S.', day: 20, month: 11, sector: 'RH' }] },
    kpi: { name: 'K', value: 1, target: 2, unit: '%', band: 'bad', direction: 'up' }, news: { source: 'Agência Brasil', items: [{ title: 'Manchete', source: 'Agência Brasil', at: Date.now() }] },
    quotes: { items: [{ label: 'Dólar', value: 5.1234, change: -0.4, prefix: 'R$', decimals: 4 }], at: Date.now(), source: 'BC' },
    menu: { title: 'Cardápio', day: 'seg', items: [{ name: 'Arroz', price: 12.5 }, 'Feijão'] }, countdown: { title: 'SIPAT', target: '2099-01-01', text: 'no auditório' },
    safety: { since: '2026-01-01', record: 400, goal: 365 }, worldclock: { clocks: [{ label: 'Lisboa', tz: 'Europe/Lisbon' }] }, text: { title: 'Aviso', text: 'Texto fixo' },
  };
  for (const [kind, it] of Object.entries(kinds)) { const n = PV.itemPreview({ kind, ...it }); assert.ok(!BAD.test(n.textContent), `${kind}: ${n.textContent}`); }
  assert.ok(PV.itemPreview({ kind: 'quotes', ...kinds.quotes }).textContent.includes('5,1234'), 'as casas decimais da cotação');
  assert.ok(PV.itemPreview({ kind: 'menu', ...kinds.menu }).textContent.includes('Arroz · R$ 12,5'));
  assert.ok(PV.itemPreview({ kind: 'post', ...kinds.post }).textContent.includes('Texto do post'), 'post.body');
  for (const t of C.SLIDE_TEMPLATES) { const n = PV.slidePreview(t.key, t.sample); assert.ok(n.className.includes(`tvc-sl-${t.key}`) && !BAD.test(n.textContent), t.key); }
  assert.ok(PV.slidePreview('comunicado', { title: 'x', art: 'ondas' }).className.includes('tvc-art-ondas'));
  assert.ok(!PV.slidePreview('comunicado', { title: 'x', art: 'a b"' }).className.includes('tvc-art'), 'arte desconhecida não vira classe');
});

test('editor de layout: arrastar a zona e o canto muda a posição e o tamanho em % inteiros, sem sair da tela', () => {
  const st = { orientation: 'land', zones: C.FACTORY_LAYOUT['video-lateral'].zones.map((z) => ({ ...z })), sel: 0 };
  const changes = [];
  const cv = L.zoneCanvas(st, (w) => changes.push(w));
  const hit = (i, m) => cv.node.all((n) => n.attrs['data-i'] === String(i) && n.attrs['data-m'] === m)[0];
  // a lateral (zona 1): arrastar 16 px num quadro de 160 px = 10% para a esquerda
  cv.node.dispatch('pointerdown', { target: hit(1, 'move'), clientX: 100, clientY: 10, pointerId: 1 });
  cv.node.dispatch('pointermove', { clientX: 84, clientY: 10 });
  cv.node.dispatch('pointerup', {});
  assert.deepEqual([st.zones[1].x, st.zones[1].w], [65, 25]);
  // passar da borda trava no limite
  cv.node.dispatch('pointerdown', { target: hit(1, 'move'), clientX: 0, clientY: 0, pointerId: 1 });
  cv.node.dispatch('pointermove', { clientX: 500, clientY: 500 }); cv.node.dispatch('pointerup', {});
  assert.deepEqual([st.zones[1].x, st.zones[1].y], [75, 0]);
  // o canto do vídeo: menos 16 px de largura = 10% a menos
  cv.node.dispatch('pointerdown', { target: hit(0, 'size'), clientX: 100, clientY: 80, pointerId: 1 });
  cv.node.dispatch('pointermove', { clientX: 84, clientY: 80 }); cv.node.dispatch('pointerup', {});
  assert.equal(st.zones[0].w, 65);
  assert.equal(C.checkZones(st.zones), null);
  assert.ok(changes.includes('move'));
});

async function renderAll(label) {
  for (const t of TABS) {
    await view.load(t.id);
    const txt = panel.textContent;
    assert.ok(!/Não deu para abrir esta aba/.test(txt), `${label} · ${t.id}: ${txt.slice(txt.indexOf('Não deu'), txt.indexOf('Não deu') + 200)}`);
    assert.ok(!BAD.test(txt), `${label} · ${t.id}: "${txt.match(BAD)?.[0]}" em ${txt.slice(Math.max(0, txt.search(BAD) - 80), txt.search(BAD) + 40)}`);
    assert.ok(panel.byClass('cg-tab').length === TABS.length, `${label} · ${t.id}: as abas`);
    const out = panel.byClass('tc-box')[0]?.children[0];
    assert.ok(out && out.children.length > 0 && out.textContent.length > 60 && !/Carregando…/.test(out.textContent), `${label} · ${t.id}: a aba desenhou (${out?.textContent.slice(0, 80)})`);
    view.leave();
  }
}

test('cada aba abre com os dados de exemplo, sem nada escrito errado', async () => {
  base.setDemo(true);
  await renderAll('exemplo');
  assert.ok(panel.textContent.includes('Dados de exemplo'), 'o aviso do modo de exemplo');
  // as janelas principais também abrem (o editor de layout, a partir do modelo)
  L.layoutEditor(null, async () => {}, 'recepcao');
  const dlg = body.children.filter((n) => n.tagName === 'DIALOG').pop();
  assert.ok(dlg && dlg.open && dlg.byClass('tc-zedit').length === 1 && dlg.byClass('tc-zr').length === 3, 'o quadro com as 3 zonas da recepção');
  assert.ok(!BAD.test(dlg.textContent));
  dlg.remove();
  // o construtor de páginas abre com cada modelo pronto, sem nada escrito errado, e mostra os controles de formatação
  for (const p of PGS.PAGE_PRESETS) {
    const { dlg: d, st } = PG.pageBuilder(null, [{ id: 5, kind: 'image', title: 'Foto' }], async () => {}, { preset: p.key });
    assert.ok(d.open && d.all((n) => n.tagName === 'CANVAS').length === 1, p.key);
    assert.ok(!BAD.test(d.textContent), `${p.key}: ${d.textContent.match(BAD)?.[0]}`);
    assert.equal(st.page.orient, p.page().orient);
    d.remove();
  }
  const { dlg: pd } = PG.pageBuilder({ id: 9, kind: 'image', title: 'Aviso', seconds: 10, officeId: null, fields: { page: PGS.PAGE_PRESET.aviso.page() } }, [], async () => {});
  assert.match(pd.textContent, /Página · Aviso/);
  for (const t of ['Negrito', 'Itálico', 'Sublinhado', 'Fonte', 'Espaço entre linhas', 'Fundo do texto', 'Cor da letra']) assert.ok(pd.all((n) => n.attrs['aria-label'] === t).length, t);
  pd.remove();
  base.setDemo(false);
});

test('cada aba abre com o servidor respondendo vazio (estados vazios claros) e, sem o módulo, oferece o exemplo', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), blob: async () => ({}) });
  try {
    await renderAll('vazio');
    await view.load('resumo');
    assert.match(panel.textContent, /Comece pela primeira tela/);
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'Não encontrado' }) });
    await view.load('resumo');
    assert.match(panel.textContent, /ainda não está disponível neste servidor/);
    assert.match(panel.textContent, /Ver com dados de exemplo/);
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'fora do plano', code: 'feature_unavailable' }) });
    await view.load('resumo');
    assert.match(panel.textContent, /não está no plano desta organização/);
    view.leave();
  } finally { globalThis.fetch = realFetch; }
});

test('normalize: junta o conteúdo e a rede, listas vazias no que falta', () => {
  const n = normalize({ layouts: [{ id: 1 }] }, { offices: [{ id: 2 }], devices: [] });
  assert.deepEqual([n.layouts.length, n.offices.length, n.playlists.length, n.rede], [1, 1, 0, true]);
  assert.equal(normalize({}, null).rede, false);
  const S = EX.sample();
  assert.ok(S.main.devices.length === 7 && S.main.offices.length === 4);
  assert.ok(S.widgets.every((w) => w.data), 'os widgets de exemplo no formato do contrato');
});
