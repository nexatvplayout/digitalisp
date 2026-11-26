// DIGITAL ISP · a seção "Layouts de demonstração" no fim da aba Layouts (só nas contas ligadas: /api/me demoLayouts).
// Um clique cria tudo pelas rotas de sempre: os slides premium com foto (aba Mídias), uma playlist por zona, o canal ao
// vivo (o primeiro da conta; sem nenhum, o canal público de teste) e o layout com a playlist e o canal já escolhidos.
// Os prontos: public/shared/tvcorp-demos.js.
import { el, guard, toast, tapi, put, note, btn, btns, chip, label } from './tvcorp-base.js';
import { layoutPreview } from '../../shared/tvcorp-previa.js';
import { templateCatalog } from '../../shared/templates-catalogo.js';
import { DEMO_LAYOUTS, DEMO_SEGMENTS, demoZones, demoItens, DEMO_CHANNEL } from '../../shared/tvcorp-demos.js';
import { themeOf } from './tvcorp-midias.js';
import { slideOrientOf } from '../../shared/tvcorp-tipos.js';
import { abrirPreviaViva } from './tvcorp-previa-viva.js';

const SEG = Object.fromEntries(DEMO_SEGMENTS);
/** Os slides de cada zona: os prontos premium e as frases do negócio (deitados: a TV ajusta o formato pela zona). */
const itensDe = (d) => {
  // o formato de cada slide é o da zona, como a TV recebe (slideOrientOf: zona quase quadrada ou alta = em pé)
  const it = demoItens(d, templateCatalog());
  for (const z of d.zones) if (it[z.id]) { const orient = slideOrientOf(z, d.orientation); it[z.id] = it[z.id].map((t) => ({ ...t, fields: { ...t.fields, orient } })); }
  return it;
};
const WEATHER = { now: { temp: 27, cond: 'partly', text: 'Parcialmente nublado' } };
/** A prévia do pronto: o primeiro slide de cada playlist, as frases, o QR code, o relógio e o clima de exemplo. */
function demoPreview(d) {
  const items = Object.fromEntries(Object.entries(itensDe(d)).map(([zid, l]) => (l[0] ? [zid, { kind: 'slide', template: l[0].template, fields: l[0].fields }] : null)).filter(Boolean));
  const q = d.zones.find((z) => z.kind === 'qr');
  return layoutPreview({ ...d, name: d.label, zones: d.zones }, { theme: { ...themeOf(), mode: 'dark' }, labels: false, items, weather: WEATHER, qr: q?.qr || null, qrLabel: q?.title || null, channel: 'Canal ao vivo' });
}

/** Cria os slides, as playlists, o canal (se faltar) e o layout. Devolve o layout criado. */
export async function usarDemo(d) {
  let canal = null;
  if (d.video) {
    const lista = await tapi('/api/hls').catch(() => []);
    canal = (Array.isArray(lista) ? lista : []).find((c) => c.ativo) || await tapi('/api/hls', { method: 'POST', body: DEMO_CHANNEL });
  }
  const pls = {};
  const itens = itensDe(d);
  for (const z of d.zones.filter((x) => x.pl)) {
    const ids = [];
    for (const t of itens[z.id] || []) {
      const m = await tapi('/api/tvcorp/media', { method: 'POST', body: { kind: 'slide', title: t.name, template: t.template, fields: t.fields, seconds: 10 } });
      ids.push(m.id);
    }
    const p = await tapi('/api/tvcorp/playlists', { method: 'POST', body: { name: `Demo · ${d.label}${d.zones.filter((x) => x.pl).length > 1 ? ` · ${z.id}` : ''}`.slice(0, 60) } });
    await tapi(`/api/tvcorp/playlists/${p.id}/items`, { method: 'PUT', body: { items: ids.map((refId) => ({ refKind: 'media', refId, params: {}, seconds: 10, days: '', timeFrom: null, timeTo: null, validFrom: null, validTo: null })) } });
    pls[z.id] = p.id;
  }
  return tapi('/api/tvcorp/layouts', { method: 'POST', body: { name: d.label, orientation: d.orientation, background: d.background, zones: demoZones(d, (id) => pls[id], canal?.id ?? null) } });
}

/** A seção inteira, com o filtro por segmento. */
export function demosView(reload) {
  const box = el('div', { class: 'tc-demos' });
  let seg = '';
  const filtro = el('div', { class: 'tc-demo-segs', role: 'group', 'aria-label': 'Segmento' });
  const grid = el('div', { class: 'tc-lgrid' });
  const card = (d) => {
    const usar = btn('Usar esta demonstração', guard(async (e) => {
      const b = e?.currentTarget; if (b) { b.disabled = true; b.textContent = 'Criando…'; }
      try {
        const l = await usarDemo(d);
        toast(`Pronto: o layout "${l?.name || d.label}" foi criado com as playlists${d.video ? ' e o canal ao vivo' : ''}. Escolha-o na tela (Telas → O que passa nesta tela)${d.senha ? '; a senha aparece nas telas de unidade com a chamada de senha ligada' : ''}.`);
        await reload?.();
      } finally { if (b) { b.disabled = false; b.textContent = 'Usar esta demonstração'; } }
    }), 'small primary');
    return el('div', { class: 'tc-lcard' },
      el('div', { class: 'tc-demo-pv', role: 'button', tabindex: '0', title: 'Ver em tamanho grande', onclick: () => abrirPreviaViva({ ...d, name: d.label, zones: d.zones.map(({ pl, ...z }) => z) }, { titulo: `Demonstração · ${d.label}`, zoneItems: Object.fromEntries(Object.entries(itensDe(d)).map(([zid, l]) => [zid, l.map((t) => ({ id: t.id, kind: 'slide', seconds: 10, template: t.template, fields: t.fields }))])) }) }, demoPreview(d)),
      el('div', { class: 'tc-lcard-b' },
        el('div', {}, chip('Demonstração', 'tc-tvs'), ' ', chip(SEG[d.segment] || d.segment), d.video ? ' ' : null, d.video ? chip('Vídeo ao vivo') : null, d.senha ? ' ' : null, d.senha ? chip('Chamada de senha') : null, d.orientation === 'port' ? ' ' : null, d.orientation === 'port' ? chip('Em pé') : null),
        el('b', { text: d.label }), el('div', { class: 'dim small', text: d.desc }),
        btns(usar)));
  };
  const paint = () => {
    put(filtro, ...[['', 'Todos'], ...DEMO_SEGMENTS].map(([k, l]) => btn(l, () => { seg = k; paint(); }, `small${seg === k ? ' primary' : ''}`)));
    put(grid, ...DEMO_LAYOUTS.filter((d) => !seg || d.segment === seg).map(card));
  };
  paint();
  put(box, label(`Layouts de demonstração (${DEMO_LAYOUTS.length})`),
    note('Prontos para mostrar ao cliente: um clique cria o layout com as playlists de fotos premium, as frases, o QR code e o canal ao vivo já escolhidos. Depois é só pôr o layout numa tela e trocar os textos, se quiser.'),
    filtro, grid);
  return box;
}
