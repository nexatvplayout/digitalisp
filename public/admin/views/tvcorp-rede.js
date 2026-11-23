// TV Corporativa · abas Alertas e Aprovações (docs/TV-CORPORATIVA.md §2.4 e §6), pela rede de telas (/api/tvcorp/rede/*,
// as mesmas regras dos alertas e da aprovação do NEXA Telas).
//   Alertas: o comunicado urgente em tela cheia (crise, evacuação, simulado) para todas as telas, um grupo, uma unidade ou
//   um raio no mapa, com a prévia de quantas telas recebem antes de enviar.
//   Aprovações: a fila do que veio do link das unidades e do celular (comunicados, imagens, slides, grades), com a prévia,
//   aprovar ou devolver com o motivo.
import { el, guard, toast, tapi, tblob, put, f, opt, table, label, note, empty, btn, btns, chip, D, when, officeOf } from './tvcorp-base.js';
import { createMap } from '../telas-mapa.js';
import { tvPreview } from '../../shared/telas-previa.js';
import { itemPreview, slidePreview } from '../../shared/tvcorp-previa.js';
import { SEVERITIES, severityOf, LIMITS as TL } from '../../shared/telas-tipos.js';
import { postCategoryLabel } from './tvcorp-catalogo.js';
import { themeOf } from './tvcorp-midias.js';

const A = { title: '', text: '', level: 'warn', sound: true, durationMin: 30, kind: 'city', groups: [], office: '', lat: null, lng: null, meters: 500 };
const SCOPES = [['city', 'Todas as telas da empresa'], ['groups', 'Grupos de telas'], ['office', 'Uma unidade'], ['radius', 'Raio no mapa']];
const DURATIONS = [[10, '10 minutos'], [30, '30 minutos'], [60, '1 hora'], [180, '3 horas'], [720, '12 horas'], [1440, '24 horas']];
let amap = null;

function alertScope() {
  if (A.kind === 'groups') return { kind: 'groups', groups: A.groups };
  if (A.kind === 'office') return { kind: 'office', office: Number(A.office) || null };
  if (A.kind === 'radius') return { kind: 'radius', lat: A.lat, lng: A.lng, meters: Number(A.meters) };
  return { kind: 'city' };
}
const ready = (s) => s.kind === 'city' || (s.kind === 'groups' && s.groups.length > 0) || (s.kind === 'office' && s.office) || (s.kind === 'radius' && s.lat != null && s.meters >= TL.radiusMin);
const alertScopeText = (s) => (!s ? '—' : s.kind === 'city' ? 'Todas as telas' : s.kind === 'groups' ? `Grupos: ${(s.groups || []).map((id) => D().groups.find((g) => g.id === id)?.name || `#${id}`).join(', ')}`
  : s.kind === 'office' ? `Unidade: ${officeOf(s.office)?.name || `#${s.office}`}` : s.kind === 'radius' ? `Raio de ${s.meters} m` : s.kind);

export async function paintAlertas(box, ctx) {
  amap?.destroy?.(); amap = null;
  const d = D();
  const r = await tapi('/api/tvcorp/rede/alerts');
  const again = () => paintAlertas(box, ctx);
  const reach = el('p', { class: 'pf-reach', 'aria-live': 'polite' });
  const pv = el('div', {});
  const paintPv = () => put(pv, tvPreview({ alert: { level: A.level, head: severityOf(A.level).word, title: A.title || 'Título do alerta', text: A.text, foot: reach.textContent } }));
  let seq = 0;
  const paintReach = async () => {
    const s = alertScope(); const my = ++seq;
    if (!ready(s)) { reach.textContent = s.kind === 'radius' ? 'Clique no mapa para marcar o centro do raio.' : 'Escolha para onde o alerta vai.'; paintPv(); return; }
    amap?.setCircle?.(s.kind === 'radius' ? s : null);
    try { const p = await tapi('/api/tvcorp/rede/alerts/preview', { method: 'POST', body: { scope: s } }); if (my === seq) { reach.textContent = `${p.total} tela(s) em ${p.offices} unidade(s) vão receber · ${p.online} ligada(s) agora`; reach.dataset.total = String(p.total); } } catch (e) { if (my === seq) reach.textContent = e.message; }
    paintPv();
  };
  const title = el('input', { type: 'text', maxlength: String(TL.alertTitle), value: A.title, placeholder: 'Ex.: Simulado de evacuação', oninput: (e) => { A.title = e.target.value; paintPv(); } });
  const text = el('textarea', { rows: '3', maxlength: String(TL.alertText), placeholder: 'O que a pessoa deve fazer agora', oninput: (e) => { A.text = e.target.value; paintPv(); } }); text.value = A.text;
  const level = el('select', { onchange: (e) => { A.level = e.target.value; paintPv(); } }, ...SEVERITIES.map((s) => opt(s.key, `${s.label}: ${s.desc}`, A.level === s.key)));
  const sound = el('input', { type: 'checkbox', checked: A.sound, onchange: (e) => { A.sound = e.target.checked; } });
  const dur = el('select', { onchange: (e) => { A.durationMin = Number(e.target.value); } }, ...DURATIONS.map(([v, t]) => opt(v, t, A.durationMin === v)));
  const picks = el('div', { class: 'pf-scope' });
  const mapBox = el('div', { class: 'pf-mapbox small', hidden: A.kind !== 'radius' });
  const paintPicks = () => {
    mapBox.hidden = A.kind !== 'radius';
    if (A.kind === 'groups') put(picks, d.groups.length ? el('div', { class: 'pf-checks tall' }, ...d.groups.map((g) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: A.groups.includes(g.id), onchange: (e) => { A.groups = e.target.checked ? [...A.groups, g.id] : A.groups.filter((x) => x !== g.id); paintReach(); } }), el('span', { text: g.name })))) : note('Crie os grupos na aba Unidades e grupos.'));
    else if (A.kind === 'office') put(picks, f('Unidade', el('select', { onchange: (e) => { A.office = e.target.value; paintReach(); } }, opt('', 'Escolha…', !A.office), ...d.offices.map((o) => opt(o.id, o.name, String(A.office) === String(o.id))))));
    else if (A.kind === 'radius') put(picks, f('Raio em metros', el('input', { type: 'number', min: String(TL.radiusMin), max: String(TL.radiusMax), step: '100', value: String(A.meters), oninput: (e) => { A.meters = Number(e.target.value); paintReach(); } }), 'Clique no mapa para marcar o centro: recebem as telas das unidades dentro do círculo.'));
    else put(picks, note('Todas as telas da empresa, em todas as unidades.'));
    paintReach();
  };
  const scope = el('select', { onchange: (e) => { A.kind = e.target.value; paintPicks(); if (A.kind === 'radius' && !amap) openMap(); } }, ...SCOPES.map(([k, t]) => opt(k, t, A.kind === k)));
  const openMap = () => {
    try {
      amap = createMap(mapBox, { onClick: (p) => { if (A.kind !== 'radius') return; A.lat = p.lat; A.lng = p.lng; paintReach(); } });
      const pts = d.offices.filter((o) => o.lat != null).map((o) => ({ lat: o.lat, lng: o.lng }));
      amap.setPins(d.offices.filter((o) => o.lat != null).map((o) => ({ id: o.id, lat: o.lat, lng: o.lng, status: 'on', label: o.name.slice(0, 3).toUpperCase(), title: o.name })));
      if (!amap.fit(pts)) amap.setView(-14.2, -51.9, 4);
    } catch { put(mapBox, note('O mapa não abriu neste navegador.')); }
  };
  const send = guard(async () => {
    const s = alertScope();
    if (A.title.trim().length < 2) throw new Error('Escreva o título do alerta.');
    if (!ready(s)) throw new Error('Escolha para onde o alerta vai.');
    if (!confirm(`Enviar o alerta "${A.title.trim()}" agora, em tela cheia?\n${alertScopeText(s)}\n${reach.textContent}`)) return;
    const body = { title: A.title, text: A.text, level: A.level, sound: A.sound, class: 'utilidade', scope: s, durationMin: A.durationMin };
    if (A.level === 'critical') { if (!confirm(`Nível máximo. Confirmar o alerta EXTREMO para ${reach.dataset.total || 'as'} telas?`)) return; body.confirmExtreme = true; }
    const out = await tapi('/api/tvcorp/rede/alerts', { method: 'POST', body });
    toast(`Alerta enviado${out.reach ? `: ${out.reach.total} tela(s)` : ''}. Aparece em até 30 segundos.`);
    Object.assign(A, { title: '', text: '' }); await again();
  });
  const row = (x, live) => el('tr', {},
    el('td', {}, el('span', { class: `pf-level ${x.level}`, text: severityOf(x.level).label }), ' ', el('b', { text: x.title }), el('div', { class: 'dim small', text: (x.text || '').slice(0, 120) })),
    el('td', { text: alertScopeText(x.scope) }), el('td', { text: `${when(x.startsAt)} até ${when(x.until)}` }), el('td', { text: `${x.delivered ?? 0} tela(s)`, 'data-alerta': String(x.id) }), el('td', { text: x.createdBy || '—' }),
    el('td', { class: 'pf-actions' }, live ? btn('Encerrar', guard(async () => { if (!confirm(`Encerrar o alerta "${x.title}"? Sai das telas em até 30 segundos.`)) return; await tapi(`/api/tvcorp/rede/alerts/${x.id}/cancel`, { method: 'POST' }); toast('Alerta encerrado.'); await again(); }), 'small danger') : null));
  const heads = ['Alerta', 'Para onde', 'Período', 'Mostraram', 'Enviado por', ''];
  put(box,
    note('O alerta cobre a tela inteira, por cima de tudo, até o fim do prazo ou até ser encerrado. Use para o que é urgente: evacuação, simulado, falta de energia, aviso de crise. Para o dia a dia, use os comunicados (aba RH).'),
    el('div', { class: 'card pf-compose' },
      label('Novo alerta em tela cheia'),
      el('div', { class: 'pf-compose-grid' },
        el('div', { class: 'pf-grid' }, f('Título', title), f('Texto', text), el('div', { class: 'pf-grid two' }, f('Gravidade', level), f('Fica por', dur)),
          el('label', { class: 'pf-check' }, sound, el('span', { text: 'Tocar o som de alerta nas telas' })), f('Para onde', scope), picks, mapBox, reach,
          btns(btn('Enviar alerta', send, 'primary'))),
        el('div', {}, label('Como aparece na TV'), pv))),
    label('Em vigor'), (r.active || []).length ? table(heads, r.active.map((x) => row(x, true))) : empty('Nenhum alerta nas telas agora.'),
    label('Histórico'), (r.history || []).length ? table(heads, r.history.map((x) => row(x, false))) : empty('Nenhum alerta enviado ainda.'));
  // o mapa mede a caixa: só depois de a aba entrar na página
  if (A.kind === 'radius') setTimeout(openMap, 0);
  paintPicks();
  // a coluna Mostraram anda sozinha enquanto há alerta em vigor (a TV recebe segundos depois do envio); só os números mudam
  clearInterval(paintAlertas.tick);
  if ((r.active || []).length) paintAlertas.tick = setInterval(async () => {
    if (!box.isConnected) { clearInterval(paintAlertas.tick); return; }
    const n = await tapi('/api/tvcorp/rede/alerts').catch(() => null);
    for (const x of [...(n?.active || []), ...(n?.history || [])]) { const td = box.querySelector?.(`[data-alerta="${x.id}"]`); if (td) td.textContent = `${x.delivered ?? 0} tela(s)`; }
  }, 10000);
}

/* ------------------------------------------------------------------ Aprovações */
// Três filas numa tela só: as imagens, slides e grades das unidades (/api/tvcorp/approvals), os comunicados que vieram do
// link das unidades ou da integração (/api/tvcorp/posts?status=pending) e os avisos e cartões das unidades corporativas
// (/api/tvcorp/rede/approvals, a fila de sempre do NEXA Telas).
const KIND = { 'tvc-post': 'Comunicado', 'tvc-media': 'Imagem ou slide', 'tvc-schedule': 'Grade', post: 'Comunicado', avisos: 'Avisos', card: 'Cartão', alert: 'Alerta' };
const DECIDED = { approved: 'Aprovado', rejected: 'Devolvido', expired: 'Venceu', ok: 'Aprovado', superseded: 'Substituído' };
function payloadNode(a) {
  const p = a.payload || {};
  if (a.kind === 'post') return el('div', { class: 'tc-apv' }, itemPreview({ kind: 'post', category: p.category, title: p.title, body: p.text, qr: p.qr }, { theme: themeOf() }), el('div', { class: 'dim small', text: postCategoryLabel(p.category) }));
  if (a.kind === 'tvc-media') {
    const m = a.media || {};
    if (m.kind === 'slide') return el('div', { class: 'tc-apv' }, slidePreview(m.template, m.fields, { theme: themeOf() }), el('b', { text: m.title || '' }));
    const img = el('img', { class: 'tc-apv-img', alt: m.title || 'Imagem enviada', hidden: true });
    if (a.refId) tblob(`/api/tvcorp/media/${a.refId}/file`).then((u) => { if (u) { img.src = u; img.hidden = false; } }, () => {});
    return el('div', { class: 'tc-apv' }, img, el('b', { text: m.title || a.summary || 'Imagem' }));
  }
  if (a.kind === 'avisos') return el('ul', { class: 'pf-plain' }, ...(p.items || []).map((x) => el('li', { text: x })));
  return el('span', { text: a.summary || p.title || '—' });
}
export async function paintAprovacoes(box, ctx) {
  const corp = new Set(D().offices.map((o) => o.id));
  const [mine, posts, rede] = await Promise.all([
    tapi('/api/tvcorp/approvals').then((r) => r.approvals || []).catch(() => []),
    tapi('/api/tvcorp/posts').then((r) => r.posts || []).catch(() => []),
    tapi('/api/tvcorp/rede/approvals').catch(() => ({ pending: [], history: [] })),
  ]);
  const officeName = (id) => (id ? D().offices.find((o) => o.id === id)?.name || `unidade #${id}` : null);
  const fromPost = (p) => ({ id: p.id, src: 'post', kind: 'post', office: officeName(p.officeId) || (p.via === 'api' ? 'integração' : p.via === 'celular' ? 'celular' : 'painel'), requestedBy: p.createdBy, requestedAt: p.createdAt,
    status: p.status === 'pending' ? 'pending' : p.status === 'rejected' ? 'rejected' : 'ok', note: p.reason, payload: p });
  const list = [
    ...mine.map((a) => ({ ...a, src: 'tvc' })),
    ...posts.filter((p) => p.via !== 'painel').map(fromPost),
    ...[...(rede.pending || []), ...(rede.history || [])].filter((a) => !String(a.kind).startsWith('tvc-') && corp.has(a.officeId)).map((a) => ({ ...a, src: 'rede' })),
  ];
  const pending = list.filter((a) => a.status === 'pending').sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0));
  const history = list.filter((a) => a.status !== 'pending' && a.status !== 'superseded').sort((a, b) => (b.decidedAt || b.requestedAt || 0) - (a.decidedAt || a.requestedAt || 0)).slice(0, 100);
  const again = async () => { await paintAprovacoes(box, ctx); ctx.refreshBadge(); };
  const decide = (a, approve) => guard(async () => {
    let reason = '';
    if (!approve) { reason = prompt(`Devolver o pedido de "${a.office || 'unidade'}"? Escreva o motivo (quem pediu vê):`, ''); if (reason === null) return; }
    if (a.src === 'tvc') await tapi(`/api/tvcorp/approvals/${a.id}/decide`, { method: 'POST', body: { approve, note: reason } });
    else if (a.src === 'post') await tapi(`/api/tvcorp/posts/${a.id}/decide`, { method: 'POST', body: { approve, reason } });
    else await tapi(`/api/tvcorp/rede/approvals/${a.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { note: reason } });
    toast(approve ? 'Aprovado: vai às telas em até 1 minuto.' : 'Devolvido.'); await again();
  });
  const row = (a, live) => el('tr', {},
    el('td', {}, el('b', { text: a.office || 'unidade' }), el('div', { class: 'dim small', text: `${a.requestedBy || '—'} · ${when(a.requestedAt)}` })),
    el('td', {}, chip(KIND[a.kind] || a.kind)),
    el('td', {}, payloadNode(a)),
    live ? el('td', { class: 'pf-actions' }, btn('Aprovar', decide(a, true), 'small primary'), btn('Devolver', decide(a, false), 'small danger'))
      : el('td', {}, DECIDED[a.status] || a.status || '—', a.decidedBy || a.note ? el('div', { class: 'dim small', text: [a.decidedBy, a.decidedAt ? when(a.decidedAt) : '', a.note ? `"${a.note}"` : ''].filter(Boolean).join(' · ') }) : null));
  const enabled = Boolean(D().settings?.approval);
  put(box,
    note(enabled ? 'Aprovação ligada: o que as unidades publicam pelo link delas e o que chega pela integração espera aqui. O que é feito neste painel vale na hora.' : 'A aprovação está desligada: o que as unidades publicam vai direto às telas. Para ligar: aba Configurações.', enabled ? 'dim small' : 'pf-banner'),
    label(`Aguardando aprovação (${pending.length})`),
    pending.length ? table(['Quem pediu', 'Tipo', 'Prévia', ''], pending.map((a) => row(a, true))) : empty('Nada esperando.'),
    label('Histórico (quem pediu, quem decidiu e quando)'),
    history.length ? table(['Quem pediu', 'Tipo', 'Conteúdo', 'Decisão'], history.map((a) => row(a, false))) : empty('Nenhum pedido ainda.'),
    btns(btn('Configurar a aprovação', () => ctx.go('config'), 'small')));
}
