// TV Corporativa · aba Layouts (docs/TV-CORPORATIVA.md §4.2 e §6): os modelos de fábrica (tela cheia, vídeo + lateral, em
// L, recepção, refeitório, chão de fábrica, totem…) e os layouts da empresa. O editor mostra o quadro 16:9 (ou 9:16, em pé)
// com as zonas: arrastar a zona move, arrastar o canto ajusta o tamanho; as setas do teclado fazem o mesmo (com Shift,
// mudam o tamanho). Até 6 zonas e uma só de vídeo, em % da tela. Rotas: GET/POST/PATCH/DELETE /api/tvcorp/layouts[/:id].
import { el, guard, toast, tapi, put, f, opt, table, label, note, empty, btn, btns, chip, dialog, D, when, listOf } from './tvcorp-base.js';
import { layoutPreview, frameOf } from '../../shared/tvcorp-previa.js';
import { widgetItem } from './tvcorp-playlists.js';
import { FACTORY_LAYOUTS, FACTORY_LAYOUT, FACTORY_SETS, LAYOUT_SEGMENTS, ZONE_KINDS, ZONE_KIND, zoneLabel, LIMITS, checkZones, widgetLabel } from './tvcorp-catalogo.js';
import { themeOf } from './tvcorp-midias.js';
import { quadroPx, formatoDe, FORMATO_TXT, dicaArte, quadrosDoLayout } from './tvcorp-quadros.js';
import { WALL_GRIDS, WALL_MODES, bezelPct } from '../../shared/tvcorp-wall.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v)); return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** O fundo do layout é só cor (contrato): o que aparece entre as zonas. */
const BACKGROUNDS = [['#0b1220', 'Escuro'], ['#eef2f7', 'Claro'], ['#000000', 'Preto'], ['#1d4ed8', 'Azul'], ['#15803d', 'Verde'], ['#334155', 'Grafite']];
const SAMPLE_TICKER = ['Bem-vindo! Use o crachá em todas as áreas', 'Refeitório aberto das 11h às 14h'];
/** Os gadgets do cliente (contador, dias sem acidente, relógio mundial: aba Barras e blocos), lidos ao abrir a aba. */
let WIDGETS = [];
/** Há cidade para o clima? (a cidade das telas em Configurações, ou uma fonte de clima em Notícias e dados) */
let HAS_CITY = true;
/** O que a zona mostra na prévia: o gadget escolhido nela (o mesmo desenho da TV). */
const zoneItems = (zones) => Object.fromEntries((zones || []).map((z) => {
  const w = z.widget != null ? WIDGETS.find((x) => x.id === Number(z.widget)) : null;
  if (w) return [z.id, widgetItem(w)];
  const sample = SAMPLE_ITEM[z.sample || z.kind]; // os modelos prontos: um exemplo de como o gadget aparece
  return sample ? [z.id, sample()] : null;
}).filter(Boolean));
/** Os exemplos da prévia dos modelos prontos (o cliente escolhe o gadget dele no editor). */
const ymd = (n = 0) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const SAMPLE_ITEM = {
  clock: () => ({ kind: 'clock', face: 'digital', showSeconds: false }),
  weather: () => ({ kind: 'weather', title: 'Sua cidade', tempC: 27, text: 'Parcialmente nublado', days: [['seg', 19, 28], ['ter', 18, 27], ['qua', 20, 30]].map(([weekday, min, max]) => ({ weekday, min, max })) }),
  agenda: () => ({ kind: 'agenda', title: 'Agenda de hoje', today: ymd(), events: [{ date: ymd(), time: '09:00', title: 'Reunião geral', place: 'Sala 1' }, { date: ymd(), time: '14:00', title: 'Treinamento', place: 'Auditório' }, { date: ymd(1), time: '10:00', title: 'Visita técnica' }] }),
  dashboard: () => ({ kind: 'dashboard', title: 'Resultados do mês', items: [{ name: 'Vendas', value: 112, target: 100, unit: '%', band: 'ok' }, { name: 'Entregas', value: 95, target: 98, unit: '%', band: 'warn' }, { name: 'Satisfação', value: 93, target: 90, unit: '%', band: 'ok' }] }),
  reviews: () => ({ kind: 'reviews', title: 'O que dizem os clientes', items: [{ name: 'Ana P.', stars: 5, text: 'Atendimento excelente!' }, { name: 'Carlos M.', stars: 4, text: 'Preço justo.' }] }),
  directions: () => ({ kind: 'directions', title: 'Como chegar', address: 'Rua das Flores, 100 - Centro', reference: 'Em frente à praça' }),
  countdown: () => ({ kind: 'countdown', title: 'Promoção', target: Date.now() - 3600_000, until: Date.now() + (2 * 86400 + 5 * 3600) * 1000 }),
  safety: () => ({ kind: 'safety', title: 'Dias sem acidente', since: ymd(-128), record: 412, goal: 365 }),
  worldclock: () => ({ kind: 'worldclock', title: 'Relógio mundial', clocks: [{ tz: 'America/Sao_Paulo', label: 'Brasília' }, { tz: 'Europe/Lisbon', label: 'Lisboa' }, { tz: 'America/New_York', label: 'Nova York' }] }),
  news: () => ({ kind: 'news', title: 'Notícias', items: [{ title: 'Manchete de exemplo das agências públicas' }, { title: 'Outra manchete curta para a tela' }], source: 'Agência Brasil' }),
  quotes: () => ({ kind: 'quotes', title: 'Cotações', items: [{ label: 'Dólar', value: 5.42, change: 0.3 }, { label: 'Euro', value: 5.91, change: -0.2 }], source: 'Banco Central' }),
};
const previewOpts = (layout) => ({ theme: { ...themeOf(), mode: layout.background === '#eef2f7' ? 'light' : themeOf().mode }, ticker: SAMPLE_TICKER, labels: true, items: zoneItems(layout.zones) });

/** O quadro de edição: as zonas como retângulos com a alça no canto. onChange(): a cada mudança (arrastar, teclado). */
export function zoneCanvas(st, onChange) {
  const svg = sv('svg', { class: 'tc-zedit', role: 'application', 'aria-label': 'Quadro do layout: arraste as zonas para mover e o canto para mudar o tamanho' });
  let drag = null;
  const pctOf = (e) => { const r = svg.getBoundingClientRect?.() || { width: 1, height: 1 }; return { dx: ((e.clientX - drag.cx) / (r.width || 1)) * 100, dy: ((e.clientY - drag.cy) / (r.height || 1)) * 100 }; };
  function paint() {
    const fr = frameOf(st.orientation);
    svg.setAttribute('viewBox', `0 0 ${fr.w} ${fr.h}`);
    svg.classList.toggle('port', st.orientation === 'port');
    const kids = [sv('rect', { class: 'tc-zbg', x: 0, y: 0, width: fr.w, height: fr.h })];
    // a grade de 10% para ajudar a alinhar
    for (let i = 1; i < 10; i++) kids.push(sv('line', { class: 'tc-zgrid', x1: (fr.w * i) / 10, y1: 0, x2: (fr.w * i) / 10, y2: fr.h }), sv('line', { class: 'tc-zgrid', x1: 0, y1: (fr.h * i) / 10, x2: fr.w, y2: (fr.h * i) / 10 }));
    // a camada de cima por último (fica sobre a outra também no quadro de edição)
    const order = st.zones.map((z, i) => i).sort((a, b) => Number(Boolean(st.zones[a].overlay)) - Number(Boolean(st.zones[b].overlay)));
    order.forEach((i) => { const z = st.zones[i];
      const x = (z.x / 100) * fr.w; const y = (z.y / 100) * fr.h; const w = (z.w / 100) * fr.w; const h = (z.h / 100) * fr.h;
      const g = sv('g', { class: `tc-zg k-${z.kind}${z.overlay ? ' ov' : ''}${st.sel === i ? ' sel' : ''}`, tabindex: '0', role: 'button', 'aria-label': `Zona ${z.id}, ${zoneLabel(z.kind)}: ${z.x}% da esquerda, ${z.y}% do alto, ${z.w}% de largura, ${z.h}% de altura` });
      const body = sv('rect', { class: 'tc-zr', x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), 'data-i': i, 'data-m': 'move' });
      const t = sv('text', { class: 'tc-zt', x: (x + 2).toFixed(2), y: (y + 6).toFixed(2) }); t.textContent = `${z.id} · ${zoneLabel(z.kind)}`;
      const t2 = sv('text', { class: 'tc-zt2', x: (x + 2).toFixed(2), y: (y + 11).toFixed(2) }); const px = quadroPx(st, z); t2.textContent = `${px.w}×${px.h} px`;
      const hd = sv('rect', { class: 'tc-zh', x: (x + w - 4).toFixed(2), y: (y + h - 4).toFixed(2), width: 4, height: 4, 'data-i': i, 'data-m': 'size' });
      g.append(body, t, t2, hd);
      g.addEventListener('focus', () => { if (st.sel !== i) { st.sel = i; onChange('select'); } });
      g.addEventListener('keydown', (e) => {
        const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!step) return;
        e.preventDefault();
        if (e.shiftKey) { z.w = clamp(z.w + step[0], 5, 100 - z.x); z.h = clamp(z.h + step[1], 5, 100 - z.y); } else { z.x = clamp(z.x + step[0], 0, 100 - z.w); z.y = clamp(z.y + step[1], 0, 100 - z.h); }
        onChange('move'); paint(); svg.querySelectorAll?.('.tc-zg')[i]?.focus?.();
      });
      kids.push(g);
    });
    svg.replaceChildren(...kids);
  }
  svg.addEventListener('pointerdown', (e) => {
    const t = e.target; const i = Number(t?.getAttribute?.('data-i'));
    if (!Number.isInteger(i) || !st.zones[i]) return;
    e.preventDefault();
    st.sel = i; drag = { i, mode: t.getAttribute('data-m'), cx: e.clientX, cy: e.clientY, z0: { ...st.zones[i] } };
    svg.setPointerCapture?.(e.pointerId);
    onChange('select'); paint();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { dx, dy } = pctOf(e); const z = st.zones[drag.i]; const z0 = drag.z0;
    if (drag.mode === 'size') { z.w = clamp(Math.round(z0.w + dx), 5, 100 - z0.x); z.h = clamp(Math.round(z0.h + dy), 5, 100 - z0.y); } else { z.x = clamp(Math.round(z0.x + dx), 0, 100 - z0.w); z.y = clamp(Math.round(z0.y + dy), 0, 100 - z0.h); }
    paint();
  });
  const end = () => { if (drag) { drag = null; onChange('move'); } };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  paint();
  return { node: svg, paint };
}

/** O editor do layout (novo, a partir de um modelo de fábrica, ou um que já existe). */
export function layoutEditor(lay, reload, factoryKey = null, copyOf = null) {
  const base = lay || copyOf || FACTORY_LAYOUT[factoryKey] || FACTORY_LAYOUT['video-lateral-barra'];
  const st = {
    name: lay?.name || (copyOf ? `${copyOf.name} (cópia)` : factoryKey ? base.label : ''), orientation: base.orientation || 'land', background: (lay || copyOf)?.background || '#0b1220',
    zones: (base.zones || []).map((z) => ({ ...z })), sel: 0, factoryKey: (lay || copyOf)?.factoryKey || factoryKey || null,
  };
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name), value: st.name, placeholder: 'Ex.: Recepção da matriz' });
  const orient = el('select', {}, opt('land', 'Deitada (16:9)', st.orientation === 'land'), opt('port', 'Em pé (9:16, totem)', st.orientation === 'port'));
  const bg = el('select', {}, ...BACKGROUNDS.map(([v, t]) => opt(v, t, st.background === v)));
  const rowsBox = el('div', { class: 'tc-zones-wrap' }); const pv = el('div', { class: 'tc-pv-box' }); const err = el('p', { class: 'pf-err small', 'aria-live': 'polite' });
  const canvas = zoneCanvas(st, (why) => { if (why === 'select') paintRows(); else { paintRows(); paintPv(); } });
  const paintPv = () => {
    put(pv, layoutPreview({ orientation: st.orientation, zones: st.zones, name: st.name }, previewOpts(st)));
    // o clima sem cidade sai vazio na tela: avisa aqui, onde a zona é escolhida
    const semCidade = !HAS_CITY && st.zones.some((z) => z.kind === 'weather' || z.sample === 'weather' || WIDGETS.find((w) => w.id === Number(z.widget))?.kind === 'weather');
    err.textContent = checkZones(st.zones) || (semCidade ? 'Atenção: nenhuma cidade para o clima. Sem ela, a zona de clima fica vazia na tela. Escolha a cidade em Configurações ou cadastre uma fonte de clima em Notícias e dados.' : '');
  };
  function paintRows() {
    const num = (z, k) => el('input', { type: 'number', min: '0', max: '100', step: '1', value: String(z[k]), class: 'tc-num-in', 'aria-label': `${k} da zona ${z.id}`,
      onchange: (e) => { z[k] = clamp(Math.round(Number(e.target.value) || 0), 0, 100); canvas.paint(); paintPv(); paintRows(); } });
    // os campos próprios da zona (QR code, texto fixo, título do relógio mundial), como o servidor aceita
    const PARAM = { title: ['Título', 40], text: ['Texto', 120], qr: ['Endereço do QR (https)', 500] };
    // o gadget da zona (contador, dias sem acidente, relógio mundial): escolhido aqui, vai à tela sem precisar de playlist
    const widgetPick = (z) => {
      const mine = WIDGETS.filter((w) => z.kind === 'widget' || w.kind === z.kind);
      const s = el('select', { 'aria-label': `Gadget da zona ${z.id}`, onchange: (e) => { if (e.target.value) z.widget = Number(e.target.value); else delete z.widget; paintPv(); } },
        opt('', mine.length ? (['worldclock', 'widget'].includes(z.kind) ? 'Escolha o gadget' : 'Pela playlist da grade') : 'Nenhum criado (aba Barras e blocos)', z.widget == null),
        ...mine.map((w) => opt(w.id, `${z.kind === 'widget' ? `${widgetLabel(w.kind)}: ` : ''}${w.name || w.data?.title || `#${w.id}`}`, Number(z.widget) === w.id)));
      return s;
    };
    // por cima da imagem: a zona fica sobre as outras, com o fundo translúcido
    const layer = (z) => (z.kind === 'video' ? null : el('span', { class: 'tc-layer' },
      el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: Boolean(z.overlay), 'aria-label': `Zona ${z.id} por cima`, onchange: (e) => { if (e.target.checked) { z.overlay = true; z.opacity ??= 60; } else { delete z.overlay; delete z.opacity; } canvas.paint(); paintRows(); paintPv(); } }), el('span', { text: 'Por cima' })),
      z.overlay ? el('select', { 'aria-label': `Fundo da zona ${z.id}`, onchange: (e) => { z.opacity = Number(e.target.value); paintPv(); } }, ...[0, 20, 40, 60, 80, 100].map((v) => opt(v, v ? `fundo ${v}%` : 'sem fundo', (z.opacity ?? 60) === v))) : null));
    const params = (z) => [layer(z), ...(ZONE_KIND[z.kind]?.params || []).map((k) => (k === 'widget' ? widgetPick(z) : el('input', { type: k === 'qr' ? 'url' : 'text', maxlength: String(PARAM[k][1]), value: z[k] || '', placeholder: PARAM[k][0], 'aria-label': `${PARAM[k][0]} da zona ${z.id}`, onchange: (e) => { z[k] = e.target.value.trim(); paintPv(); } })))];
    const tam = (z) => { const px = quadroPx(st, z); return el('td', { class: 'small', title: z.kind === 'playlist' ? dicaArte({ px }) : '' }, el('b', { text: `${px.w}×${px.h}` }), el('div', { class: 'dim', text: FORMATO_TXT[formatoDe(px)] })); };
    const dicas = st.zones.filter((z) => z.kind === 'playlist').map((z) => note(`Quadro "${z.id}": ${dicaArte({ px: quadroPx(st, z) })}`, 'small'));
    put(rowsBox, table(['Zona', 'O que mostra', 'Esquerda %', 'Alto %', 'Largura %', 'Altura %', 'Na TV (px)', 'Conteúdo fixo', ''], st.zones.map((z, i) => el('tr', { class: st.sel === i ? 'tc-sel' : '' },
      el('td', {}, el('input', { type: 'text', maxlength: '20', value: z.id, class: 'tc-id-in', 'aria-label': 'Nome da zona', onchange: (e) => { z.id = e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 16) || `z${i + 1}`; e.target.value = z.id; canvas.paint(); paintPv(); } })),
      el('td', {}, el('select', { 'aria-label': `Tipo da zona ${z.id}`, onchange: (e) => { z.kind = e.target.value; canvas.paint(); paintRows(); paintPv(); } }, ...ZONE_KINDS.map((k) => opt(k.key, k.label, k.key === z.kind)))),
      el('td', {}, num(z, 'x')), el('td', {}, num(z, 'y')), el('td', {}, num(z, 'w')), el('td', {}, num(z, 'h')),
      tam(z),
      el('td', {}, ...params(z)),
      el('td', {}, btn('Tirar', () => { st.zones.splice(i, 1); st.sel = Math.max(0, Math.min(st.sel, st.zones.length - 1)); canvas.paint(); paintRows(); paintPv(); }, 'small danger'))))),
    btns(btn('+ Zona', () => {
      if (st.zones.length >= LIMITS.zones) { toast(`No máximo ${LIMITS.zones} zonas por layout.`, true); return; }
      let n = st.zones.length + 1; while (st.zones.some((z) => z.id === `z${n}`)) n++;
      st.zones.push({ id: `z${n}`, kind: 'playlist', x: 0, y: 0, w: 30, h: 30 }); st.sel = st.zones.length - 1; canvas.paint(); paintRows(); paintPv();
    }, 'small')), ...dicas);
  }
  orient.addEventListener('change', () => { st.orientation = orient.value; canvas.paint(); paintPv(); paintRows(); });
  bg.addEventListener('change', () => { st.background = bg.value; paintPv(); });
  name.addEventListener('input', () => { st.name = name.value; });
  paintRows(); paintPv();
  dialog(lay ? `Layout · ${lay.name}` : 'Novo layout', el('div', {},
    el('div', { class: 'pf-grid' }, f('Nome', name), el('div', { class: 'pf-grid two' }, f('Tela', orient), f('Fundo', bg))),
    el('div', { class: 'tc-two' },
      el('div', {}, label('Arraste para ajustar'), canvas.node, note('Arraste a zona para mover; arraste o quadradinho do canto para mudar o tamanho. Com a zona escolhida, as setas movem 1% (com Shift, mudam o tamanho).')),
      el('div', {}, label('Como fica na TV'), pv, err)),
    label('Zonas'), rowsBox,
    note('Vídeo do canal: no máximo uma zona, e é sempre o mesmo vídeo de hoje, só que no retângulo da zona. Playlist: a sequência que a grade escolher para a zona. Texto rolante: os avisos e as fontes da aba Barras e blocos.')), {
    wide: true,
    save: async () => {
      const msg = checkZones(st.zones); if (msg) throw new Error(msg);
      if (!name.value.trim()) throw new Error('Dê um nome ao layout.');
      const body = { name: name.value.trim(), orientation: st.orientation, zones: st.zones.map(({ id, kind, x, y, w, h, title, text, qr, hint }) => ({ id, kind, x, y, w, h, ...(title ? { title } : {}), ...(text ? { text } : {}), ...(qr ? { qr } : {}), ...(hint ? { hint } : {}) })), background: st.background, factoryKey: st.factoryKey };
      if (lay) await tapi(`/api/tvcorp/layouts/${lay.id}`, { method: 'PATCH', body }); else await tapi('/api/tvcorp/layouts', { method: 'POST', body });
      toast('Layout salvo. As telas com grade neste layout trocam em até 1 minuto.');
      await reload();
    },
  });
}

const quadrosTxt = (l) => quadrosDoLayout(l).map((q) => `${q.zone.id}: ${q.px.w}×${q.px.h} (${FORMATO_TXT[q.formato]})`).join(' · ');
export default async function paintLayouts(box, ctx) {
  const d = D(); const reload = ctx.reload;
  WIDGETS = listOf(await tapi('/api/tvcorp/widgets').catch(() => null), 'widgets');
  const feeds = listOf(await tapi('/api/tvcorp/feeds').catch(() => null), 'feeds');
  const def = d.defaults || {};
  HAS_CITY = Boolean(def.cidade || def.extra?.cidade || def.config?.cidade || feeds.some((x) => x.kind === 'weather'));
  const usedBy = (id) => d.schedules.filter((s) => s.layoutId === id).map((s) => s.name);
  const mine = d.layouts.map((l) => el('div', { class: 'tc-lcard' },
    layoutPreview(l, { ...previewOpts(l), labels: false }),
    el('div', { class: 'tc-lcard-b' },
      el('b', { text: l.name }),
      el('div', { class: 'dim small', text: `${l.orientation === 'port' ? 'Em pé' : 'Deitada'} · ${(l.zones || []).length} zona(s)${l.updatedAt ? ` · ${when(l.updatedAt)}` : ''}` }),
      quadrosTxt(l) ? el('div', { class: 'small tc-quadros', text: `Quadros das playlists: ${quadrosTxt(l)}` }) : null,
      el('div', {}, ...(usedBy(l.id).length ? usedBy(l.id).map((n) => chip(n)) : [el('span', { class: 'dim small', text: 'em nenhuma grade' })])),
      btns(btn('Editar', () => layoutEditor(l, reload), 'small'), btn('Duplicar', () => layoutEditor(null, reload, null, l), 'small'),
        btn('Apagar', guard(async () => { if (usedBy(l.id).length) { toast(`Este layout está em ${usedBy(l.id).length} grade(s). Troque o layout delas antes de apagar.`, true); return; } if (!confirm(`Apagar o layout "${l.name}"?`)) return; await tapi(`/api/tvcorp/layouts/${l.id}`, { method: 'DELETE' }); await reload(); }), 'small danger')))));
  const factoryBox = factoryView(reload);
  const walls = D().walls || listOf(await tapi('/api/tvcorp/walls').catch(() => null), 'walls');
  put(box,
    note('O layout divide a tela em zonas: o vídeo do canal, playlists, o texto rolante, relógio, clima, QR code, logomarca, a chamada de senha e os widgets. Escolha um modelo pronto e ajuste; a grade diz qual layout vale em cada tela, dia e horário.'),
    label(`Layouts da empresa (${d.layouts.length} de ${LIMITS.layouts})`),
    mine.length ? el('div', { class: 'tc-lgrid' }, ...mine) : empty('Nenhum layout da empresa ainda. Comece por um modelo pronto abaixo.'),
    label(`Conjuntos de telas (${walls.length})`),
    note('Várias TVs juntas: no cardápio por tela cada TV tem o seu layout e a troca dos itens acontece junto em todas; no videowall um layout só, do tamanho do conjunto, e cada TV mostra a parte dela. Use "Identificar" para ver o número de cada TV na tela e montar na ordem.'),
    walls.length ? el('div', { class: 'tc-lgrid' }, ...walls.map((w) => wallCard(w, reload))) : empty('Nenhum conjunto ainda. Crie um, ou use um modelo pronto de várias TVs abaixo.'),
    btns(btn('+ Conjunto de telas', () => wallDialog(null, reload), 'small primary')),
    label('Modelos prontos'),
    factoryBox);
}
/** O filtro dos modelos prontos (segmento, formato e quantas TVs): fica entre uma visita e outra à aba. */
const FV = { segment: '', orient: '', tvs: '' };
/** Os modelos prontos: os de uma TV e os conjuntos de várias TVs (menu board), filtrados. */
function factoryView(reload) {
  const box = el('div', {});
  const sel = (k, first, options) => el('select', { 'aria-label': first, onchange: (e) => { FV[k] = e.target.value; paint(); } }, opt('', first, !FV[k]), ...options.map(([v, t]) => opt(v, t, FV[k] === v)));
  const bar = el('div', { class: 'pf-bar' }, sel('segment', 'Todos os segmentos', LAYOUT_SEGMENTS.map((x) => [x.key, x.label])), sel('orient', 'Deitado e em pé', [['land', 'Deitado'], ['port', 'Em pé']]),
    sel('tvs', 'Uma ou várias TVs', [['1', 'Uma TV'], ['n', 'Várias TVs (conjunto)']]));
  const count = el('span', { class: 'dim small' });
  const grid = el('div', { class: 'tc-lgrid' });
  const segLabel = (k) => LAYOUT_SEGMENTS.find((x) => x.key === k)?.label || '';
  const paint = () => {
    const ok = (x) => (!FV.segment || x.segment === FV.segment) && (!FV.orient || x.orientation === FV.orient);
    const singles = FV.tvs === 'n' ? [] : FACTORY_LAYOUTS.filter((l) => !l.set && ok(l));
    const sets = FV.tvs === '1' ? [] : FACTORY_SETS.filter(ok);
    count.textContent = `${singles.length + sets.length} modelo(s)`;
    put(grid,
      ...sets.map((x) => el('div', { class: 'tc-lcard tc-set' },
        el('div', { class: `tc-set-row ${x.orientation}` }, ...x.screens.map((k, i) => el('div', { class: 'tc-set-tv' }, layoutPreview(FACTORY_LAYOUT[k], { ...previewOpts(FACTORY_LAYOUT[k]), labels: false }), el('span', { class: 'dim small', text: `TV ${i + 1}` })))),
        el('div', { class: 'tc-lcard-b' }, el('div', {}, chip(`${x.screens.length} TVs`, 'tc-tvs'), ' ', chip(segLabel(x.segment))), el('b', { text: x.label }), el('div', { class: 'dim small', text: x.desc }),
          btns(btn('Usar este conjunto', () => setDialog(x, reload), 'small primary'))))),
      ...singles.map((l) => el('div', { class: 'tc-lcard' },
        layoutPreview(l, { ...previewOpts(l), labels: false }),
        el('div', { class: 'tc-lcard-b' }, el('div', {}, chip('1 TV', 'tc-tvs'), ' ', chip(segLabel(l.segment))), el('b', { text: l.label }), el('div', { class: 'dim small', text: l.desc }),
          quadrosTxt(l) ? el('div', { class: 'small tc-quadros', text: `Quadros das playlists: ${quadrosTxt(l)}` }) : null,
          btns(btn('Usar este modelo', () => layoutEditor(null, reload, l.key), 'small primary'))))));
    if (!sets.length && !singles.length) put(grid, empty('Nenhum modelo com esses filtros.'));
  };
  put(box, bar, count, grid);
  paint();
  return box;
}
/**
 * Usar um conjunto de várias TVs: cria um layout por TV ("<nome> · TV 1 de 3"…) e, para cada TV escolhida, uma grade com
 * alcance só nela (as playlists de cada zona se escolhem depois, na aba Grade). Cada TV recebe só o layout dela.
 */
function setDialog(x, reload) {
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name - 12), value: x.label.replace(/ em \d TVs.*$/, ''), placeholder: 'Ex.: Cardápio da praça de alimentação' });
  const devs = (D().devices || []).filter((d) => !d.revokedAt);
  const picks = x.screens.map((k, i) => el('select', { 'aria-label': `TV ${i + 1}` }, opt('', devs.length ? 'Escolher depois' : 'Nenhuma tela cadastrada ainda', true), ...devs.map((d) => opt(d.id, d.name || `Tela #${d.id}`))));
  dialog(`Conjunto · ${x.label}`, el('div', { class: 'pf-grid' },
    el('div', { class: `tc-set-row ${x.orientation}` }, ...x.screens.map((k, i) => el('div', { class: 'tc-set-tv' }, layoutPreview(FACTORY_LAYOUT[k], { ...previewOpts(FACTORY_LAYOUT[k]), labels: true }), el('span', { class: 'small', text: `TV ${i + 1}` })))),
    f('Nome do conjunto', name),
    note('Monte as TVs lado a lado na ordem da prévia (TV 1 à esquerda). Escolha qual tela cadastrada fica em cada posição: cada uma recebe uma grade só dela. Depois, na aba Grade, escolha as playlists de cada zona (o cardápio de cada TV).'),
    ...picks.map((s, i) => f(`TV ${i + 1}: ${FACTORY_LAYOUT[x.screens[i]].label.replace(/ \(TV.*$/, '')}`, s))), {
    wide: true, saveLabel: 'Criar o conjunto',
    save: async () => {
      const base = name.value.trim() || x.label;
      const chosen = picks.map((s) => s.value).filter(Boolean);
      if (new Set(chosen).size !== chosen.length) throw new Error('A mesma tela está em duas posições.');
      let made = 0; let grades = 0;
      for (const [i, k] of x.screens.entries()) {
        const lay = await tapi('/api/tvcorp/layouts', { method: 'POST', body: { factoryKey: k, name: `${base} · TV ${i + 1} de ${x.screens.length}`.slice(0, LIMITS.name) } });
        made++;
        const dev = picks[i].value ? Number(picks[i].value) : null;
        if (dev && lay?.id) {
          await tapi('/api/tvcorp/schedules', { method: 'POST', body: { name: `${base} · TV ${i + 1}`.slice(0, LIMITS.name), layoutId: lay.id, zonePlaylists: {}, scope: { kind: 'devices', devices: [dev] }, days: [], timeFrom: 0, timeTo: 1440, priority: 50 } });
          grades++;
        }
      }
      // as TVs escolhidas viram um conjunto de telas (cardápio por tela): trocam de item juntas e o "Identificar" mostra a posição
      const cells = picks.map((s, i) => (s.value ? { pos: i + 1, deviceId: Number(s.value) } : null)).filter(Boolean);
      let wallOk = false;
      if (cells.length) {
        try { await tapi('/api/tvcorp/walls', { method: 'POST', body: { name: base.slice(0, LIMITS.name), mode: 'menu', cols: x.screens.length, rows: 1, orientation: x.orientation, cells } }); wallOk = true; } catch (e) { toast(`Layouts criados, mas o conjunto de telas não: ${e.message}`, true); }
      }
      toast(`Conjunto criado: ${made} layout(s)${grades ? ` e ${grades} grade(s), uma por TV` : ''}${wallOk ? ', com a troca sincronizada' : ''}. Agora escolha as playlists de cada zona na aba Grade.`);
      await reload();
    },
  });
}

/* ---------------------------------------------------------------- conjuntos de telas (DIGITAL ISP) */
const devName = (id) => { const d = (D().devices || []).find((x) => x.id === Number(id)); return d ? d.name || `Tela #${d.id}` : `Tela #${id}`; };
// o layout que a grade dá a uma tela (a grade só dela, ou a mais específica que a inclui): para a prévia do cardápio
const layoutOfDevice = (id) => {
  const s = (D().schedules || []).find((x) => x.scope?.kind === 'devices' && (x.scope.devices || []).map(Number).includes(Number(id)));
  return s ? (D().layouts || []).find((l) => l.id === s.layoutId) || null : null;
};
/** A prévia do conjunto inteiro: no videowall o layout atravessando as TVs; no cardápio, cada TV com o layout dela. */
export function wallPreview(w) {
  const d = w.data || {};
  if (d.mode === 'wall') {
    const lay = (D().layouts || []).find((l) => l.id === Number(d.layoutId));
    return layoutPreview(lay || { orientation: d.orientation, zones: [] }, { ...previewOpts(lay || {}), labels: false, wall: { cols: d.cols, rows: d.rows, bezel: d.bezel, orientation: d.orientation } });
  }
  const cells = [];
  for (let pos = 1; pos <= d.cols * d.rows; pos++) {
    const c = (d.cells || []).find((x) => x.pos === pos); const lay = c ? layoutOfDevice(c.deviceId) : null;
    cells.push(el('div', { class: 'tc-set-tv' },
      lay ? layoutPreview(lay, { ...previewOpts(lay), labels: false }) : el('div', { class: `tc-wall-empty ${d.orientation}`, text: String(pos) }),
      el('span', { class: 'dim small', text: `${pos} · ${c ? devName(c.deviceId) : 'sem tela'}` })));
  }
  return el('div', { class: `tc-wall-grid c-${d.cols} ${d.orientation}` }, ...cells);
}
const gridLabel = (d) => WALL_GRIDS.find((g) => g.cols === d.cols && g.rows === d.rows)?.label || `${d.cols} × ${d.rows}`;
// "Identificar": cada TV do conjunto mostra o nome e o número da posição por 10 s
async function identify(w) {
  const cells = w.data?.cells || [];
  if (!cells.length) { toast('Nenhuma tela neste conjunto ainda.', true); return; }
  let n = 0;
  for (const c of cells) { await tapi(`/api/tvcorp/rede/devices/${c.deviceId}/commands`, { method: 'POST', body: { type: 'identify' } }); n++; }
  toast(`Pedido enviado a ${n} tela(s): cada uma mostra o número da posição por 10 segundos (o app antigo ignora).`);
}
function wallCard(w, reload) {
  const d = w.data || {};
  return el('div', { class: 'tc-lcard tc-set' }, wallPreview(w),
    el('div', { class: 'tc-lcard-b' },
      el('div', {}, chip(d.mode === 'wall' ? 'Videowall' : 'Cardápio por tela', 'tc-tvs'), ' ', chip(gridLabel(d))),
      el('b', { text: w.name }),
      el('div', { class: 'dim small', text: `${(d.cells || []).length} de ${d.cols * d.rows} posições com tela · ${d.orientation === 'port' ? 'TVs em pé' : 'TVs deitadas'}${d.sync !== false ? ' · troca sincronizada' : ''}${d.bezel?.x || d.bezel?.y ? ` · moldura ${d.bezel.x}% × ${d.bezel.y}%` : ''}` }),
      btns(btn('Editar', () => wallDialog(w, reload), 'small'), btn('Identificar', guard(() => identify(w)), 'small'),
        btn('Apagar', guard(async () => { if (!confirm(`Apagar o conjunto "${w.name}"? As telas, layouts e grades continuam; só deixam de andar juntas.`)) return; await tapi(`/api/tvcorp/walls/${w.id}`, { method: 'DELETE' }); await reload(); }), 'small danger'))));
}
/** Criar ou mudar um conjunto: modo, grade, orientação, moldura, sincronia, a tela de cada posição e (videowall) o layout. */
export function wallDialog(w, reload) {
  const cur = w?.data || {};
  const st = { mode: cur.mode || 'menu', cols: cur.cols || 2, rows: cur.rows || 1, orientation: cur.orientation || 'land', bezel: { x: cur.bezel?.x || 0, y: cur.bezel?.y || 0 }, sync: cur.sync !== false, layoutId: cur.layoutId || '', cells: Object.fromEntries((cur.cells || []).map((c) => [c.pos, c.deviceId])) };
  const devs = (D().devices || []).filter((d) => !d.revokedAt);
  const otherWall = (id) => (D().walls || []).find((x) => x.id !== w?.id && (x.data?.cells || []).some((c) => c.deviceId === id));
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name), value: w?.name || '', placeholder: 'Ex.: Cardápio da praça de alimentação' });
  const mode = el('select', { 'aria-label': 'Modo do conjunto' }, ...WALL_MODES.map((m) => opt(m.key, m.label, st.mode === m.key)));
  const grid = el('select', { 'aria-label': 'Grade do conjunto' }, ...WALL_GRIDS.map((g) => opt(g.key, g.label, g.cols === st.cols && g.rows === st.rows)));
  const orient = el('select', { 'aria-label': 'Orientação das TVs' }, opt('land', 'Deitadas (16:9)', st.orientation === 'land'), opt('port', 'Em pé (9:16)', st.orientation === 'port'));
  const bx = el('input', { type: 'number', min: '0', max: '20', step: '0.1', value: String(st.bezel.x), 'aria-label': 'Moldura na largura (%)' });
  const by = el('input', { type: 'number', min: '0', max: '20', step: '0.1', value: String(st.bezel.y), 'aria-label': 'Moldura na altura (%)' });
  const inches = el('input', { type: 'number', min: '10', max: '120', step: '1', placeholder: 'Ex.: 55', 'aria-label': 'Tamanho da TV (polegadas)' });
  const gap = el('input', { type: 'number', min: '0', max: '200', step: '0.5', placeholder: 'Ex.: 12', 'aria-label': 'Bordas de duas TVs vizinhas (mm)' });
  const calc = () => { if (!inches.value) return; const b = bezelPct({ inches: inches.value, gapMm: gap.value || 0, orientation: st.orientation }); bx.value = String(b.x); by.value = String(b.y); st.bezel = b; paint(); };
  inches.addEventListener('input', calc); gap.addEventListener('input', calc);
  const sync = el('input', { type: 'checkbox', checked: st.sync, 'aria-label': 'Troca sincronizada' });
  const wallLays = () => (D().layouts || []);
  const layout = el('select', { 'aria-label': 'Layout do videowall' });
  const mkGrade = el('input', { type: 'checkbox', checked: !w, 'aria-label': 'Criar a grade do videowall' });
  const layoutBox = el('div', {}); const cellsBox = el('div', { class: 'pf-grid two' }); const pv = el('div', { class: 'tc-pv-box' }); const hint = el('p', { class: 'dim small' });
  const paintCells = () => {
    const n = st.cols * st.rows;
    for (const k of Object.keys(st.cells)) if (Number(k) > n) delete st.cells[k];
    put(cellsBox, ...Array.from({ length: n }, (_, i) => {
      const pos = i + 1;
      const s = el('select', { 'aria-label': `Tela da posição ${pos}`, onchange: (e) => { if (e.target.value) st.cells[pos] = Number(e.target.value); else delete st.cells[pos]; paint(); } },
        opt('', devs.length ? 'Nenhuma (escolher depois)' : 'Nenhuma tela cadastrada ainda', !st.cells[pos]),
        ...devs.map((d) => opt(d.id, `${d.name || `Tela #${d.id}`}${otherWall(d.id) ? ` (está em "${otherWall(d.id).name}")` : ''}`, st.cells[pos] === d.id)));
      return f(`Posição ${pos} (linha ${Math.floor(i / st.cols) + 1}, coluna ${(i % st.cols) + 1})`, s);
    }));
  };
  const paintLayout = () => {
    put(layout, opt('', wallLays().length ? 'Escolha o layout' : 'Nenhum layout criado ainda', !st.layoutId), ...wallLays().map((l) => opt(l.id, l.name, Number(st.layoutId) === l.id)));
    put(layoutBox, ...(st.mode === 'wall' ? [f('Layout do videowall (no tamanho do conjunto inteiro)', layout, 'As zonas em % valem para o conjunto inteiro: a zona de 0 a 50% de largura, num 2 × 1, ocupa a TV da esquerda.'),
      el('label', { class: 'pf-check' }, mkGrade, el('span', { text: 'Criar a grade do videowall (o layout em todas as TVs do conjunto, o dia todo)' }))] : []));
  };
  const paint = () => {
    const data = { mode: st.mode, cols: st.cols, rows: st.rows, orientation: st.orientation, bezel: st.bezel, sync: st.sync, layoutId: st.layoutId ? Number(st.layoutId) : null, cells: Object.entries(st.cells).map(([pos, deviceId]) => ({ pos: Number(pos), deviceId })) };
    put(pv, wallPreview({ name: name.value, data }));
    hint.textContent = WALL_MODES.find((m) => m.key === st.mode)?.desc || '';
  };
  mode.addEventListener('change', () => { st.mode = mode.value; paintLayout(); paint(); });
  grid.addEventListener('change', () => { const g = WALL_GRIDS.find((x) => x.key === grid.value); st.cols = g.cols; st.rows = g.rows; paintCells(); paint(); });
  orient.addEventListener('change', () => { st.orientation = orient.value; calc(); paint(); });
  const num = (v) => Math.max(0, Math.min(20, Number(v) || 0));
  bx.addEventListener('change', () => { st.bezel = { ...st.bezel, x: num(bx.value) }; paint(); });
  by.addEventListener('change', () => { st.bezel = { ...st.bezel, y: num(by.value) }; paint(); });
  sync.addEventListener('change', () => { st.sync = sync.checked; });
  layout.addEventListener('change', () => { st.layoutId = layout.value; paint(); });
  paintCells(); paintLayout(); paint();
  dialog(w ? `Conjunto · ${w.name}` : 'Novo conjunto de telas', el('div', { class: 'tc-wall-form' },
    el('div', { class: 'pf-grid' }, f('Nome do conjunto', name)),
    el('div', { class: 'pf-grid two' }, f('Modo', mode), f('Grade (colunas × linhas)', grid)), hint,
    el('div', { class: 'pf-grid two' }, f('Cada TV', orient), el('label', { class: 'pf-check' }, sync, el('span', { text: 'Troca sincronizada (todas as TVs trocam de item juntas, pelo relógio)' }))),
    label('Moldura entre as TVs'),
    el('div', { class: 'pf-grid two' }, f('Tamanho da TV (polegadas)', inches), f('Bordas de duas TVs vizinhas, somadas (mm)', gap, 'Meça de uma imagem à outra. Preenche a moldura em % ao lado.')),
    el('div', { class: 'pf-grid two' }, f('Moldura na largura (% de uma tela)', bx), f('Moldura na altura (% de uma tela)', by)),
    layoutBox,
    label('Como fica o conjunto'), pv,
    label('A tela de cada posição'), note('A posição 1 é a de cima, à esquerda; segue pela linha. Use "Identificar" depois de salvar para cada TV mostrar o número dela.'), cellsBox), {
    wide: true, saveLabel: w ? 'Salvar' : 'Criar o conjunto',
    save: async () => {
      if (!name.value.trim()) throw new Error('Dê um nome ao conjunto.');
      if (st.mode === 'wall' && !st.layoutId) throw new Error('Escolha o layout do videowall.');
      const body = { name: name.value.trim(), mode: st.mode, cols: st.cols, rows: st.rows, orientation: st.orientation, bezel: st.bezel, sync: st.sync, layoutId: st.mode === 'wall' ? Number(st.layoutId) : null, cells: Object.entries(st.cells).map(([pos, deviceId]) => ({ pos: Number(pos), deviceId })) };
      if (w) await tapi(`/api/tvcorp/walls/${w.id}`, { method: 'PATCH', body }); else await tapi('/api/tvcorp/walls', { method: 'POST', body });
      const devices = body.cells.map((c) => c.deviceId);
      if (st.mode === 'wall' && mkGrade.checked && devices.length) {
        await tapi('/api/tvcorp/schedules', { method: 'POST', body: { name: `${body.name} · videowall`.slice(0, LIMITS.name), layoutId: body.layoutId, zonePlaylists: {}, scope: { kind: 'devices', devices }, days: [], timeFrom: 0, timeTo: 1440, priority: 50 } });
      }
      toast(`Conjunto salvo.${st.mode === 'wall' && mkGrade.checked && devices.length ? ' A grade do videowall foi criada: escolha as playlists das zonas na aba Grade.' : ''} As telas recebem a posição em até 1 minuto.`);
      await reload();
    },
  });
}
