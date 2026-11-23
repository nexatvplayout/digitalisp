// TV Corporativa · aba Layouts (docs/TV-CORPORATIVA.md §4.2 e §6): os modelos de fábrica (tela cheia, vídeo + lateral, em
// L, recepção, refeitório, chão de fábrica, totem…) e os layouts da empresa. O editor mostra o quadro 16:9 (ou 9:16, em pé)
// com as zonas: arrastar a zona move, arrastar o canto ajusta o tamanho; as setas do teclado fazem o mesmo (com Shift,
// mudam o tamanho). Até 6 zonas e uma só de vídeo, em % da tela. Rotas: GET/POST/PATCH/DELETE /api/tvcorp/layouts[/:id].
import { el, guard, toast, tapi, put, f, opt, table, label, note, empty, btn, btns, chip, dialog, D, when } from './tvcorp-base.js';
import { layoutPreview, frameOf } from '../../shared/tvcorp-previa.js';
import { FACTORY_LAYOUTS, FACTORY_LAYOUT, ZONE_KINDS, ZONE_KIND, zoneLabel, LIMITS, checkZones } from './tvcorp-catalogo.js';
import { themeOf } from './tvcorp-midias.js';
import { quadroPx, formatoDe, FORMATO_TXT, dicaArte, quadrosDoLayout } from './tvcorp-quadros.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v)); return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** O fundo do layout é só cor (contrato): o que aparece entre as zonas. */
const BACKGROUNDS = [['#0b1220', 'Escuro'], ['#eef2f7', 'Claro'], ['#000000', 'Preto'], ['#1d4ed8', 'Azul'], ['#15803d', 'Verde'], ['#334155', 'Grafite']];
const SAMPLE_TICKER = ['Bem-vindo! Use o crachá em todas as áreas', 'Refeitório aberto das 11h às 14h'];
const previewOpts = (layout) => ({ theme: { ...themeOf(), mode: layout.background === '#eef2f7' ? 'light' : themeOf().mode }, ticker: SAMPLE_TICKER, labels: true });

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
    st.zones.forEach((z, i) => {
      const x = (z.x / 100) * fr.w; const y = (z.y / 100) * fr.h; const w = (z.w / 100) * fr.w; const h = (z.h / 100) * fr.h;
      const g = sv('g', { class: `tc-zg k-${z.kind}${st.sel === i ? ' sel' : ''}`, tabindex: '0', role: 'button', 'aria-label': `Zona ${z.id}, ${zoneLabel(z.kind)}: ${z.x}% da esquerda, ${z.y}% do alto, ${z.w}% de largura, ${z.h}% de altura` });
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
  const rowsBox = el('div', {}); const pv = el('div', {}); const err = el('p', { class: 'pf-err small', 'aria-live': 'polite' });
  const canvas = zoneCanvas(st, (why) => { if (why === 'select') paintRows(); else { paintRows(); paintPv(); } });
  const paintPv = () => { put(pv, layoutPreview({ orientation: st.orientation, zones: st.zones, name: st.name }, previewOpts(st))); err.textContent = checkZones(st.zones) || ''; };
  function paintRows() {
    const num = (z, k) => el('input', { type: 'number', min: '0', max: '100', step: '1', value: String(z[k]), class: 'tc-num-in', 'aria-label': `${k} da zona ${z.id}`,
      onchange: (e) => { z[k] = clamp(Math.round(Number(e.target.value) || 0), 0, 100); canvas.paint(); paintPv(); paintRows(); } });
    // os campos próprios da zona (QR code, texto fixo, título do relógio mundial), como o servidor aceita
    const PARAM = { title: ['Título', 40], text: ['Texto', 120], qr: ['Endereço do QR (https)', 500] };
    const params = (z) => (ZONE_KIND[z.kind]?.params || []).map((k) => el('input', { type: k === 'qr' ? 'url' : 'text', maxlength: String(PARAM[k][1]), value: z[k] || '', placeholder: PARAM[k][0], 'aria-label': `${PARAM[k][0]} da zona ${z.id}`, onchange: (e) => { z[k] = e.target.value.trim(); paintPv(); } }));
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
  put(box,
    note('O layout divide a tela em zonas: o vídeo do canal, playlists, o texto rolante, relógio, clima, QR code, logomarca, a chamada de senha e os widgets. Escolha um modelo pronto e ajuste; a grade diz qual layout vale em cada tela, dia e horário.'),
    label(`Layouts da empresa (${d.layouts.length} de ${LIMITS.layouts})`),
    mine.length ? el('div', { class: 'tc-lgrid' }, ...mine) : empty('Nenhum layout da empresa ainda. Comece por um modelo pronto abaixo.'),
    label('Modelos prontos'),
    el('div', { class: 'tc-lgrid' }, ...FACTORY_LAYOUTS.map((l) => el('div', { class: 'tc-lcard' },
      layoutPreview(l, { ...previewOpts(l), labels: false }),
      el('div', { class: 'tc-lcard-b' }, el('b', { text: l.label }), el('div', { class: 'dim small', text: l.desc }),
        quadrosTxt(l) ? el('div', { class: 'small tc-quadros', text: `Quadros das playlists: ${quadrosTxt(l)}` }) : null,
        btns(btn('Usar este modelo', () => layoutEditor(null, reload, l.key), 'small primary')))))));
}
