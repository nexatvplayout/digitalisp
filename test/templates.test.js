// DIGITAL ISP · a biblioteca de templates (docs/FUNCIONALIDADES.md §4, public/shared/templates-catalogo.js): são 5.000 ou
// mais; todo template passa na validação do servidor sem perder nada; não há texto em branco, sobra de modelo nem marca de
// terceiros; não há dois iguais; as cores do texto têm contraste de 4,5:1 com o fundo (lido do CSS da prévia); as artes
// existem; e a prévia desenha todos sem "undefined" na tela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = await import('../public/shared/templates-catalogo.js');
const K = await import('../server/tvcorp-core.js');
const { TVC_ART, TVC_PALETTES, TVC_SLIDE_MODEL } = await import('../public/shared/tvcorp-tipos.js');
const ALL = C.templateCatalog();
const STYLE = new Set(['palette', 'variant', 'art', 'orient', 'accent']);

test('o catálogo tem 5.000 templates ou mais, com ids únicos, em todos os segmentos e nos dois formatos', () => {
  assert.ok(ALL.length >= 5000, `só ${ALL.length}`);
  assert.equal(new Set(ALL.map((t) => t.id)).size, ALL.length, 'ids repetidos');
  const segs = new Set(ALL.map((t) => t.segment));
  for (const k of ['supermercado', 'padaria', 'acougue', 'farmacia', 'moda', 'calcados', 'otica', 'eletro', 'construcao', 'petshop', 'restaurante', 'lanchonete', 'pizzaria',
    'cafeteria', 'bar', 'sorveteria', 'delivery', 'clinica', 'consultorio', 'laboratorio', 'odontologia', 'hospital', 'veterinaria', 'academia', 'salao', 'barbearia', 'oficina',
    'lava-rapido', 'imobiliaria', 'escola', 'curso', 'banco', 'cartorio', 'seguranca-trabalho', 'metas', 'comunicacao-interna', 'rh', 'recepcao', 'hotelaria', 'igreja',
    'condominio', 'eventos', 'orgao-publico', 'provedor']) assert.ok(segs.has(k), `falta o segmento ${k}`);
  assert.equal(ALL.filter((t) => t.orient === 'port').length, ALL.length / 2, 'cada peça em paisagem e em retrato');
  for (const p of ['oferta', 'preco', 'combo', 'cardapio', 'boas-vindas', 'horario', 'promocao', 'datas', 'aviso', 'institucional', 'qr', 'redes']) assert.ok(ALL.some((t) => t.piece === p), `falta a peça ${p}`);
  // cada segmento usa várias cores e artes
  for (const s of segs) {
    const mine = ALL.filter((t) => t.segment === s);
    assert.ok(new Set(mine.map((t) => t.fields.palette)).size >= 3 && new Set(mine.map((t) => t.fields.art || '')).size >= 3, `${s}: pouca variação de cor e arte`);
  }
});

test('todo template passa na validação do servidor (cleanSlide) sem perder nem cortar nada', () => {
  for (const t of ALL) {
    assert.ok(TVC_SLIDE_MODEL[t.template], `${t.id}: modelo ${t.template}`);
    let out;
    try { out = K.cleanSlide(t.template, t.fields); } catch (e) { assert.fail(`${t.id}: ${e.message}`); }
    assert.deepEqual(out.fields, t.fields, `${t.id}: a validação mudou os campos`);
    assert.deepEqual(out.mediaIds, []);
  }
});

const BRANDS = /\b(instagram|facebook|whatsapp|tiktok|youtube|twitter|ifood|rappi|uber|99 ?pop|pix|coca|pepsi|guaran[aá] antarctica|catupiry|havaianas|nescau|nutella|ambev|brahma|skol|heineken|nike|adidas|samsung|lg|apple|iphone|netflix|google|mercado livre|shopee|amazon|magalu|itaú|bradesco|santander|caixa econ[oô]mica|banco do brasil|nubank|unimed|drogasil|raia|pague menos)\b/i;
test('sem texto em branco, sem sobra de modelo e sem marca de terceiros', () => {
  for (const t of ALL) {
    const model = TVC_SLIDE_MODEL[t.template];
    for (const fd of model.fields) if (fd.required) assert.ok(String(t.fields[fd.key] ?? '').trim(), `${t.id}: ${fd.key} vazio`);
    for (const [k, v] of Object.entries(t.fields)) {
      const s = String(v);
      assert.ok(s.trim() && s === s.trim(), `${t.id}: ${k} em branco ou com espaço sobrando`);
      assert.ok(!/undefined|null|NaN|\{|\}|\s\s/.test(s), `${t.id}: ${k} = "${s}"`);
      if (!STYLE.has(k) && k !== 'qr') assert.ok(!BRANDS.test(s), `${t.id}: marca de terceiros em ${k}: "${s}"`);
      for (const line of s.split('\n')) assert.ok(line.trim(), `${t.id}: ${k} com linha vazia`);
    }
    if (t.fields.qr) assert.match(t.fields.qr, /^https:\/\/exemplo\.com\.br\/[a-z0-9-]+\/[a-z0-9-]+$/, `${t.id}: endereço do QR`);
    if (t.fields.price) assert.match(t.fields.price, /^R\$ \d{1,3}(\.\d{3})*,\d{2}$/, `${t.id}: preço`);
    if (t.fields.oldPrice) {
      const n = (p) => Number(p.replace(/[R$ .]/g, '').replace(',', '.'));
      assert.ok(n(t.fields.oldPrice) > n(t.fields.price), `${t.id}: o "de" não é maior que o "por"`);
    }
  }
});

test('não há dois templates iguais: no mesmo segmento e formato, o texto de cada um é outro', () => {
  const seen = new Map();
  for (const t of ALL) {
    const content = Object.fromEntries(Object.entries(t.fields).filter(([k]) => !STYLE.has(k)));
    const key = `${t.segment}|${t.orient}|${t.template}|${JSON.stringify(content)}`;
    assert.ok(!seen.has(key), `${t.id} repete ${seen.get(key)}`);
    seen.set(key, t.id);
  }
  const whole = new Set(ALL.map((t) => `${t.template}|${JSON.stringify(t.fields)}`));
  assert.equal(whole.size, ALL.length, 'dois templates com os mesmos campos');
});

/* ------------------------------------------------------------------ contraste (WCAG 2.1) */
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const css = fs.readFileSync(path.join(root, 'public/shared/tvcorp-previa.css'), 'utf8');
/** As cores de cada tema, lidas do próprio CSS (o que a TV desenha). */
const PAL = Object.fromEntries([...css.matchAll(/\.th-([a-z]+) \{ --tc: (#[0-9a-f]{6}); --tcb: (#[0-9a-f]{6}); --tcl: (#[0-9a-f]{6}); \}/g)].map((m) => [m[1], { tc: m[2], tcb: m[3], tcl: m[4] }]));
/**
 * O ponto mais claro (arte escura) ou mais escuro (arte clara) de cada arte onde o texto pode cair, medido nos SVG de
 * public/tvcorp/arte. As fotos ficam sob um véu preto de 60% ou mais: o pior caso é um pixel branco sob o véu (#666666).
 * "ondas" fica de fora dos templates: as ondas claras embaixo não dão 4,5:1 com texto claro.
 */
const ART_SAMPLE = { geometrico: '#25334f', conquista: '#623c0a', evento: '#72284f', 'fim-de-ano': '#1f5a36', aniversario: '#7c2d92', seguranca: '#2b2716',
  listras: '#3c3429', pontos: '#1f2f3f', folhas: '#1a6130', circuito: '#1a5076', saude: '#9fe6c6', papel: '#fbe3b0' };
const PHOTO_WORST = '#666666';
const decl = (sel, prop) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*${prop}:\\s*(#[0-9a-f]{6})`).exec(css)?.[1];

test('cores: o CSS tem todas as paletas e o texto de cada template tem contraste de 4,5:1 ou mais', () => {
  assert.deepEqual(Object.keys(PAL).sort(), TVC_PALETTES.map((p) => p.key).sort(), 'paletas do CSS = TVC_PALETTES');
  for (const p of TVC_PALETTES) assert.equal(PAL[p.key].tc, p.hex, `${p.key}: a cor de destaque do CSS`);
  const darkFg = [decl('[class*="th-"]', '--tfg'), decl('[class*="th-"]', '--tdim')];
  const lightFg = [decl('[class*="th-"].th-light', '--tfg'), decl('[class*="th-"].th-light', '--tdim')];
  const artDarkFg = [decl('.tvc-sl.tvc-art-dark', '--tfg'), decl('.tvc-sl.tvc-art-dark', '--tdim')];
  const artLightFg = [decl('.tvc-sl.tvc-art-light', '--tfg'), decl('.tvc-sl.tvc-art-light', '--tdim')];
  const tbg = decl('[class*="th-"]', '--tbg');
  const badge = { bg: decl('.tvc-sl-price', 'background'), fg: decl('.tvc-sl-price', 'color') };
  for (const x of [...darkFg, ...lightFg, ...artDarkFg, ...artLightFg, tbg, badge.bg, badge.fg]) assert.ok(x, 'cor não encontrada no CSS');
  const worst = new Map();
  const check = (t, fg, bg, what) => { const r = ratio(fg, bg); if (r < (worst.get(what)?.r ?? 99)) worst.set(what, { r, id: t.id }); assert.ok(r >= 4.5, `${t.id}: ${what} ${fg} sobre ${bg} = ${r.toFixed(2)}:1`); };
  for (const t of ALL) {
    const f = t.fields; const p = PAL[f.palette];
    assert.ok(p, `${t.id}: paleta ${f.palette}`);
    if (f.art) {
      const a = TVC_ART[f.art];
      assert.ok(a, `${t.id}: arte ${f.art}`);
      const bg = a.photo ? PHOTO_WORST : ART_SAMPLE[f.art];
      assert.ok(bg, `${t.id}: a arte ${f.art} não tem a amostra de cor (não use nos templates sem medir)`);
      for (const fg of a.tone === 'light' ? artLightFg : artDarkFg) check(t, fg, bg, 'texto sobre a arte');
    } else if (f.variant === 'light') { for (const fg of lightFg) for (const bg of ['#ffffff', p.tcl]) check(t, fg, bg, 'texto no tema claro'); }
    else for (const fg of darkFg) for (const bg of [p.tcb, tbg]) check(t, fg, bg, 'texto no tema escuro');
    if (f.tag || ['seguranca', 'vaga'].includes(t.template)) check(t, '#ffffff', p.tc, 'etiqueta');
    if (f.price) { if (f.variant === 'light') check(t, '#ffffff', p.tcb, 'preço (claro)'); else check(t, badge.fg, badge.bg, 'preço'); }
  }
});

test('as artes usadas existem em public/tvcorp/arte e no CSS', () => {
  for (const key of new Set(ALL.map((t) => t.fields.art).filter(Boolean))) {
    const a = TVC_ART[key];
    const file = path.join(root, 'public/tvcorp/arte', `${key}.${a.photo ? 'jpg' : 'svg'}`);
    assert.ok(fs.existsSync(file), `falta ${file}`);
    assert.ok(css.includes(`.tvc-art-${key} {`), `falta a classe .tvc-art-${key} no CSS`);
    assert.ok(fs.statSync(file).size < 200 * 1024, `${key}: arquivo grande demais para a TV`);
  }
});

test('busca e filtros: sem acento, por segmento, peça e formato', () => {
  const r = C.filterTemplates(ALL, { q: 'pao frances', orient: 'land' });
  assert.ok(r.length && r.every((t) => t.orient === 'land' && /pão francês/i.test(JSON.stringify(t.fields))));
  assert.equal(C.filterTemplates(ALL, { segment: 'padaria', piece: 'oferta', orient: 'port' }).length, 5);
  assert.equal(C.filterTemplates(ALL, { group: 'corporativo' }).length, 640, '600 dos temas + 40 de uso interno com foto (20 × 2 formatos)');
  assert.equal(C.money(1079), 'R$ 1.079,00'); assert.equal(C.money(0.99), 'R$ 0,99'); assert.equal(C.money(18900), 'R$ 18.900,00');
  assert.equal(C.nextDate({ rule: 'pascoa' }, new Date(2026, 0, 1).getTime()), '2026-04-05');
  assert.equal(C.nextDate({ rule: 'maes' }, new Date(2026, 0, 1).getTime()), '2026-05-10');
  assert.equal(C.nextDate({ rule: 'pais' }, new Date(2026, 0, 1).getTime()), '2026-08-09');
  assert.equal(C.nextDate({ md: [12, 25] }, new Date(2026, 11, 26).getTime()), '2027-12-25');
});

/* ------------------------------------------------------------------ a prévia desenha todos */
class Tx { constructor(t) { this.data = String(t); this.nodeType = 3; } get textContent() { return this.data; } }
class Nd {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.kids = []; this.attrs = {}; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); }
  append(...k) { for (const x of k) this.kids.push(typeof x === 'string' ? new Tx(x) : x); }
  addEventListener() {}
  get textContent() { return this.kids.map((c) => c.textContent).join(' '); }
  all(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.kids) if (c.nodeType === 1) c.all(pred, out); return out; }
}
test('a prévia desenha cada template com o modelo, o formato e o texto, sem "undefined" na tela', async () => {
  const prev = globalThis.document;
  globalThis.document = { createElement: (t) => new Nd(t), createElementNS: (_, t) => new Nd(t), createTextNode: (t) => new Tx(t) };
  try {
    const PV = await import('../public/shared/tvcorp-previa.js');
    for (const t of ALL) {
      const n = PV.slidePreview(t.template, t.fields, { theme: { color: '#1d4ed8', mode: 'dark' } });
      const cls = n.className.split(' ');
      assert.ok(cls.includes(`tvc-sl-${t.template}`) && cls.includes(`th-${t.fields.palette}`), `${t.id}: ${n.className}`);
      assert.equal(cls.includes('tvc-port'), t.orient === 'port', `${t.id}: formato`);
      if (t.fields.art) assert.ok(cls.includes(`tvc-art-${t.fields.art}`) && cls.includes(`tvc-art-${TVC_ART[t.fields.art].tone}`), `${t.id}: arte`);
      if (t.fields.variant === 'light') assert.ok(cls.includes('th-light'), `${t.id}: tema claro`);
      const txt = n.textContent;
      assert.ok(!/undefined|null|NaN|\[object/.test(txt), `${t.id}: ${txt}`);
      assert.ok(txt.includes(t.fields.title), `${t.id}: título`);
      if (t.fields.price) assert.ok(txt.includes(t.fields.price), `${t.id}: preço`);
      if (t.fields.qr) assert.equal(n.all((x) => x.attrs.class === 'tvc-sl-qrc').length, 1, `${t.id}: QR code`);
    }
  } finally { globalThis.document = prev; }
});
