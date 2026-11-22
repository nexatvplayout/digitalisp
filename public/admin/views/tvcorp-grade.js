// TV Corporativa · aba Grade (docs/TV-CORPORATIVA.md §2.2, §5.4 e §6): as grades de programação. Cada grade diz qual
// layout vale, qual playlist entra em cada zona, para onde (empresa toda, unidades, grupos ou telas), em que dias, em que
// faixa de horário (pode virar a noite), em que período e com que prioridade (maior vence; empate: a mais específica).
// A semana em colunas mostra os blocos; "Prévia" diz quantas telas a grade pega e o que cada uma mostra agora.
// Rotas: GET/POST/PATCH/DELETE /api/tvcorp/schedules[/:id], POST /api/tvcorp/schedules/preview, GET /devices/:id/now.
import {
  el, guard, toast, tapi, put, f, opt, table, label, note, empty, btn, btns, chip, dialog, D, scopePicker, scopeText, statusChip, active, officeOf, dayText,
} from './tvcorp-base.js';
import { layoutPreview } from '../../shared/tvcorp-previa.js';
import { LIMITS, WEEK_SHORT, ZONE_KIND, minToHm, hmToMin, daysOf, daysText } from './tvcorp-catalogo.js';
import { themeOf } from './tvcorp-midias.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, text = null) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v)); if (text != null) n.textContent = text; return n; };
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // a semana começa na segunda
const COLORS = 8;

/** Os pedaços de uma grade na semana: [{ day (0..6), from, to }] em minutos; faixa que vira a noite continua no dia seguinte. */
export function segmentsOf(s) {
  const days = daysOf(s.days); const list = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
  const from = s.timeFrom ?? 0; const to = s.timeTo ?? 1440;
  const out = [];
  for (const d of list) {
    if (to > from) out.push({ day: d, from, to });
    else { out.push({ day: d, from, to: 1440 }); if (to > 0) out.push({ day: (d + 1) % 7, from: 0, to }); }
  }
  return out;
}
/** Faixas por coluna: as grades que se cruzam no mesmo dia ficam lado a lado (lane), sem se cobrir. */
export function lanes(schedules) {
  const byDay = new Map();
  schedules.forEach((s, i) => { for (const seg of segmentsOf(s)) { if (!byDay.has(seg.day)) byDay.set(seg.day, []); byDay.get(seg.day).push({ ...seg, s, i }); } });
  const out = [];
  for (const [, segs] of byDay) {
    segs.sort((a, b) => a.from - b.from || b.s.priority - a.s.priority);
    const ends = [];
    for (const g of segs) { let l = ends.findIndex((e) => e <= g.from); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = g.to; g.lane = l; }
    for (const g of segs) { g.lanes = ends.length; out.push(g); }
  }
  return out;
}

function weekView(schedules, onPick) {
  const W = 700; const H = 360; const left = 34; const top = 18; const colW = (W - left) / 7; const hh = (H - top) / 24;
  const svg = sv('svg', { class: 'tc-week', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'A semana com os blocos de cada grade' });
  ORDER.forEach((d, c) => {
    svg.append(sv('rect', { class: `tc-wcol${c % 2 ? ' alt' : ''}`, x: left + c * colW, y: top, width: colW, height: H - top }), sv('text', { class: 'tc-wday', x: left + c * colW + colW / 2, y: 12, 'text-anchor': 'middle' }, WEEK_SHORT[d]));
  });
  for (let h = 0; h <= 24; h += 3) svg.append(sv('line', { class: 'tc-wline', x1: left, y1: top + h * hh, x2: W, y2: top + h * hh }), sv('text', { class: 'tc-whour', x: left - 4, y: top + h * hh + 3, 'text-anchor': 'end' }, `${String(h).padStart(2, '0')}h`));
  for (const g of lanes(schedules)) {
    const c = ORDER.indexOf(g.day); const w = (colW - 4) / g.lanes;
    const x = left + c * colW + 2 + g.lane * w; const y = top + (g.from / 60) * hh; const h = Math.max(4, ((g.to - g.from) / 60) * hh);
    const r = sv('rect', { class: `tc-wblk c${g.i % COLORS}${g.s.status === 'pending' ? ' pending' : ''}`, x: x.toFixed(1), y: y.toFixed(1), width: Math.max(2, w - 1).toFixed(1), height: h.toFixed(1), rx: 3, tabindex: '0', role: 'button', 'aria-label': `${g.s.name}: ${WEEK_SHORT[g.day]}, ${minToHm(g.from)} às ${minToHm(g.to)}` });
    const tt = sv('title', {}, `${g.s.name} · ${minToHm(g.from)}–${minToHm(g.to)} · prioridade ${g.s.priority}`); r.append(tt);
    r.addEventListener('click', () => onPick(g.s)); r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(g.s); } });
    svg.append(r);
    if (h > 14 && w > 30) svg.append(sv('text', { class: 'tc-wtxt', x: (x + 3).toFixed(1), y: (y + 11).toFixed(1) }, g.s.name.slice(0, Math.floor(w / 5.5))));
  }
  return svg;
}

/** O que a prévia do servidor diz: quantas telas e o que cada uma mostraria agora. */
function previewResult(r) {
  // POST /api/tvcorp/schedules/preview: { devices: quantas, winsNow: em quantas ela vence agora, list: [{ name, office, now }] }
  const list = r.list || [];
  return el('div', {},
    el('p', { class: 'pf-reach', text: `${r.devices ?? 0} tela(s) pegam esta grade · em ${r.winsNow ?? 0} ela vale agora` }),
    list.length ? table(['Tela', 'Unidade', 'Mostra agora'], list.slice(0, 50).map((x) => el('tr', {}, el('td', { text: x.name }), el('td', { text: x.office || '—' }),
      el('td', { text: !x.now ? 'nada (fora do horário)' : x.now.draft ? 'esta grade' : `outra grade: ${x.now.name}` })))) : null);
}

function editSchedule(s, reload) {
  const d = D();
  if (!d.layouts.length) { toast('Crie um layout antes (aba Layouts: "Usar este modelo").', true); return; }
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name), value: s?.name || '', placeholder: 'Ex.: Fábrica, turnos da semana' });
  const layout = el('select', {}, ...d.layouts.map((l) => opt(l.id, l.name, (s?.layoutId ?? d.layouts[0].id) === l.id)));
  const zonesBox = el('div', { class: 'pf-grid' }); const pv = el('div', {});
  const zp = { ...(s?.zonePlaylists || {}) };
  const days = new Set(daysOf(s?.days ?? '1,2,3,4,5'));
  const allDay = !s || (s.timeFrom === 0 && s.timeTo === 1440);
  const tf = el('input', { type: 'time', value: allDay ? '' : minToHm(s.timeFrom) }); const tt = el('input', { type: 'time', value: allDay ? '' : minToHm(s.timeTo % 1440) });
  const df = el('input', { type: 'date', value: s?.dateFrom || '' }); const dt = el('input', { type: 'date', value: s?.dateTo || '' });
  const prio = el('input', { type: 'number', min: String(LIMITS.priorityMin), max: String(LIMITS.priorityMax), value: String(s?.priority ?? 10) });
  const sk = s?.scope?.kind;
  const scope = scopePicker(sk && sk !== 'all' ? { scope: sk, scopeData: { [sk]: s.scope[sk] || [] } } : { scope: 'all' });
  const reach = el('div', { 'aria-live': 'polite' });
  const lay = () => d.layouts.find((l) => l.id === Number(layout.value));
  const paintZones = () => {
    const l = lay();
    const pz = (l?.zones || []).filter((z) => ZONE_KIND[z.kind]?.playlist);
    put(zonesBox, pz.length ? pz.map((z) => f(`Zona "${z.id}"`, el('select', { onchange: (e) => { zp[z.id] = e.target.value ? Number(e.target.value) : null; } },
      opt('', d.playlists.length ? 'Vazia' : 'Nenhuma playlist ainda (aba Playlists)', !zp[z.id]), ...d.playlists.map((p) => opt(p.id, p.name, Number(zp[z.id]) === p.id)))))
      : note('Este layout não tem zona de playlist: mostra só o vídeo, o texto rolante e os widgets.'));
    put(pv, l ? layoutPreview(l, { theme: themeOf(), labels: true, ticker: ['Texto rolante'] }) : null);
  };
  layout.addEventListener('change', paintZones); paintZones();
  const body = () => {
    const sc = scope.read();
    const l = lay(); const ids = new Set((l?.zones || []).filter((z) => ZONE_KIND[z.kind]?.playlist).map((z) => z.id));
    const from = hmToMin(tf.value); const to = hmToMin(tt.value);
    if ((from == null) !== (to == null)) throw new Error('Diga o começo e o fim da faixa de horário (ou deixe os dois vazios para o dia todo).');
    if (df.value && dt.value && dt.value < df.value) throw new Error('O fim do período vem antes do começo.');
    const sco = sc.scope === 'all' ? { kind: 'all' } : { kind: sc.scope, [sc.scope]: sc.scopeData[sc.scope] };
    return { name: name.value.trim(), layoutId: Number(layout.value), zonePlaylists: Object.fromEntries(Object.entries(zp).filter(([k, v]) => ids.has(k) && v)), scope: sco,
      days: [...days].sort().join(','), timeFrom: from ?? 0, timeTo: to == null ? 1440 : to === 0 ? 1440 : to, dateFrom: df.value || null, dateTo: dt.value || null, priority: Number(prio.value) || 0 };
  };
  const preview = guard(async () => { const r = await tapi('/api/tvcorp/schedules/preview', { method: 'POST', body: { ...body(), id: s?.id ?? null } }); put(reach, previewResult(r)); });
  dialog(s ? `Grade · ${s.name}` : 'Nova grade', el('div', {},
    el('div', { class: 'tc-two' },
      el('div', { class: 'pf-grid' }, f('Nome', name), f('Layout', layout), label('Playlist de cada zona'), zonesBox),
      el('div', {}, label('Como fica na TV'), pv)),
    label('Quando'),
    el('div', { class: 'pf-checks row' }, ...ORDER.map((n) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: days.has(n), onchange: (e) => { if (e.target.checked) days.add(n); else days.delete(n); } }), el('span', { text: WEEK_SHORT[n] })))),
    el('div', { class: 'pf-grid two' }, f('Das', tf, 'Vazio nos dois: o dia todo. "22:00 às 06:00" vira a noite.'), f('Até', tt), f('Começa em (opcional)', df), f('Termina em (opcional)', dt)),
    f('Prioridade (0 a 100)', prio, 'Duas grades na mesma tela e horário: vale a de maior prioridade. Empate: a mais específica (tela, depois grupo, depois unidade, depois empresa) e, por fim, a mais nova.'),
    label('Para onde'), scope.node,
    btns(btn('Prévia: quantas telas e o que mostram agora', preview)), reach), {
    wide: true,
    save: async () => {
      const b = body();
      if (!b.name) throw new Error('Dê um nome à grade.');
      if (s) await tapi(`/api/tvcorp/schedules/${s.id}`, { method: 'PATCH', body: b }); else await tapi('/api/tvcorp/schedules', { method: 'POST', body: b });
      toast('Grade salva. As telas trocam em até 1 minuto.');
      await reload();
    },
  });
}

/** "O que cada tela mostra agora": pede a cada tela ligada (de 6 em 6). */
async function nowAll(out) {
  const devs = active();
  if (!devs.length) { put(out, empty('Nenhuma tela ainda.')); return; }
  put(out, note('Perguntando às telas…'));
  const rows = [];
  for (let i = 0; i < devs.length; i += 6) {
    const part = await Promise.all(devs.slice(i, i + 6).map((x) => tapi(`/api/tvcorp/devices/${x.id}/now`).then((r) => [x, r], () => [x, null])));
    rows.push(...part);
  }
  put(out, table(['Tela', 'Unidade', 'Grade', 'Layout', 'Itens agora'], rows.map(([x, r]) => el('tr', {},
    el('td', { text: x.name }), el('td', { text: officeOf(x.officeId)?.name || '—' }),
    el('td', { text: r?.block ? `${r.block.name}${r.block.fallback ? ' (padrão)' : ''}` : 'nenhuma (layout de sempre)' }), el('td', { text: D().layouts.find((l) => l.id === r?.block?.layoutId)?.name || '—' }),
    el('td', { text: Object.entries(r?.zones || {}).map(([z, items]) => `${z}: ${items.map((it) => it.title || it.kind).slice(0, 3).join(', ') || 'vazia'}`).join(' · ') || '—' })))));
}

export default async function paintGrade(box, ctx) {
  const d = D(); const reload = ctx.reload;
  const layoutName = (id) => d.layouts.find((l) => l.id === id)?.name || '—';
  const sorted = [...d.schedules].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const rows = sorted.map((s) => el('tr', {},
    el('td', {}, el('b', { text: s.name }), el('div', { class: 'dim small', text: layoutName(s.layoutId) })),
    el('td', { text: scopeText(s.scope?.kind, s.scope) }),
    el('td', { text: daysText(s.days) }),
    el('td', { text: (s.timeFrom == null && s.timeTo == null) || (s.timeFrom === 0 && s.timeTo === 1440) ? 'o dia todo' : `${minToHm(s.timeFrom)} às ${minToHm(s.timeTo)}` }),
    el('td', { text: s.dateFrom || s.dateTo ? `${s.dateFrom ? dayText(s.dateFrom) : 'já'} até ${s.dateTo ? dayText(s.dateTo) : 'sem fim'}` : 'sempre' }),
    el('td', { text: String(s.priority) }),
    el('td', {}, statusChip(s.status), s.isDefault ? chip('grade padrão') : null),
    el('td', { class: 'pf-actions' }, btn('Editar', () => editSchedule(s, reload), 'small'),
      s.isDefault ? null : btn('Usar como padrão', guard(async () => { await tapi('/api/tvcorp/settings', { method: 'PUT', body: { defaultSchedule: s.id } }); toast(`"${s.name}" é a grade padrão: vale quando nenhuma outra vale.`); await reload(); }), 'small'),
      btn('Apagar', guard(async () => { if (!confirm(`Apagar a grade "${s.name}"? As telas dela voltam à próxima grade que valer (ou ao layout de sempre).`)) return; await tapi(`/api/tvcorp/schedules/${s.id}`, { method: 'DELETE' }); await reload(); }), 'small danger'))));
  const nowBox = el('div', {});
  put(box,
    note('A grade junta os níveis: o que vale para a empresa toda, depois para o grupo, a unidade e a tela. Fora de qualquer grade, a tela mostra o layout de sempre (aba Telas → Editar).'),
    btns(btn('+ Nova grade', () => editSchedule(null, reload), 'primary'), el('span', { class: 'dim small', text: `${d.schedules.length} de ${LIMITS.schedules}` })),
    d.schedules.length ? weekView(sorted, (s) => editSchedule(s, reload)) : null,
    d.schedules.length ? el('div', { class: 'tc-wlegend' }, ...sorted.map((s, i) => chip(s.name, `tc-c c${i % COLORS}`))) : null,
    rows.length ? table(['Grade', 'Para onde', 'Dias', 'Horário', 'Período', 'Prioridade', 'Situação', ''], rows) : empty('Nenhuma grade ainda. Sem grade, as telas mostram o layout de sempre com o vídeo do canal.'),
    label('O que cada tela mostra agora'),
    btns(btn('Perguntar às telas', guard(() => nowAll(nowBox)))), nowBox);
}
