// Painel da Prefeitura (#prefeitura/<aba>, docs/PREFEITURA.md): a rede de telas do modo órgão público (TV box nas repartições), sem
// comerciais. Abas: Mapa (travado no município da prefeitura, com o contorno dele; um pino por repartição com a sigla do
// tipo e a cor pela situação das telas dela; a lateral lista as TV box, e um grupo escolhido destaca as repartições dele), Telas (chave de
// acesso, grupos e o que cada tela define), Grupos (manuais ou automáticos por tipo de repartição, com avisos e layout),
// Repartições (cadastro, ponto no mapa, módulos e o link de controle), Regiões e Alertas (com a prévia de quantas telas
// recebem). Só aparece com o modo prefeitura no plano e a permissão prefeitura.manage. O mapa é o telas-mapa.js (sem
// biblioteca de fora); o catálogo (tipos, módulos, layouts) é o public/shared/telas-tipos.js, o mesmo do servidor.
// Fases 3 e 4 (views/prefeitura-fase3.js): as abas Senhas, Cartões, Sem internet (vídeos guardados e a imagem) e Aprovações, a disponibilidade em
// Telas, o aviso do modo eleitoral e os campos novos do Padrão da prefeitura.
import { $, el, api, guard, toast, copyText, state, store } from '../lib.js';

/** O quadradinho da cor do grupo: um SVG com a cor no atributo fill (sem style inline vindo de script). */
function swatch(color) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'pf-swatch'); svg.setAttribute('viewBox', '0 0 12 12'); svg.setAttribute('aria-hidden', 'true');
  const r = document.createElementNS(ns, 'rect');
  r.setAttribute('width', '12'); r.setAttribute('height', '12'); r.setAttribute('rx', '3');
  r.setAttribute('fill', /^#[0-9a-f]{6}$/i.test(color || '') ? color : 'transparent');
  svg.append(r);
  return svg;
}
import { createMap, BRAZIL } from '../telas-mapa.js';
import { paintSenhas, paintCartoes, paintVideos, paintAprovacoes, settingsFields, electoralBanner } from './prefeitura-fase3.js';
import { officeUsers, alertKind, severityHint, alertPreview, alertTextsEditor, paintDesaparecidos, paintOcorrencias } from './prefeitura-controle.js'; // usuários da repartição, tipos de aviso e desaparecidos
import {
  OFFICE_TYPES, OFFICE_TYPE, typeLabel, typeShort, typeSigla, MODULES, LAYOUTS, LAYOUT_KEYS, layoutLabel, THEME_COLORS, THEME_MODES, SEVERITIES, severityOf, levelLabel, ALERT_SCOPES, COMMANDS,
  LIMITS, deviceStatus, STATUS_LABEL, scopeHits, EXIT_KEYS, DEFAULT_EXIT_SEQ, WIDGETS, CONTENT_CLASSES, classLabel,
} from '../../shared/telas-tipos.js';
import { insideCity, officeStatus, OFFICE_STATUS_LABEL, UF_VIEW, parseOutline, simplifyOutline } from '../../shared/telas-geo.js';
import { ufCityPicker } from '../../shared/uf-city.js'; // o mesmo seletor de UF e Município dos cadastros (lista do IBGE)
import { officeWizard, officeCard as repCard, accessResult } from './prefeitura-reparticoes.js'; // o assistente de nova repartição e a ficha

const TABS = [['mapa', 'Mapa'], ['telas', 'Telas'], ['grupos', 'Grupos'], ['reparticoes', 'Repartições'], ['regioes', 'Regiões'], ['alertas', 'Alertas'], ['desaparecidos', 'Desaparecidos'], ['ocorrencias', 'Ocorrências'], ['senhas', 'Senhas'], ['cartoes', 'Cartões'], ['videos', 'Sem internet'], ['aprovacoes', 'Aprovações']];
/** As abas que leem do servidor ao abrir (e não são redesenhadas pela volta de 10 s). */
const ASYNC_TABS = { desaparecidos: paintDesaparecidos, ocorrencias: paintOcorrencias, senhas: paintSenhas, cartoes: paintCartoes, videos: paintVideos, aprovacoes: paintAprovacoes };
const P = {
  tab: 'mapa', data: null, alerts: null, skew: 0, timer: null, map: null, sel: null, shotUrl: null,
  // o mapa: a repartição aberta na lateral, os filtros e a tela cheia (lembrados por navegador), "No mapa" de outra aba
  office: null, filter: { region: '', type: '', group: '' }, full: false, prefsOf: null, focus: false, sideSig: '',
  avail: new Map(), badge: null,
  alert: { category: null, kind: null, cls: 'utilidade', title: '', text: '', level: 'warn', sound: true, mode: 'dur', durationMin: 30, until: '', kind: 'city', regions: [], groups: [], office: '', lat: null, lng: null, meters: 1000 },
};
const POLL_MS = 10000;
const now = () => Date.now() + P.skew;

/* ------------------------------------------------------------------ dados */
async function load() {
  const d = await api('/api/prefeitura');
  P.skew = d.serverTime - Date.now();
  P.data = d;
}
const officeOf = (id) => P.data.offices.find((o) => o.id === id);
const regionOf = (id) => P.data.regions.find((r) => r.id === id);
const active = () => P.data.devices.filter((d) => !d.revokedAt);
/** Os grupos de uma tela: os manuais em que está e os automáticos do tipo da repartição dela, na ordem dos grupos. */
const groupsOf = (d) => P.data.groups.filter((g) => (g.officeType ? g.officeType === officeOf(d.officeId)?.type : d.groups.includes(g.id)));
const pointOf = (d) => { const o = officeOf(d.officeId); return d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : o && o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : null; };
const statusOf = (d) => deviceStatus(d, now());
/** O que o alcance de um alerta olha numa tela (a mesma conta do servidor: public/shared/telas-tipos.js scopeHits). */
const reachOf = (d) => { const o = officeOf(d.officeId); const p = pointOf(d); return { officeId: d.officeId, regionId: o?.regionId ?? null, groups: groupsOf(d).map((g) => g.id), lat: p?.lat, lng: p?.lng }; };

const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 172800) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dias`;
};
const when = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const sinceText = (d) => {
  const st = statusOf(d);
  if (st === 'never') return 'Nunca deu sinal';
  if (st === 'off') return `Desligada ${ago(now() - d.lastSeen)} (último sinal ${when(d.lastSeen)})`;
  return `${STATUS_LABEL[st]} desde ${when(d.onlineSince || d.lastSeen)}`;
};
const dot = (st) => el('span', { class: `pf-dot ${st}`, title: STATUS_LABEL[st] || st, 'aria-label': STATUS_LABEL[st] || st, role: 'img' });
const f = (label, input, hint) => el('label', { class: 'pf-f' }, el('span', { text: label }), input, hint ? el('small', { class: 'dim', text: hint }) : null);
const opt = (value, text, selected) => el('option', { value: String(value), text, selected: Boolean(selected) });
const table = (heads, rows) => el('div', { class: 'pf-table' }, el('table', {}, el('thead', {}, el('tr', {}, ...heads.map((h) => el('th', { text: h })))), el('tbody', {}, ...rows)));
const lines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);
const numOrNull = (v) => (String(v ?? '').trim() === '' ? null : Number(String(v).replace(',', '.')));

/** Janela (dialog) de formulário: título, corpo e Salvar/Cancelar. save() devolve false para ficar aberta. */
function dialog(title, body, { save = null, saveLabel = 'Salvar', wide = false, danger = false } = {}) {
  const dlg = el('dialog', { class: `fx-dlg pf-dlg${wide ? ' wide' : ''}` });
  const close = () => { dlg.close(); dlg.remove(); };
  const run = guard(async () => { btn.disabled = true; try { if ((await save()) !== false) close(); } finally { btn.disabled = false; } });
  const btn = el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: run }, saveLabel);
  dlg.append(...[
    el('header', { class: 'pf-dlg-head' }, el('h3', { text: title }), el('button', { class: 'btn small', type: 'button', 'aria-label': 'Fechar', onclick: close }, 'Fechar')),
    el('div', { class: 'pf-dlg-body' }, body),
    save ? el('footer', { class: 'pf-dlg-foot' }, el('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), btn) : null].filter(Boolean)); // sem o rodapé, nada de "null" escrito na janela
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close };
}
/** replaceChildren sem os vazios (um null entre os filhos sairia escrito "null" na tela). */
const put = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
const reload = async () => { await load(); paint(); };
/** O que as abas das fases 3 e 4 usam da casca. */
const ui = { data: () => P.data, table, f, opt, dialog, when, reload, refreshBadge: () => window.dispatchEvent(new Event('disp:prefeitura-badge')) };
/** A disponibilidade de cada tela (7 e 30 dias) e desde quando está como está: relida ao abrir a aba Telas. */
async function loadAvail() {
  try { const r = await api('/api/prefeitura/availability'); P.avail = new Map(r.devices.map((x) => [x.id, x])); } catch { /* fica a de antes */ }
}
const pct = (v) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);

/** Campos do que um nível define (layout, avisos, PIN, sinal reserva): devolve { node, read() } com só o que mudou de fato. */
/** Legendas da programação (contrato §14): o valor do select <-> { on, lang }; '' = não define (herda). */
const CAPTION_LANGS = [['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['fr', 'Francês'], ['de', 'Alemão'], ['it', 'Italiano'], ['zh-CN', 'Chinês'], ['ja', 'Japonês'], ['ko', 'Coreano'], ['ru', 'Russo'], ['ar', 'Árabe']];
const captionsValue = (c) => (!c ? '' : !c.on ? 'off' : `on:${c.lang || ''}`);
const captionsRead = (v) => (v === '' ? null : v === 'off' ? { on: false, lang: null } : { on: true, lang: v.slice(3) || null });
function captionsSelect(cfg, inherit) {
  const v = captionsValue(cfg.captions);
  return el('select', {}, opt('', `Não define (${inherit})`, v === ''), opt('off', 'Desligadas', v === 'off'), opt('on:', 'Ligadas, no idioma do canal', v === 'on:'),
    ...CAPTION_LANGS.map(([k, n]) => opt(`on:${k}`, `Ligadas, em ${n.toLowerCase()}`, v === `on:${k}`)));
}

function configFields(cfg, { level, pin = true, backup = false, widgets = true, captions = true, theme = true, inherit = 'herda do nível de cima' } = {}) {
  const layout = el('select', {}, opt('', `Não define (${inherit})`, !cfg.layout), ...LAYOUTS.filter((l) => LAYOUT_KEYS.includes(l.key)).map((l) => opt(l.key, `${l.label}: ${l.desc}`, cfg.layout === l.key)));
  const avisos = el('textarea', { rows: '4', maxlength: String(LIMITS.tickerItems * (LIMITS.tickerItem + 1)), placeholder: 'Um aviso por linha' });
  avisos.value = (cfg.tickerItems || []).join('\n');
  const pinIn = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: String(LIMITS.pinMax), placeholder: cfg.hasPin ? 'PIN definido (digite para trocar)' : `${LIMITS.pinMin} a ${LIMITS.pinMax} dígitos` });
  const pinOff = el('input', { type: 'checkbox' });
  const back = el('input', { type: 'url', maxlength: '500', placeholder: 'https://…/reserva.m3u8', value: cfg.backup || '' });
  // os blocos da lateral (side.widgets): nenhum marcado = herda
  const wid = new Set(cfg.widgets || []);
  const widBox = el('div', { class: 'pf-checks row' }, ...WIDGETS.map((w) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: wid.has(w.key), onchange: (e) => { if (e.target.checked) wid.add(w.key); else wid.delete(w.key); } }), el('span', { text: w.label }))));
  const cap = captions ? captionsSelect(cfg, inherit) : null;
  // o som da chamada de senha (contrato §16): bipe, falada ou bipe + falada, e o volume da fala; em branco = herda (e, sem
  // ninguém definir, vale o escolhido no aparelho; sem escolha lá, bipe + falada)
  const snd = captions ? el('select', {}, opt('', `Não define (${inherit}; sem nenhum, vale o escolhido no aparelho)`, !cfg.callSound?.mode), opt('beep', 'Bipe', cfg.callSound?.mode === 'beep'), opt('voice', 'Falada', cfg.callSound?.mode === 'voice'), opt('both', 'Bipe + falada', cfg.callSound?.mode === 'both')) : null;
  const sndVol = captions ? el('input', { type: 'number', min: '0', max: '100', step: '5', value: cfg.callSound?.volume ?? '', placeholder: '100' }) : null;
  // tema dos painéis de senha (contrato §15): a cor e o claro/escuro; os dois em branco = herda
  const thColor = el('select', {}, opt('', `Não define (${inherit})`, !cfg.theme), ...THEME_COLORS.map((c) => opt(c.hex, c.label, cfg.theme?.color === c.hex)));
  const thMode = el('select', {}, opt('', `Não define (${inherit})`, !cfg.theme), ...THEME_MODES.map((m) => opt(m.key, m.label, cfg.theme?.mode === m.key)));
  const node = el('div', { class: 'pf-grid' },
    f(`Layout ${level}`, layout),
    theme ? f(`Cor dos painéis de senha ${level}`, thColor, 'Vale nos painéis de senha novos (Senha: …, Duas filas, Últimas chamadas). De fábrica: azul.') : null,
    theme ? f(`Claro ou escuro ${level}`, thMode) : null,
    f(`Avisos ${level} (texto rolante)`, avisos, `Até ${LIMITS.tickerItems} avisos de ${LIMITS.tickerItem} letras. Vazio: ${inherit}. Comece a linha com [institucional] para o aviso que divulga ações da gestão (fica retido no período eleitoral) ou com [emergência].`),
    widgets ? el('div', { class: 'pf-f' }, el('span', { text: `Blocos da lateral ${level}` }), widBox, el('small', { class: 'dim', text: `Valem nos layouts com lateral. Nenhum marcado: ${inherit}. "Clima" pede a cidade no Padrão da prefeitura; "Senha atual" pede a chamada de senha ligada na repartição.` })) : null,
    pin ? f(`PIN de saída ${level}`, pinIn, 'O PIN destrava o aparelho no local. Só o hash fica guardado: ninguém lê o PIN depois. Tela nenhuma fica sem PIN: sem um definido, a repartição usa um sorteado ("PIN novo" em Repartições mostra um).') : null,
    pin && cfg.hasPin ? el('label', { class: 'pf-check' }, pinOff, el('span', { text: `Tirar o PIN ${level} (${inherit})` })) : null,
    backup ? f('Sinal reserva (HLS)', back, 'Outro endereço .m3u8 que a tela toca se o canal cair.') : null,
    cap ? f(`Legendas da programação ${level}`, cap, 'Hoje o ar traz a legenda em português (a do canal). Outro idioma vale quando o canal o oferecer; enquanto não oferece, a tela mostra a do canal. Quem mexe no aparelho pode trocar lá, até a próxima mudança feita aqui.') : null,
    snd ? f(`Som da chamada de senha ${level}`, snd, 'A fala diz a senha letra por letra e o guichê ("Senha A zero zero dois, consultório três"), depois do bipe. Sem voz em português no aparelho, toca só o bipe (o diagnóstico do app avisa).') : null,
    sndVol ? f(`Volume da fala ${level} (0 a 100)`, sndVol) : null);
  return {
    node,
    read() {
      const out = { layout: layout.value || null, tickerItems: lines(avisos.value) };
      if (out.tickerItems.length > LIMITS.tickerItems) throw new Error(`No máximo ${LIMITS.tickerItems} avisos.`);
      if (pin && pinOff.checked) out.pin = null; else if (pin && pinIn.value) out.pin = pinIn.value;
      if (backup) out.backup = back.value.trim() || null;
      if (widgets) out.widgets = [...wid];
      if (cap) out.captions = captionsRead(cap.value);
      if (snd) out.callSound = snd.value || sndVol.value !== '' ? { mode: snd.value || null, volume: sndVol.value === '' ? 100 : Number(sndVol.value) } : null;
      if (theme) out.theme = thColor.value || thMode.value ? { color: thColor.value || THEME_COLORS[0].hex, mode: thMode.value || 'dark' } : null;
      return out;
    },
  };
}

/* ================================================================== Mapa */
function counters(list) {
  const n = { on: 0, warn: 0, off: 0, never: 0 };
  for (const d of list) n[statusOf(d)]++;
  return n;
}
/* O que o operador escolheu no mapa fica lembrado: os filtros e a tela cheia neste navegador (localStorage, uma chave por
   cliente); a última posição dentro da cidade, nesta sessão do navegador (recarregar a página e trocar de aba mantêm; numa
   sessão nova o mapa abre com a cidade inteira). O município em si fica no servidor. */
const prefKey = () => `disp.pf.mapa.${state.me?.tenant?.slug || state.me?.tenantId || '-'}`;
function loadPrefs() {
  if (P.prefsOf === prefKey()) return;
  P.prefsOf = prefKey();
  let v = {};
  try { v = JSON.parse(store.get(prefKey()) || '{}') || {}; } catch { /* guardado fora do formato: começa do zero */ }
  P.filter = { region: String(v.region || ''), type: String(v.type || ''), group: String(v.group || '') };
  P.full = v.full === true;
}
const savePrefs = () => store.set(prefKey(), JSON.stringify({ ...P.filter, full: P.full }));
function loadView() {
  try {
    const v = JSON.parse(sessionStorage.getItem(`${prefKey()}.vista`) || 'null');
    return v && v.ibge === (P.data.municipio?.ibge ?? null) && [v.lat, v.lng, v.zoom].every(Number.isFinite) ? v : null;
  } catch { return null; }
}
function saveView(v) {
  try {
    if (v) sessionStorage.setItem(`${prefKey()}.vista`, JSON.stringify({ ibge: P.data.municipio?.ibge ?? null, lat: v.lat, lng: v.lng, zoom: v.zoom }));
    else sessionStorage.removeItem(`${prefKey()}.vista`);
  } catch { /* sem armazenamento: vale enquanto a aba está aberta */ }
}
/** O município com o contorno guardado ({ polygons, bbox }) ou null (sem município ou sem contorno ainda). */
const outlineOf = () => { const m = P.data.municipio; return m?.outline.status === 'ok' ? { polygons: m.outline.polygons, bbox: m.bbox } : null; };
/** O ponto da repartição no mapa: o dela; sem ele, o ponto próprio de alguma tela dela. */
const officePoint = (o, devs) => (o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : devs.map((d) => (d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null)).find(Boolean) || null);
const outsideCity = (p) => { const c = outlineOf(); return Boolean(p && c && !insideCity(p.lat, p.lng, c)); };
/** Cada repartição com as telas dela, o ponto, a cor do pino e o que os filtros dizem. O grupo não esconde: destaca. */
function officeRows() {
  const { region, type, group } = P.filter;
  const byOffice = new Map();
  for (const d of active()) { if (!byOffice.has(d.officeId)) byOffice.set(d.officeId, []); byOffice.get(d.officeId).push(d); }
  return P.data.offices.map((o) => {
    const devs = byOffice.get(o.id) || [];
    const point = officePoint(o, devs);
    const mine = group ? devs.filter((d) => groupsOf(d).some((g) => String(g.id) === group)) : devs;
    return {
      o, devs, point, status: officeStatus(devs.map(statusOf)), outside: outsideCity(point), inGroup: !group || mine.length > 0, groupDevs: group ? mine : [],
      shown: (!region || String(o.regionId ?? 'none') === region) && (!type || o.type === type),
    };
  });
}
/** Trocar o grupo destacado (pelo filtro ou por um grupo da lateral). */
function setGroup(v) {
  P.filter.group = v;
  const s = $('#pfGroupSel'); if (s) s.value = v;
  savePrefs(); paintMapLive(); paintMapSide();
}
const counterRow = (n, total) => el('div', { class: 'pf-counters' },
  el('div', { class: 'pf-count on' }, el('b', { text: String(n.on) }), el('span', { text: 'no ar' })),
  el('div', { class: 'pf-count warn' }, el('b', { text: String(n.warn) }), el('span', { text: 'ligadas sem imagem' })),
  el('div', { class: 'pf-count off' }, el('b', { text: String(n.off + n.never) }), el('span', { text: n.never ? `desligadas (${n.never} nunca ligaram)` : 'desligadas' })),
  el('div', { class: 'pf-count' }, el('b', { text: String(total) }), el('span', { text: 'telas' })));

function pinsOf(list) {
  return list.map((d) => ({ d, p: pointOf(d) })).filter((x) => x.p).map(({ d, p }) => ({
    id: d.id, lat: p.lat, lng: p.lng, status: statusOf(d), selected: d.id === P.sel, color: regionOf(officeOf(d.officeId)?.regionId)?.color || null,
    title: `${d.name} · ${officeOf(d.officeId)?.name || ''} · ${STATUS_LABEL[statusOf(d)]}`,
  }));
}
async function sendCommand(d, type) {
  await api(`/api/prefeitura/devices/${d.id}/commands`, { method: 'POST', body: { type } });
  toast(`${COMMANDS.find((c) => c.key === type).label}: a tela "${d.name}" recebe no próximo sinal de vida (até 10 s).`);
}
/** A última captura da tela (o JPEG vem com a sessão do painel: vira um endereço blob: só desta página). */
async function loadShot(d, img, note) {
  if (P.shotUrl) { URL.revokeObjectURL(P.shotUrl); P.shotUrl = null; }
  img.hidden = true;
  if (!d.shotAt) { note.textContent = 'Sem captura ainda. Peça uma em "Captura".'; return; }
  try {
    const res = await fetch(`/api/prefeitura/devices/${d.id}/screenshot`, { headers: { 'x-admin-token': state.token || '' }, cache: 'no-store' });
    if (!res.ok) throw new Error('captura');
    P.shotUrl = URL.createObjectURL(await res.blob());
    img.src = P.shotUrl; img.hidden = false;
    note.textContent = `Captura de ${when(d.shotAt)}`;
  } catch { note.textContent = 'Não foi possível abrir a captura.'; }
}
function deviceCard(d) {
  const o = officeOf(d.officeId); const st = statusOf(d);
  const img = el('img', { class: 'pf-shot', alt: `Captura da tela ${d.name}`, hidden: true });
  const note = el('p', { class: 'dim small' });
  loadShot(d, img, note);
  const cmd = (type, label) => el('button', { class: 'btn small', type: 'button', disabled: st === 'off' || st === 'never', title: st === 'off' || st === 'never' ? 'A tela está desligada: o comando só chega com ela ligada.' : '', onclick: guard(() => sendCommand(d, type)) }, label);
  return el('div', { class: 'pf-side-card' },
    el('div', { class: 'pf-side-head' }, dot(st), el('b', { text: d.name }), el('button', { class: 'btn small', type: 'button', onclick: () => { P.sel = null; paintMapSide(); } }, 'Fechar')),
    el('dl', { class: 'pf-dl' },
      el('dt', { text: 'Repartição' }), el('dd', { text: o ? `${o.name} · ${typeLabel(o.type)}` : '—' }),
      el('dt', { text: 'Região' }), el('dd', { text: regionOf(o?.regionId)?.name || 'sem região' }),
      el('dt', { text: 'Situação' }), el('dd', { text: sinceText(d) }),
      el('dt', { text: 'Tocando' }), el('dd', { text: d.state ? `${d.state}${d.source ? ` (${d.source})` : ''}${d.net ? ` · rede ${d.net}` : ''}` : '—' }),
      el('dt', { text: 'App' }), el('dd', { text: `${d.appVersion || '—'}${d.model ? ` · ${d.model}` : ''}${d.android ? ` · Android ${d.android}` : ''}` }),
      // o app foi reinstalado e a tela se reativou sozinha (docs/TELAS.md §32)
      d.recoveredAt ? el('dt', { text: 'Reinstalação' }) : null, d.recoveredAt ? el('dd', { text: `Instalação recuperada em ${when(d.recoveredAt)}` }) : null,
      d.lastError ? el('dt', { text: 'Último erro' }) : null, d.lastError ? el('dd', { class: 'pf-err', text: d.lastError }) : null),
    img, note,
    el('div', { class: 'pf-btns left' }, cmd('reload', 'Recarregar'), cmd('restart-app', 'Reiniciar app'), cmd('screenshot', 'Captura'),
      el('button', { class: 'btn small', type: 'button', onclick: () => editDevice(d) }, 'Editar')));
}
const selSig = (d) => (d ? `${d.id}|${statusOf(d)}|${d.shotAt}|${d.lastError}|${d.appVersion}|${d.state}` : '');
/** Uma TV box na lista da repartição: a identificação, a situação, desde quando, a versão do app e os grupos dela. */
function deviceRow(d) {
  const st = statusOf(d); const gs = groupsOf(d);
  return el('li', { class: `pf-dev${d.id === P.sel ? ' sel' : ''}` },
    el('div', { class: 'pf-dev-head' }, dot(st), el('b', { text: d.name }), el('span', { class: 'pf-id', title: 'Identificação da tela no sistema', text: `#${d.id}` })),
    el('div', { class: 'small', text: sinceText(d) }),
    el('div', { class: 'dim small', text: [`App ${d.appVersion || '—'}`, d.model, d.serial ? `série ${d.serial}` : ''].filter(Boolean).join(' · ') }),
    gs.length
      ? el('div', { class: 'pf-dev-groups' }, ...gs.map((g) => {
        const on = P.filter.group === String(g.id);
        return el('button', { class: `pf-chip pf-chip-btn${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), title: on ? 'Tirar o destaque deste grupo' : 'Destacar no mapa as repartições com telas deste grupo', onclick: () => setGroup(on ? '' : String(g.id)) }, g.name);
      }))
      : el('div', { class: 'dim small', text: 'Em nenhum grupo' }),
    el('div', { class: 'pf-btns left' }, el('button', { class: 'btn small', type: 'button', 'aria-expanded': String(d.id === P.sel), onclick: () => { P.sel = d.id === P.sel ? null : d.id; paintMapSide(); } }, d.id === P.sel ? 'Fechar a captura' : 'Captura e comandos')));
}
/** A repartição aberta na lateral: nome, endereço, tipo, região e as TV box dela. */
function officeCard(o) {
  const devs = active().filter((d) => d.officeId === o.id);
  const st = officeStatus(devs.map(statusOf)); const n = counters(devs);
  const p = officePoint(o, devs);
  const resumo = devs.length ? [`${devs.length} tela(s)`, n.on ? `${n.on} no ar` : '', n.warn ? `${n.warn} ligada(s) sem imagem` : '', n.off + n.never ? `${n.off + n.never} desligada(s)` : ''].filter(Boolean).join(' · ') : 'Nenhuma tela ativa';
  return el('div', { class: 'pf-side-card' },
    el('div', { class: 'pf-side-head' }, el('span', { class: `pf-dot ${st}`, role: 'img', title: OFFICE_STATUS_LABEL[st], 'aria-label': OFFICE_STATUS_LABEL[st] }), el('b', { text: o.name }),
      el('button', { class: 'btn small', type: 'button', onclick: () => { P.office = null; P.sel = null; paintMapSide(); paintMapLive(); } }, 'Fechar')),
    el('dl', { class: 'pf-dl' },
      el('dt', { text: 'Tipo' }), el('dd', { text: typeLabel(o.type) }),
      el('dt', { text: 'Endereço' }), el('dd', { text: o.address || 'sem endereço' }),
      el('dt', { text: 'Região' }), el('dd', { text: regionOf(o.regionId)?.name || 'sem região' }),
      o.respName || o.respContact ? el('dt', { text: 'Responsável' }) : null, o.respName || o.respContact ? el('dd', { text: [o.respName, o.respContact].filter(Boolean).join(' · ') }) : null,
      el('dt', { text: 'Telas' }), el('dd', { text: resumo })),
    outsideCity(p) ? el('p', { class: 'pf-banner', text: `Fora do município de ${P.data.municipio.name}: confira o ponto desta repartição em "Editar a repartição".` }) : null,
    p ? null : el('p', { class: 'dim small', text: 'Sem ponto no mapa: localize o endereço em "Editar a repartição".' }),
    el('div', { class: 'label', text: `TV box desta repartição (${devs.length})` }),
    devs.length ? el('ul', { class: 'pf-devs' }, ...devs.map(deviceRow)) : el('p', { class: 'dim small', text: 'Nenhuma tela ativa aqui. Gere uma chave de acesso na aba Telas.' }),
    el('div', { class: 'pf-btns left' },
      el('button', { class: 'btn small', type: 'button', onclick: () => editOffice(o) }, 'Editar a repartição'),
      p ? el('button', { class: 'btn small', type: 'button', onclick: () => { P.map?.setView(p.lat, p.lng, Math.max(P.map.view().zoom, 16)); saveView(P.map?.view()); } }, 'Aproximar') : null));
}
const sideSig = () => {
  const o = P.office != null ? officeOf(P.office) : null;
  if (!o) return '';
  return `${o.id}|${P.filter.group}|${active().filter((d) => d.officeId === o.id).map((d) => `${d.id}:${statusOf(d)}:${d.appVersion}`).join(',')}|${selSig(P.sel != null ? P.data.devices.find((x) => x.id === P.sel) : null)}`;
};
function paintMapSide() {
  const side = $('#pfMapSide'); if (!side) return;
  const o = P.office != null ? officeOf(P.office) : null;
  if (!o) { P.office = null; P.sel = null; }
  const d = o && P.sel != null ? P.data.devices.find((x) => x.id === P.sel && x.officeId === o.id && !x.revokedAt) : null;
  if (!d) P.sel = null;
  P.selSig = selSig(d); P.sideSig = sideSig();
  put(side, o ? officeCard(o) : el('p', { class: 'dim small', text: 'Clique numa repartição no mapa para ver o endereço, o tipo, a região e as TV box dela: a identificação de cada uma, se está no ar, desde quando, a versão do app e os grupos.' }),
    d ? deviceCard(d) : null);
}
/** A parte do mapa que muda sozinha (a cada 10 s e a cada filtro): contadores, pinos, o grupo destacado e os avisos. */
function paintMapLive() {
  if (!P.map || !$('#pfMapNotes')) return;
  const city = P.data.municipio;
  const rows = officeRows(); const shown = rows.filter((r) => r.shown);
  const devs = shown.flatMap((r) => r.devs);
  $('#pfCounters')?.replaceWith(Object.assign(counterRow(counters(devs), devs.length), { id: 'pfCounters' }));
  P.map.setPins(shown.filter((r) => r.point).map((r) => ({
    id: r.o.id, lat: r.point.lat, lng: r.point.lng, status: r.status, label: typeSigla(r.o.type), count: r.devs.length, selected: r.o.id === P.office,
    color: regionOf(r.o.regionId)?.color || null, cls: [r.inGroup ? '' : 'dim', r.outside ? 'out' : ''].filter(Boolean).join(' '),
    title: `${r.o.name} · ${typeLabel(r.o.type)} · ${r.devs.length} tela(s) · ${OFFICE_STATUS_LABEL[r.status]}${r.outside ? ' · fora do município' : ''}`,
  })));
  // o grupo destacado: quantas telas dele estão no ar e desligadas
  const g = P.filter.group ? P.data.groups.find((x) => String(x.id) === P.filter.group) : null;
  const notes = [];
  if (g) {
    const mine = shown.flatMap((r) => r.groupDevs); const n = counters(mine);
    notes.push(el('span', { class: 'pf-note-group' }, swatch(g.color), ' ',
      el('b', { text: `Grupo ${g.name}` }), `: ${mine.length} tela(s) em ${shown.filter((r) => r.groupDevs.length).length} repartição(ões) · `,
      el('span', { class: 'pf-n on', text: `${n.on} no ar` }), n.warn ? el('span', { class: 'pf-n warn', text: ` · ${n.warn} ligada(s) sem imagem` }) : null, el('span', { class: 'pf-n off', text: ` · ${n.off + n.never} desligada(s)` }),
      ' ', el('button', { class: 'btn small', type: 'button', onclick: () => setGroup('') }, 'Tirar o destaque')));
  }
  const out = rows.filter((r) => r.outside);
  if (out.length) notes.push(el('span', { class: 'pf-note-out', text: `${out.length} repartição(ões) fora do município` }));
  put($('#pfMapNotes'), notes);
  const lost = shown.filter((r) => !r.point);
  const n = $('#pfNoPoint'); if (n) n.textContent = lost.length ? `${lost.length} repartição(ões) sem ponto no mapa (sem endereço localizado): ${lost.slice(0, 6).map((r) => r.o.name).join(', ')}${lost.length > 6 ? '…' : ''}` : '';
  const o = $('#pfOutside');
  if (o) {
    put(o, out.length ? [el('b', { text: `Fora do município de ${city.name} (${out.length}): ` }),
      ...out.slice(0, 12).map((r) => el('button', { class: 'btn small', type: 'button', title: 'O ponto desta repartição está fora do contorno do município: abra para conferir.', onclick: () => editOffice(r.o) }, r.o.name)),
      out.length > 12 ? el('span', { class: 'dim small', text: ` e mais ${out.length - 12}` }) : null] : []);
    o.hidden = !out.length;
  }
}
/**
 * Onde um mapa abre: no município inteiro (com o contorno guardado). Sem contorno ainda: as repartições, senão o centro
 * guardado antes desta versão, senão o estado do município, senão o Brasil. restore: a última posição desta sessão.
 */
function cityView(map, { restore = false } = {}) {
  const city = P.data.municipio; const c = outlineOf();
  const kept = restore ? loadView() : null;
  if (c) { if (kept) map.setView(kept.lat, kept.lng, kept.zoom); else map.fitBounds(c.bbox); return; }
  if (kept) { map.setView(kept.lat, kept.lng, kept.zoom); return; }
  if (map.fit(P.data.offices.filter((o) => o.lat != null).map((o) => ({ lat: o.lat, lng: o.lng })))) return;
  const old = P.data.defaults.city; const uf = city ? UF_VIEW[city.uf] : null;
  if (old) map.setView(old.lat, old.lng, old.zoom || 12); else if (uf) map.setView(uf[0], uf[1], uf[2]); else map.setView(BRAZIL.lat, BRAZIL.lng, BRAZIL.zoom);
}
/** O contorno do município num mapa auxiliar (o da repartição e o do alerta): só a linha, sem trava. */
function cityOutline(map) { const c = outlineOf(); if (c) map.setOutline(c.polygons, { mask: false }); }

let citySeq = 0;
/**
 * UF + Município da prefeitura, com o seletor dos cadastros (a lista do IBGE). Devolve { node, save() }: save() grava no
 * servidor só se mudou (o servidor busca o contorno) e devolve true se gravou.
 */
/**
 * O contorno pelo navegador: o IBGE não responde a servidores fora do Brasil, mas responde ao navegador de quem está aqui.
 * O painel busca a malha (só o código do município vai ao IBGE), simplifica e manda ao servidor, que confere e guarda.
 * Devolve o município atualizado, ou null se não deu.
 */
async function outlineByBrowser(ibge) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(`https://servicodados.ibge.gov.br/api/v3/malhas/municipios/${Number(ibge)}?formato=application/vnd.geo+json`, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) return null;
    const polygons = simplifyOutline(parseOutline(await res.json()));
    const r = await api('/api/prefeitura/municipio/outline', { method: 'POST', body: { geojson: { type: 'MultiPolygon', coordinates: polygons } } });
    return r.ok ? r.municipio : null;
  } catch { return null; } finally { clearTimeout(timer); }
}
let outlineTried = null; // código do município em que o painel já tentou sozinho nesta página

function cityFields() {
  const cur = P.data.municipio;
  // já definido: fica travado (o servidor recusa a troca); só o Superadmin altera
  if (cur) {
    return {
      node: el('p', { class: 'pf-city-locked' }, el('b', { text: `${cur.name}/${cur.uf}` }), el('span', { class: 'dim small', text: ' · definido no primeiro cadastro e travado. Para trocar, fale com a equipe da plataforma.' })),
      check() {}, async save() { return false; },
    };
  }
  const uc = ufCityPicker({ uf: cur?.uf || '', cityIbge: cur?.ibge ?? null, city: cur?.name || '', idPrefix: `pfCity${++citySeq}` });
  return {
    node: el('div', { class: 'pf-grid two pf-city' }, uc.ufField, uc.cityField),
    /** Confere antes de gravar qualquer coisa (lança com a mensagem). required: o município não pode ficar vazio. */
    check({ required = false } = {}) {
      const msg = uc.validate(); if (msg) throw new Error(msg);
      const v = uc.value();
      if ((v.uf && !v.cityIbge) || (required && !v.cityIbge)) throw new Error('Escolha o estado e o município da lista.');
    },
    async save({ required = false } = {}) {
      this.check({ required });
      const v = uc.value();
      if (!v.cityIbge) return false;
      if (!confirm(`Definir ${v.city}/${v.uf} como o município desta prefeitura?

Depois de salvo ele fica travado: só a equipe da plataforma consegue trocar.`)) return false;
      const r = await api('/api/prefeitura/municipio', { method: 'PUT', body: { uf: v.uf, ibge: v.cityIbge } });
      if (r.municipio.outline.status !== 'ok') { outlineTried = r.municipio.ibge; r.municipio = (await outlineByBrowser(r.municipio.ibge)) || r.municipio; }
      P.data.municipio = r.municipio; saveView(null);
      toast(r.municipio.outline.status === 'ok' ? `Município da prefeitura: ${r.municipio.name}/${r.municipio.uf}. Contorno guardado.`
        : `Município salvo: ${r.municipio.name}/${r.municipio.uf}. O contorno não veio agora; o mapa abre na região e dá para tentar de novo.`, r.municipio.outline.status !== 'ok');
      return true;
    },
  };
}
/** Sem município escolhido: o mapa pede a escolha (uma vez), em vez de abrir no continente. */
function paintNoCity(box) {
  const city = cityFields();
  put(box, el('div', { class: 'card pf-empty' },
    el('h3', { text: 'De qual município é esta prefeitura?' }),
    el('p', { class: 'dim', text: 'Escolha o estado e o município uma vez. O mapa passa a abrir sempre na cidade inteira, com o contorno dela marcado, e fica travado nela. Confira antes de salvar: depois de definido, o município não pode ser trocado por aqui.' }),
    city.node,
    el('div', { class: 'pf-btns left' }, el('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { if (await city.save({ required: true })) paint(); }) }, 'Salvar o município')),
    el('p', { class: 'dim small', text: 'Escolheu errado? Só a equipe da plataforma (Superadmin) troca o município.' })));
}
function setFull(on) {
  P.full = Boolean(on); savePrefs();
  $('#pfBox')?.classList.toggle('pf-full', P.full && P.tab === 'mapa');
  const b = $('#pfFullBtn'); if (b) { b.textContent = P.full ? 'Sair da tela cheia' : 'Tela cheia'; b.setAttribute('aria-pressed', String(P.full)); }
}
function paintMapa(box) {
  const d = P.data; const city = d.municipio;
  if (!city) { paintNoCity(box); return; }
  // filtro lembrado que não existe mais (região, tipo ou grupo excluído): volta a "todos"
  if (P.filter.region && P.filter.region !== 'none' && !d.regions.some((r) => String(r.id) === P.filter.region)) P.filter.region = '';
  if (P.filter.type && !d.offices.some((o) => o.type === P.filter.type)) P.filter.type = '';
  if (P.filter.group && !d.groups.some((g) => String(g.id) === P.filter.group)) P.filter.group = '';
  // "No mapa" vindo da aba Telas: abre a repartição daquela tela
  if (P.sel != null) { const dv = d.devices.find((x) => x.id === P.sel && !x.revokedAt); if (dv) P.office = dv.officeId; else P.sel = null; }
  const sel = (key, first, options, onchange, id) => el('select', { id, 'aria-label': first, onchange: onchange || ((e) => { P.filter[key] = e.target.value; savePrefs(); paintMapLive(); }) }, opt('', first, !P.filter[key]), ...options.map(([v, t]) => opt(v, t, P.filter[key] === String(v))));
  const usedTypes = OFFICE_TYPES.filter((t) => d.offices.some((o) => o.type === t.key));
  const mapBox = el('div', { class: 'pf-mapbox' });
  const hasOutline = city.outline.status === 'ok';
  // sem contorno guardado: o painel tenta sozinho, uma vez por página, pelo navegador
  if (!hasOutline && outlineTried !== city.ibge) {
    outlineTried = city.ibge;
    outlineByBrowser(city.ibge).then((m) => { if (m && P.data?.municipio?.ibge === m.ibge) { P.data.municipio = m; saveView(null); if (P.tab === 'mapa') paint(); } });
  }
  const retry = guard(async () => {
    let r = await api('/api/prefeitura/municipio/outline', { method: 'POST', body: {} });
    if (!r.ok) { const m = await outlineByBrowser(city.ibge); if (m) r = { ok: true, municipio: m }; }
    d.municipio = r.municipio;
    toast(r.ok ? 'Contorno guardado.' : `O contorno ainda não veio${r.municipio.outline.error ? ` (${r.municipio.outline.error})` : ''}. Tente de novo mais tarde.`, !r.ok);
    paint();
  });
  put(box,
    el('div', { id: 'pfCounters' }),
    el('div', { class: 'pf-bar' },
      el('b', { class: 'pf-cityname', title: `Município da prefeitura (código do IBGE ${city.ibge}). Troca em Repartições → Padrão da prefeitura.`, text: `${city.name}/${city.uf}` }),
      sel('region', 'Todas as regiões', [...d.regions.map((r) => [r.id, r.name]), ['none', 'Sem região']]),
      sel('type', 'Todos os tipos', usedTypes.map((t) => [t.key, t.label])),
      sel('group', 'Destacar um grupo', d.groups.map((g) => [g.id, g.name]), (e) => setGroup(e.target.value), 'pfGroupSel'),
      el('button', { class: 'btn small', type: 'button', title: 'Volta a mostrar o município inteiro.', onclick: () => { saveView(null); cityView(P.map); } }, 'Ver a cidade inteira'),
      el('button', { class: 'btn small', type: 'button', id: 'pfFullBtn', 'aria-pressed': String(P.full), title: 'O mapa ocupa a janela inteira (Esc volta).', onclick: () => setFull(!P.full) }, P.full ? 'Sair da tela cheia' : 'Tela cheia')),
    hasOutline ? null : el('div', { class: 'pf-banner pf-bar', role: 'status' },
      el('span', { text: `Contorno de ${city.name} indisponível${city.outline.error ? ` (${city.outline.error})` : ''}. O mapa abre na região, sem a trava da cidade.` }),
      el('button', { class: 'btn small', type: 'button', onclick: retry }, 'Tentar de novo')),
    el('div', { class: 'pf-mapnotes', id: 'pfMapNotes', 'aria-live': 'polite' }),
    el('div', { class: 'pf-mapwrap' }, mapBox, el('aside', { class: 'pf-side', id: 'pfMapSide', 'aria-live': 'polite' })),
    el('p', { class: 'small pf-outside', id: 'pfOutside', hidden: true }),
    el('p', { class: 'dim small', id: 'pfNoPoint' }),
    el('p', { class: 'dim small pf-maphelp', text: 'Cada pino é uma repartição, com a sigla do tipo. Verde: todas as telas no ar. Amarelo: alguma ligada sem imagem (erro ou parada). Vermelho: alguma sem sinal de vida há mais de 2 minutos ou que nunca ligou. Cinza: sem tela. O anel em volta é a cor da região e o número, com o mapa aproximado, quantas telas a repartição tem.' }));
  box.classList.toggle('pf-full', P.full);
  P.map = createMap(mapBox, {
    onPin: (id) => { P.office = id; P.sel = null; paintMapSide(); paintMapLive(); },
    onView: (v) => saveView(v.fitted ? null : v),
  });
  // a legenda fixa das cores, no canto do mapa
  mapBox.append(el('div', { class: 'pf-map-legend pf-map-ui', role: 'note', 'aria-label': 'Legenda das cores dos pinos' },
    ...[['on', 'Todas no ar'], ['warn', 'Ligada sem imagem'], ['off', 'Alguma desligada'], ['none', 'Sem tela']].map(([k, t]) => el('span', { class: 'pf-leg' }, el('i', { class: `pf-dot ${k}` }), t))));
  if (hasOutline) { P.map.setOutline(city.outline.polygons, { mask: true }); P.map.setBounds(city.bbox); }
  cityView(P.map, { restore: true });
  if (P.focus) {
    P.focus = false;
    const o = P.office != null ? officeOf(P.office) : null; const p = o ? officePoint(o, active().filter((x) => x.officeId === o.id)) : null;
    if (p) { P.map.setView(p.lat, p.lng, Math.max(P.map.view().zoom, 15)); saveView(P.map.view()); }
  }
  paintMapLive(); paintMapSide();
}

/* ================================================================== Telas */
/** A chave de uma TV box nova. officeId: a repartição já escolhida (a ficha da repartição): a tela nasce vinculada a ela. */
function newKey(officeId = null) {
  const d = P.data;
  if (!d.offices.length) return toast('Cadastre a repartição antes (aba Repartições).', true);
  const office = el('select', { disabled: officeId != null }, ...d.offices.map((o) => opt(o.id, `${o.name} · ${typeShort(o.type)}`, o.id === officeId)));
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name), placeholder: 'Ex.: UBS Centro, recepção' });
  const out = el('div', { class: 'pf-keybox', hidden: true });
  const body = el('div', { class: 'pf-grid' }, f('Repartição', office), f('Nome da tela (opcional)', name, 'Sem nome, a tela leva o nome da repartição.'), out);
  dialog(officeId != null ? `Cadastrar TV box · ${officeOf(officeId)?.name || ''}` : 'Gerar chave de acesso', body, {
    saveLabel: 'Gerar chave',
    save: async () => {
      const k = await api('/api/prefeitura/keys', { method: 'POST', body: { officeId: Number(office.value), name: name.value } });
      out.hidden = false;
      out.replaceChildren(
        el('p', { class: 'dim small', text: 'Digite esta chave na TV box. Ela aparece só agora, vale para UMA tela e vence em 24 horas.' }),
        el('div', { class: 'pf-key', text: k.key }),
        el('p', { class: 'dim small', text: `Vence em ${when(k.expiresAt)}.` }),
        el('button', { class: 'btn small', type: 'button', onclick: () => copyText(k.key) }, 'Copiar a chave'));
      await load(); paint();
      return false; // a janela fica aberta com a chave
    },
  });
}
function editDevice(d) {
  const data = P.data;
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name), value: d.name });
  const office = el('select', {}, ...data.offices.map((o) => opt(o.id, `${o.name} · ${typeShort(o.type)}`, o.id === d.officeId)));
  const manual = data.groups.filter((g) => !g.officeType);
  const picks = new Set(d.groups);
  const autos = groupsOf(d).filter((g) => g.officeType);
  const lat = el('input', { type: 'text', inputmode: 'decimal', value: d.lat ?? '', placeholder: 'latitude' });
  const lng = el('input', { type: 'text', inputmode: 'decimal', value: d.lng ?? '', placeholder: 'longitude' });
  const cfg = configFields(d.config, { level: 'só desta tela', backup: true, inherit: 'segue os grupos, a repartição e o padrão' });
  // comunicação interna (docs/TELAS.md §25): a tela só de funcionários e o setor dela (os setores são da repartição)
  const internal = el('input', { type: 'checkbox', checked: Boolean(d.internal) });
  const sector = el('select', {}, opt('', 'Sem setor (recebe todos os avisos internos da repartição)', !d.sectorId));
  const intNote = el('small', { class: 'dim', text: '' });
  const loadSectors = () => api(`/api/prefeitura/offices/${office.value}/sectors`).then((r) => {
    sector.replaceChildren(opt('', 'Sem setor (recebe todos os avisos internos da repartição)', !d.sectorId), ...r.sectors.map((s) => opt(s.id, s.name, s.id === d.sectorId && Number(office.value) === d.officeId)));
    intNote.textContent = r.on ? 'A tela interna mostra os avisos da direção, a escala e os códigos de emergência. Nada disso vai às telas públicas. Os setores se criam no painel da repartição (Comunicação interna).' : 'A comunicação interna está desligada nesta repartição (Repartições → Editar → Módulos).';
  }).catch(() => {});
  office.addEventListener('change', loadSectors); loadSectors();
  const body = el('div', {},
    el('div', { class: 'pf-grid' }, f('Nome da tela', name), f('Repartição', office)),
    el('div', { class: 'pf-grid' }, el('label', { class: 'pf-check' }, internal, el('span', { text: 'Tela interna (só funcionários: posto de enfermagem, repouso, copa)' })), f('Setor da tela interna', sector)),
    intNote,
    el('div', { class: 'label', text: 'Grupos desta tela' }),
    manual.length ? el('div', { class: 'pf-checks' }, ...manual.map((g) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: picks.has(g.id), onchange: (e) => { if (e.target.checked) picks.add(g.id); else picks.delete(g.id); } }), el('span', { text: g.name }))))
      : el('p', { class: 'dim small', text: 'Nenhum grupo manual ainda (aba Grupos).' }),
    autos.length ? el('p', { class: 'dim small', text: `Automáticos pelo tipo da repartição: ${autos.map((g) => g.name).join(', ')}.` }) : null,
    el('div', { class: 'label', text: 'O que só esta tela define (vence os grupos, a repartição e o padrão)' }),
    cfg.node,
    el('div', { class: 'label', text: 'Ponto próprio no mapa (vazio = o da repartição)' }),
    el('div', { class: 'pf-grid two' }, f('Latitude', lat), f('Longitude', lng)));
  dialog(`Tela · ${d.name}`, body, {
    wide: true,
    save: async () => {
      await api(`/api/prefeitura/devices/${d.id}`, { method: 'PATCH', body: { name: name.value, officeId: Number(office.value), groups: [...picks], config: cfg.read(), lat: numOrNull(lat.value), lng: numOrNull(lng.value) } });
      if (internal.checked !== Boolean(d.internal) || (internal.checked && Number(sector.value || 0) !== (d.sectorId || 0)) || Number(office.value) !== d.officeId) {
        await api(`/api/prefeitura/devices/${d.id}/internal`, { method: 'PATCH', body: { internal: internal.checked, sectorId: internal.checked && sector.value ? Number(sector.value) : null } });
      }
      toast('Tela salva. Ela troca em até 10 segundos.');
      await reload();
    },
  });
}
function paintTelas(box) {
  const d = P.data;
  const rows = d.devices.map((x) => {
    const o = officeOf(x.officeId); const st = statusOf(x);
    const own = [x.config.layout ? `layout ${layoutLabel(x.config.layout)}` : '', x.config.tickerItems?.length ? `${x.config.tickerItems.length} aviso(s)` : '', x.config.hasPin ? 'PIN' : '', x.config.backup ? 'reserva' : ''].filter(Boolean);
    return el('tr', { class: x.revokedAt ? 'pf-gone' : '' },
      el('td', {}, dot(st), ' ', el('b', { text: x.name }), own.length ? el('div', { class: 'dim small', text: `próprio: ${own.join(', ')}` }) : null),
      el('td', { text: STATUS_LABEL[st] }),
      el('td', {}, o?.name || '—', el('div', { class: 'dim small', text: o ? typeShort(o.type) : '' })),
      el('td', { text: regionOf(o?.regionId)?.name || '—' }),
      el('td', {}, ...groupsOf(x).map((g) => el('span', { class: 'pf-chip', text: g.name, title: g.officeType ? 'Grupo automático pelo tipo da repartição' : 'Grupo manual' }))),
      el('td', { text: x.appVersion || '—' }),
      el('td', { text: x.lastSeen ? `${when(x.lastSeen)} (${ago(now() - x.lastSeen)})` : 'nunca' }),
      el('td', { title: 'Tempo no ar sobre o tempo acompanhado, nos últimos 7 e 30 dias' }, x.revokedAt ? '—' : `${pct(P.avail.get(x.id)?.d7)} · ${pct(P.avail.get(x.id)?.d30)}`,
        st === 'off' ? el('div', { class: 'pf-err small', text: `desligada ${ago(now() - (P.avail.get(x.id)?.status === 'off' ? P.avail.get(x.id).since : x.lastSeen))}` }) : null),
      el('td', { class: 'pf-actions' },
        x.revokedAt ? null : el('button', { class: 'btn small', type: 'button', onclick: () => editDevice(x) }, 'Editar'),
        x.revokedAt ? null : el('button', { class: 'btn small', type: 'button', onclick: () => { P.sel = x.id; P.focus = true; location.hash = '#prefeitura/mapa'; } }, 'No mapa'),
        x.revokedAt
          ? el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Excluir a tela revogada "${x.name}" da lista?`)) return; await api(`/api/prefeitura/devices/${x.id}`, { method: 'DELETE' }); await reload(); }) }, 'Excluir')
          : el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Revogar a tela "${x.name}"? O aparelho perde o acesso e volta à tela da chave. Para religar, gere outra chave.`)) return; await api(`/api/prefeitura/devices/${x.id}/revoke`, { method: 'POST' }); toast('Tela revogada.'); await reload(); }) }, 'Revogar')));
  });
  const keys = d.keys.map((k) => el('tr', {},
    el('td', { text: officeOf(k.officeId)?.name || '—' }), el('td', { text: k.deviceName || '—' }), el('td', { text: when(k.expiresAt) }), el('td', { text: k.createdBy || '—' }),
    el('td', { class: 'pf-actions' }, el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { await api(`/api/prefeitura/keys/${k.id}`, { method: 'DELETE' }); await reload(); }) }, 'Apagar'))));
  put(box, 
    Object.assign(counterRow(counters(active()), active().length), { id: 'pfCounters' }),
    el('div', { class: 'pf-btns left' }, el('button', { class: 'btn primary', type: 'button', onclick: newKey }, 'Gerar chave de acesso'),
      el('span', { class: 'dim small', text: 'Cada TV box entra na rede com uma chave de uso único (24 h), já ligada à repartição.' })),
    keys.length ? el('div', {}, el('div', { class: 'label', text: 'Chaves esperando uso (a chave em si só aparece ao gerar)' }), table(['Repartição', 'Nome da tela', 'Vence', 'Gerada por', ''], keys)) : null,
    rows.length ? table(['Tela', 'Situação', 'Repartição', 'Região', 'Grupos', 'App', 'Último sinal', 'No ar (7 · 30 dias)', ''], rows) : el('p', { class: 'dim', text: 'Nenhuma tela ainda. Gere uma chave de acesso e digite-a na TV box.' }));
}

/* ================================================================== Grupos */
function editGroup(g) {
  const d = P.data;
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name), value: g?.name || '' });
  const color = el('input', { type: 'color', value: g?.color || '#4f8fd6' });
  const useColor = el('input', { type: 'checkbox', checked: Boolean(g?.color) });
  const desc = el('input', { type: 'text', maxlength: String(LIMITS.description), value: g?.description || '' });
  const kind = el('select', {}, opt('', 'Manual: escolho as telas', !g?.officeType), ...OFFICE_TYPES.filter((t) => !t.corp || d.offices.some((o) => o.type === t.key)).map((t) => opt(t.key, `Automático: todas as telas de ${t.label}`, g?.officeType === t.key)));
  const sort = el('input', { type: 'number', min: '-999', max: '999', step: '1', value: String(g?.sort ?? 0) });
  const cfg = configFields(g?.config || {}, { level: 'do grupo', pin: false, widgets: false, captions: false, theme: false, inherit: 'segue a repartição e o padrão' });
  const picks = new Set(g?.deviceIds || []);
  const list = el('div', { class: 'pf-checks tall' }, ...active().map((x) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: picks.has(x.id), onchange: (e) => { if (e.target.checked) picks.add(x.id); else picks.delete(x.id); } }), el('span', { text: `${x.name} · ${officeOf(x.officeId)?.name || ''}` }))));
  const manualBox = el('div', {}, el('div', { class: 'label', text: 'Telas do grupo' }), active().length ? list : el('p', { class: 'dim small', text: 'Nenhuma tela ativa ainda.' }));
  const sync = () => { manualBox.hidden = Boolean(kind.value); };
  kind.addEventListener('change', sync); sync();
  const body = el('div', {},
    el('div', { class: 'pf-grid' }, f('Nome do grupo', name), f('Descrição', desc), f('Como entram as telas', kind),
      f('Ordem', sort, 'Tela em vários grupos: os avisos saem na ordem dos grupos (menor primeiro) e vale o layout do primeiro grupo que define um.'),
      el('label', { class: 'pf-check' }, useColor, el('span', { text: 'Cor do grupo' }), color)),
    manualBox,
    el('div', { class: 'label', text: 'O que o grupo define nas telas dele (vence a repartição e o padrão; a tela vence o grupo)' }),
    cfg.node);
  dialog(g ? `Grupo · ${g.name}` : 'Novo grupo', body, {
    wide: true,
    save: async () => {
      const b = { name: name.value, description: desc.value, color: useColor.checked ? color.value : null, officeType: kind.value || null, sort: Number(sort.value) || 0, config: cfg.read() };
      if (!kind.value) b.deviceIds = [...picks];
      if (g) await api(`/api/prefeitura/groups/${g.id}`, { method: 'PATCH', body: b }); else await api('/api/prefeitura/groups', { method: 'POST', body: b });
      toast('Grupo salvo. As telas dele trocam em até 10 segundos.');
      await reload();
    },
  });
}
function paintGrupos(box) {
  const d = P.data;
  const rows = d.groups.map((g) => {
    const mine = active().filter((x) => groupsOf(x).some((y) => y.id === g.id));
    const n = counters(mine);
    const def = [g.config.layout ? `layout ${layoutLabel(g.config.layout)}` : '', g.config.tickerItems?.length ? `${g.config.tickerItems.length} aviso(s)` : ''].filter(Boolean);
    return el('tr', {},
      el('td', {}, swatch(g.color), ' ', el('b', { text: g.name }), g.description ? el('div', { class: 'dim small', text: g.description }) : null),
      el('td', { text: g.officeType ? `Automático · ${typeLabel(g.officeType)}` : 'Manual' }),
      el('td', {}, el('b', { text: String(mine.length) }), el('div', { class: 'small' }, el('span', { class: 'pf-n on', text: `${n.on} no ar` }), n.warn ? el('span', { class: 'pf-n warn', text: ` · ${n.warn} sem imagem` }) : null, el('span', { class: 'pf-n off', text: ` · ${n.off + n.never} desligada(s)` }))),
      el('td', { text: def.join(', ') || '—' }),
      el('td', { text: String(g.sort) }),
      el('td', { class: 'pf-actions' },
        el('button', { class: 'btn small', type: 'button', onclick: () => editGroup(g) }, 'Editar'),
        el('button', { class: 'btn small', type: 'button', title: 'Abre o mapa com as repartições deste grupo destacadas.', onclick: () => { P.filter = { region: '', type: '', group: String(g.id) }; savePrefs(); location.hash = '#prefeitura/mapa'; } }, 'No mapa'),
        el('button', { class: 'btn small', type: 'button', onclick: () => { Object.assign(P.alert, { kind: 'groups', groups: [g.id] }); location.hash = '#prefeitura/alertas'; } }, 'Alerta'),
        el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Excluir o grupo "${g.name}"? As telas ficam; só deixam de receber o que era do grupo.`)) return; await api(`/api/prefeitura/groups/${g.id}`, { method: 'DELETE' }); await reload(); }) }, 'Excluir')));
  });
  put(box, 
    el('p', { class: 'dim small', text: 'Um grupo junta telas para receber a mesma informação: avisos, layout e alertas só para ele. Manual: você escolhe as telas (uma tela pode estar em vários). Automático: todas as telas das repartições de um tipo (as escolas, as UBS…), sem escolher uma a uma.' }),
    el('div', { class: 'pf-btns left' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => editGroup(null) }, '+ Novo grupo'),
      el('button', { class: 'btn', type: 'button', onclick: guard(async () => { const r = await api('/api/prefeitura/groups/auto', { method: 'POST', body: {} }); toast(r.created.length ? `${r.created.length} grupo(s) automático(s) criado(s).` : 'Todos os tipos em uso já têm o grupo automático.'); await reload(); }) }, 'Criar os grupos automáticos por tipo')),
    rows.length ? table(['Grupo', 'Tipo', 'Telas', 'Define', 'Ordem', ''], rows) : el('p', { class: 'dim', text: 'Nenhum grupo ainda.' }));
}

/* ================================================================== Repartições */
/** preset (o assistente, passo 2): { type, layout }; ao criar, gera o link e a senha e mostra o passo 3. */
function editOffice(o, preset = null) {
  const d = P.data;
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name), value: o?.name || '' });
  const type = el('select', {}, ...OFFICE_TYPES.filter((t) => !t.corp || t.key === o?.type).map((t) => opt(t.key, t.label, (o?.type || preset?.type || 'outro') === t.key)));
  const address = el('input', { type: 'text', maxlength: String(LIMITS.address), value: o?.address || '', placeholder: 'Rua, número, bairro, cidade' });
  const region = el('select', {}, opt('', 'Sem região', !o?.regionId), ...d.regions.map((r) => opt(r.id, r.name, o?.regionId === r.id)));
  const channel = el('select', {}, opt('', 'O primeiro canal ao vivo da prefeitura', !o?.channelId), ...d.channels.map((c) => opt(c.id, c.name, o?.channelId === c.id)));
  const respName = el('input', { type: 'text', maxlength: String(LIMITS.contact), value: o?.respName || '' });
  const respContact = el('input', { type: 'text', maxlength: String(LIMITS.contact), value: o?.respContact || '', placeholder: 'telefone ou e-mail' });
  let point = o && o.lat != null ? { lat: o.lat, lng: o.lng } : null;
  const pointNote = el('span', { class: 'dim small' });
  const mapBox = el('div', { class: 'pf-mapbox small' });
  const results = el('div', { class: 'pf-results' });
  const mods = { ...(o?.modules || {}) };
  const modBox = el('div', { class: 'pf-checks' });
  const paintMods = () => {
    const def = OFFICE_TYPE[type.value].modules;
    modBox.replaceChildren(...MODULES.filter((m) => def.includes(m.key) || (!m.soon && !m.fixed && !m.tenant)).map((m) => el('label', { class: 'pf-check', title: m.desc },
      el('input', { type: 'checkbox', checked: m.tenant ? Boolean(d.defaults.approval) : m.fixed || (!m.soon && (mods[m.key] ?? def.includes(m.key))), disabled: Boolean(m.fixed || m.soon || m.tenant), onchange: (e) => { mods[m.key] = e.target.checked; } }),
      el('span', { text: `${m.label}${m.soon ? ' (em breve)' : m.fixed ? ' (sempre)' : m.tenant ? ' (da prefeitura inteira: Padrão da prefeitura)' : ''}` }))));
  };
  type.addEventListener('change', paintMods); paintMods();
  const cfg = configFields(o?.config || (preset?.layout ? { layout: preset.layout } : {}), { level: 'da repartição', inherit: 'segue o padrão da prefeitura' });
  const setPoint = (p, move = false) => {
    point = p;
    const out = outsideCity(p);
    pointNote.textContent = p ? `Ponto: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} (arraste o marcador ou clique no mapa para ajustar)${out ? `. Atenção: este ponto fica fora do município de ${d.municipio.name}.` : ''}` : 'Sem ponto: clique no mapa ou use "Localizar no mapa".';
    pointNote.className = out ? 'pf-err small' : 'dim small';
    map.setMarker(p ? { ...p, draggable: true, onChange: (q) => setPoint(q) } : null);
    if (p && move) map.setView(p.lat, p.lng, Math.max(map.view().zoom, 16));
  };
  const find = guard(async () => {
    const q = address.value.trim();
    if (q.length < 3) return toast('Escreva o endereço ou a cidade.', true);
    const r = await api(`/api/prefeitura/geocode?q=${encodeURIComponent(q)}`);
    results.replaceChildren(...(r.results.length ? r.results.map((x) => el('button', { class: 'btn small', type: 'button', onclick: () => { setPoint({ lat: x.lat, lng: x.lng }, true); results.replaceChildren(); } }, x.name))
      : [el('span', { class: 'dim small', text: 'Nada encontrado com esse texto. Confira o nome da rua, ou tente só o bairro, e depois arraste o marcador até o prédio.' })]));
  });
  const body = el('div', {},
    el('div', { class: 'pf-grid' }, f('Nome', name), f('Tipo', type), f('Região', region), d.channels.length > 1 ? f('Canal ao vivo (HLS) que as telas tocam', channel) : null,
      f('Responsável', respName), f('Contato do responsável', respContact)),
    el('div', { class: 'pf-addr' }, f('Endereço', address), el('button', { class: 'btn', type: 'button', onclick: find }, 'Localizar no mapa'),
      el('button', { class: 'btn', type: 'button', onclick: () => setPoint(null) }, 'Tirar o ponto')),
    results, mapBox, pointNote,
    el('div', { class: 'label', text: 'Módulos' }), modBox,
    el('div', { class: 'label', text: 'O que a repartição define nas telas dela (vence o padrão; os grupos e a tela vencem a repartição)' }), cfg.node);
  const map = createMap(mapBox, { onClick: (p) => setPoint(p) });
  const save = async () => {
    const b = {
      name: name.value, type: type.value, address: address.value, regionId: region.value ? Number(region.value) : null, respName: respName.value, respContact: respContact.value,
      lat: point?.lat ?? null, lng: point?.lng ?? null, modules: Object.fromEntries(Object.entries(mods).filter(([, v]) => typeof v === 'boolean')), config: cfg.read(),
      ...(d.channels.length > 1 ? { channelId: channel.value ? Number(channel.value) : null } : {}),
    };
    const r = o ? await api(`/api/prefeitura/offices/${o.id}`, { method: 'PATCH', body: b }) : await api('/api/prefeitura/offices', { method: 'POST', body: b });
    toast(outsideCity(point) ? `Repartição salva, mas o ponto dela fica fora do município de ${d.municipio.name}: ela aparece no mapa com o aviso "fora do município".` : 'Repartição salva.', outsideCity(point));
    // o assistente (passo 3): o link e a senha do painel da repartição, gerados já, com o olho e o copiar
    const access = !o && preset ? await api(`/api/prefeitura/offices/${r.id}/link`, { method: 'POST', body: { generate: true } }) : null;
    await reload();
    // o PIN sorteado sai na mesma janela do passo 3 (duas janelas empilhadas escondiam o link e a senha)
    if (access) setTimeout(() => accessResult(ui, { ...access.office, users: 0 }, { url: access.url, password: access.password }, { addBox: (x) => newKey(x.id), pin: r.generatedPin || null }), 0);
    else if (r.generatedPin) setTimeout(() => showPin(r.name, r.generatedPin), 0); // sem PIN na repartição nem no padrão: o servidor sorteou um
  };
  dialog(o ? `Repartição · ${o.name}` : preset ? 'Nova repartição · 2 de 3: nome, endereço e mapa' : 'Nova repartição', body, { wide: true, save });
  // o mapa só mede a caixa depois de a janela abrir
  map.render();
  // o seletor de ponto também abre na cidade (com o contorno dela); com o ponto já marcado, abre nele
  cityOutline(map);
  if (point) map.setView(point.lat, point.lng, 16); else cityView(map);
  setPoint(point);
}
/** O PIN sorteado aparece UMA vez (só o hash fica guardado). */
function showPin(name, pin) {
  dialog(`PIN de saída · ${name}`, el('div', { class: 'pf-keybox' },
    el('p', { class: 'dim small', text: 'Este é o PIN que destrava as telas desta repartição no local (depois da sequência de saída no controle remoto). Ele aparece só agora: anote e passe ao responsável. Só o hash fica guardado; se perder, gere outro.' }),
    el('div', { class: 'pf-key', text: pin }),
    el('button', { class: 'btn small', type: 'button', onclick: () => copyText(pin) }, 'Copiar o PIN')));
}
function officeLink(o) {
  const pass = el('input', { type: 'password', autocomplete: 'new-password', maxlength: String(LIMITS.linkPasswordMax), placeholder: `${LIMITS.linkPasswordMin} letras ou mais` });
  const out = el('div', { class: 'pf-keybox', hidden: true });
  const call = (fn) => guard(async () => { await fn(); await load(); paintReparticoes($('#pfBox')); });
  const body = el('div', { class: 'pf-grid' },
    el('p', { class: 'dim small', text: `O link de controle abre uma página só de "${o.name}": a situação das telas dela, os avisos e o formato da tela${OFFICE_TYPE[o.type]?.alertScope === 'wide' ? ', e os alertas para a cidade, regiões e grupos (por ser SECOM ou Defesa Civil)' : ' e o alerta nas próprias telas'}. Quem abre precisa do link E da senha. Nada mais do painel fica ao alcance.` }),
    el('p', { class: 'small', text: o.link.on ? `Link ligado desde ${when(o.link.at)}. O endereço não fica guardado: se perdeu, gere outro (o anterior deixa de valer).` : 'Esta repartição ainda não tem link de controle.' }),
    f(o.link.on ? 'Senha nova (vazio = a senha continua)' : 'Senha do link', pass, 'Passe a senha por outro caminho que não o do link (por telefone, por exemplo).'),
    el('div', { class: 'pf-btns left' },
      el('button', { class: 'btn primary', type: 'button', onclick: call(async () => {
        const r = await api(`/api/prefeitura/offices/${o.id}/link`, { method: 'POST', body: { password: pass.value } });
        o.link = r.office.link; pass.value = '';
        out.hidden = false;
        out.replaceChildren(el('p', { class: 'dim small', text: 'O link aparece só agora. Copie e mande ao responsável:' }), el('div', { class: 'pf-url', text: r.url }), el('button', { class: 'btn small', type: 'button', onclick: () => copyText(r.url) }, 'Copiar o link'));
      }) }, o.link.on ? 'Gerar outro link' : 'Gerar o link'),
      o.link.on ? el('button', { class: 'btn', type: 'button', onclick: call(async () => { await api(`/api/prefeitura/offices/${o.id}/link/password`, { method: 'PUT', body: { password: pass.value } }); pass.value = ''; toast('Senha trocada. Quem estava com a página aberta precisa entrar de novo.'); }) }, 'Só trocar a senha') : null,
      o.link.on ? el('button', { class: 'btn danger', type: 'button', onclick: call(async () => { if (!confirm(`Desligar o link de controle de "${o.name}"?`)) return; await api(`/api/prefeitura/offices/${o.id}/link`, { method: 'DELETE' }); toast('Link desligado.'); w.close(); }) }, 'Desligar o link') : null),
    out);
  const w = dialog(`Link de controle · ${o.name}`, body);
}
function editDefaults() {
  const c = P.data.defaults.config;
  const cfg = configFields(c, { level: 'padrão da prefeitura', inherit: 'fica o de fábrica' });
  const seq = el('input', { type: 'text', value: (c.exitSeq || DEFAULT_EXIT_SEQ).join(' '), placeholder: DEFAULT_EXIT_SEQ.join(' ') });
  const sch = c.schedule;
  const on = el('input', { type: 'time', value: sch?.tvOn || '' }); const offT = el('input', { type: 'time', value: sch?.tvOff || '' });
  // dias do contrato: 0 = domingo … 6 = sábado; nenhum marcado = todos os dias
  const days = new Set(sch ? sch.days : [1, 2, 3, 4, 5]);
  const dayBox = el('div', { class: 'pf-checks row' }, ...[['seg', 1], ['ter', 2], ['qua', 3], ['qui', 4], ['sex', 5], ['sáb', 6], ['dom', 0]].map(([t, n]) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: days.has(n), onchange: (e) => { if (e.target.checked) days.add(n); else days.delete(n); } }), el('span', { text: t }))));
  const up = P.data.defaults.update;
  const upUrl = el('input', { type: 'url', maxlength: '500', placeholder: 'https://…/telas.apk', value: up?.url || '' });
  const upSha = el('input', { type: 'text', maxlength: '64', placeholder: '64 caracteres hexadecimais', value: up?.sha256 || '' });
  const upCode = el('input', { type: 'number', min: '1', step: '1', value: up ? String(up.versionCode) : '' });
  const extra = settingsFields(ui, P.data.defaults);
  const kinds = alertTextsEditor(ui, P.data.defaults);
  const city = cityFields();
  const body = el('div', {},
    el('div', { class: 'label', text: 'Município da prefeitura' }), city.node,
    el('p', { class: 'dim small', text: 'O mapa abre sempre neste município, com o contorno dele, e fica travado nele.' }),
    cfg.node, extra.node, kinds.node,
    el('div', { class: 'pf-grid' },
      f('Sequência de saída no controle remoto', seq, `De ${LIMITS.exitSeqMin} a ${LIMITS.exitSeqMax} teclas entre ${EXIT_KEYS.join(', ')}, separadas por espaço. Depois dela o aparelho pede o PIN.`),
      el('div', { class: 'pf-grid two' }, f('Ligar a TV às', on), f('Desligar às', offT)), el('div', {}, el('div', { class: 'label', text: 'Dias (sem horário = a TV fica sempre ligada; nenhum dia marcado = todos os dias)' }), dayBox)),
    el('div', { class: 'label', text: 'Atualização do app das telas (opcional)' }),
    el('p', { class: 'dim small', text: P.data.appLatest
      ? `Versão do app disponível: ${P.data.appLatest.versionName || P.data.appLatest.versionCode} (versionCode ${P.data.appLatest.versionCode}). Sem endereço próprio abaixo, as telas com versão menor atualizam sozinhas por ela.`
      : 'Este servidor não tem o APK do app das telas: só atualizam as telas se um endereço for definido abaixo.' }),
    el('div', { class: 'pf-grid' }, f('Endereço do APK (https)', upUrl, 'Opcional: um APK próprio da prefeitura. As telas com versão menor baixam, conferem o SHA-256 e instalam. Vazio = a versão disponível acima.'), f('SHA-256 do APK', upSha), f('versionCode', upCode)));
  dialog('Padrão da prefeitura', body, {
    wide: true,
    save: async () => {
      const keys = seq.value.trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
      const config = { ...cfg.read(), exitSeq: keys.length ? keys : null, schedule: on.value && offT.value ? { tvOn: on.value, tvOff: offT.value, days: [...days] } : null };
      const update = upUrl.value.trim() ? { url: upUrl.value.trim(), sha256: upSha.value.trim(), versionCode: Number(upCode.value) } : null;
      const more = { ...extra.read(), ...kinds.read() };
      city.check();
      P.data.defaults = await api('/api/prefeitura/defaults', { method: 'PUT', body: { config, update, ...more } });
      const moved = await city.save();
      if (!moved) toast('Padrão salvo. Vale em toda tela que não tem nada mais específico.');
      paint();
    },
  });
}
function paintReparticoes(box) {
  const d = P.data;
  // a ficha de cada repartição (views/prefeitura-reparticoes.js): tipo, layout, link e senha do painel com o olho, as TV box
  // vinculadas e, nas de emergência, o alcance dos alertas
  const cards = d.offices.map((o) => repCard(ui, o, {
    now, regionName: (id) => regionOf(id)?.name || null,
    editOffice: (x) => editOffice(x), officeUsers: (x) => officeUsers(ui, x), addBox: (x) => newKey(x.id), editDevice, officeLink,
    newPin: guard(async () => { if (!confirm(`Gerar um PIN de saída novo para as TV box de "${o.name}"? É o PIN que destrava a TV box no local (não é a senha do painel). O de antes deixa de valer nas telas dela em até 10 segundos.`)) return; const r = await api(`/api/prefeitura/offices/${o.id}/pin`, { method: 'POST', body: {} }); await reload(); showPin(o.name, r.pin); }),
    remove: guard(async () => { if (!confirm(`Excluir a repartição "${o.name}"?`)) return; await api(`/api/prefeitura/offices/${o.id}`, { method: 'DELETE' }); await reload(); }),
  }));
  const c = d.defaults.config;
  put(box,
    el('div', { class: 'pf-btns left' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => officeWizard(ui, (preset) => editOffice(null, preset)) }, '+ Nova repartição'),
      el('button', { class: 'btn', type: 'button', onclick: editDefaults }, 'Padrão da prefeitura…'),
      el('span', { class: 'dim small', text: `Padrão: layout ${layoutLabel(c.layout || 'full')}, ${c.tickerItems?.length || 0} aviso(s) geral(is), ${c.hasPin ? 'com PIN padrão' : 'sem PIN padrão (cada repartição tem o seu, sorteado ao criar)'}.` })),
    el('p', { class: 'dim small', text: 'O que cada tela mostra sai nesta ordem: o que a própria tela define, depois os grupos dela, depois a repartição e, por fim, o padrão da prefeitura.' }),
    cards.length ? el('div', { class: 'pf-reps' }, ...cards) : el('p', { class: 'dim', text: 'Nenhuma repartição ainda. Comece por aqui: cada tela pertence a uma repartição.' }));
}

/* ================================================================== Regiões */
function paintRegioes(box) {
  const d = P.data;
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name), placeholder: 'Nome do bairro ou distrito' });
  const color = el('input', { type: 'color', value: '#4f8fd6', 'aria-label': 'Cor da região' });
  const add = guard(async () => { await api('/api/prefeitura/regions', { method: 'POST', body: { name: name.value, color: color.value } }); await reload(); });
  const rows = d.regions.map((r) => {
    const offices = d.offices.filter((o) => o.regionId === r.id);
    const mine = active().filter((x) => offices.some((o) => o.id === x.officeId));
    const n = el('input', { type: 'text', maxlength: String(LIMITS.name), value: r.name, 'aria-label': 'Nome da região' });
    const c = el('input', { type: 'color', value: r.color || '#4f8fd6', 'aria-label': 'Cor da região' });
    return el('tr', {}, el('td', {}, c), el('td', {}, n), el('td', { text: String(offices.length) }), el('td', { text: String(mine.length) }),
      el('td', { class: 'pf-actions' },
        el('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api(`/api/prefeitura/regions/${r.id}`, { method: 'PATCH', body: { name: n.value, color: c.value } }); toast('Região salva.'); await reload(); }) }, 'Salvar'),
        el('button', { class: 'btn small', type: 'button', onclick: () => { Object.assign(P.alert, { kind: 'regions', regions: [r.id] }); location.hash = '#prefeitura/alertas'; } }, 'Alerta'),
        el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Excluir a região "${r.name}"? As repartições dela ficam sem região.`)) return; await api(`/api/prefeitura/regions/${r.id}`, { method: 'DELETE' }); await reload(); }) }, 'Excluir')));
  });
  put(box, 
    el('p', { class: 'dim small', text: 'Regiões são os bairros e distritos da cidade. Cada repartição fica numa região, e um alerta pode ir só para as telas de uma ou mais regiões.' }),
    el('div', { class: 'pf-bar' }, color, name, el('button', { class: 'btn primary', type: 'button', onclick: add }, '+ Adicionar região')),
    rows.length ? table(['Cor', 'Região', 'Repartições', 'Telas', ''], rows) : el('p', { class: 'dim', text: 'Nenhuma região ainda.' }));
}

/* ================================================================== Alertas */
function alertScope() {
  const a = P.alert;
  if (a.kind === 'regions') return { kind: 'regions', regions: a.regions };
  if (a.kind === 'groups') return { kind: 'groups', groups: a.groups };
  if (a.kind === 'office') return { kind: 'office', office: Number(a.office) || null };
  if (a.kind === 'radius') return { kind: 'radius', lat: a.lat, lng: a.lng, meters: Number(a.meters) };
  return { kind: 'city' };
}
const scopeReady = (s) => (s.kind === 'city' || (s.kind === 'regions' && s.regions.length > 0) || (s.kind === 'groups' && s.groups.length > 0) || (s.kind === 'office' && s.office) || (s.kind === 'radius' && s.lat != null && s.meters >= LIMITS.radiusMin));
const scopeText = (s) => {
  const d = P.data; const names = (ids, list) => ids.map((id) => list.find((x) => x.id === id)?.name || `#${id}`).join(', ');
  return { city: 'Cidade toda', regions: `Regiões: ${names(s.regions || [], d.regions)}`, groups: `Grupos: ${names(s.groups || [], d.groups)}`, office: `Repartição: ${officeOf(s.office)?.name || `#${s.office}`}`, radius: `Raio de ${s.meters >= 1000 ? `${(s.meters / 1000).toLocaleString('pt-BR')} km` : `${s.meters} m`}`, reach: s.all ? 'Alcance da prefeitura: todas as TV box' : `Alcance da prefeitura: ${[...(s.offices || []).map((id) => officeOf(id)?.name || `#${id}`), ...(s.regions?.length ? [`regiões ${names(s.regions, d.regions)}`] : []), ...(s.groups?.length ? [`grupos ${names(s.groups, d.groups)}`] : [])].join(', ')}` }[s.kind] || s.kind;
};
let reachSeq = 0;
/** A prévia: quantas telas o alcance pega e quantas estão ligadas (o servidor conta; a mesma regra desenha os pinos). */
async function paintReach() {
  const note = $('#pfReach'); if (!note) return;
  const s = alertScope(); const seq = ++reachSeq;
  if (!scopeReady(s)) { note.textContent = s.kind === 'radius' ? 'Clique no mapa para marcar o centro do raio.' : 'Escolha para onde o alerta vai.'; P.amap?.setPins([]); return; }
  P.amap?.setPins(pinsOf(active().filter((d) => scopeHits(s, reachOf(d)))));
  P.amap?.setCircle(s.kind === 'radius' ? s : null);
  try {
    const r = await api('/api/prefeitura/alerts/preview', { method: 'POST', body: { scope: s } });
    if (seq === reachSeq) { note.textContent = `${r.total} tela(s) em ${r.offices} repartição(ões) vão receber · ${r.online} ligada(s) agora${r.total > r.online ? ` · ${r.total - r.online} desligada(s) só mostram se ligarem antes do fim do alerta` : ''}`; note.dataset.total = r.total; }
  } catch (e) { if (seq === reachSeq) note.textContent = e.message; }
}
async function loadAlerts() { P.alerts = await api('/api/prefeitura/alerts'); }
function alertDetails(a) {
  const body = el('div', {}, el('p', { class: 'dim small', text: 'Carregando…' }));
  dialog(`Alerta · ${a.title}`, body, { wide: true });
  guard(async () => {
    const d = await api(`/api/prefeitura/alerts/${a.id}`);
    body.replaceChildren(
      el('dl', { class: 'pf-dl' },
        el('dt', { text: 'Texto' }), el('dd', { class: 'pf-pre', text: d.text || '—' }),
        el('dt', { text: 'Nível' }), el('dd', { text: `${levelLabel(d.level)}${d.sound ? ' · com som' : ''}` }),
        el('dt', { text: 'Alcance' }), el('dd', { text: scopeText(d.scope) }),
        el('dt', { text: 'Período' }), el('dd', { text: `${when(d.startsAt)} até ${when(d.until)}` }),
        el('dt', { text: 'Enviado por' }), el('dd', { text: d.createdBy || '—' }),
        d.cancelledAt ? el('dt', { text: 'Encerrado' }) : null, d.cancelledAt ? el('dd', { text: `${when(d.cancelledAt)} por ${d.cancelledBy || '—'}` }) : null,
        el('dt', { text: 'Entrega' }), el('dd', { text: `${d.deliveries.length} tela(s) mostraram; o alcance hoje pega ${d.reach.total}` })),
      d.deliveries.length ? table(['Tela', 'Repartição', 'Recebeu', 'Último sinal com o alerta'], d.deliveries.map((x) => el('tr', {}, el('td', { text: x.name }), el('td', { text: x.office || '—' }), el('td', { text: when(x.firstAt) }), el('td', { text: when(x.lastAt) }))))
        : el('p', { class: 'dim small', text: 'Nenhuma tela recebeu este alerta.' }));
  })();
}
function paintAlertas(box) {
  const d = P.data; const a = P.alert;
  const set = (k) => (e) => { a[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };
  const title = el('input', { type: 'text', maxlength: String(LIMITS.alertTitle), value: a.title, placeholder: 'Ex.: Defesa Civil', oninput: set('title') });
  const text = el('textarea', { rows: '3', maxlength: String(LIMITS.alertText), placeholder: 'O que a pessoa deve saber ou fazer', oninput: set('text') }); text.value = a.text;
  const sevHint = el('small', { class: 'dim', text: severityHint(a.level) });
  const prev = el('div', {});
  const repaintPrev = () => { sevHint.textContent = severityHint(a.level); prev.replaceChildren(alertPreview(a, $('#pfReach')?.textContent || '')); };
  const level = el('select', { onchange: (e) => { a.level = e.target.value; repaintPrev(); } }, ...SEVERITIES.map((l) => opt(l.key, l.label, a.level === l.key)));
  const kindF = alertKind(ui, a, d.defaults.alertTexts, () => paintAlertas(box));
  title.addEventListener('input', repaintPrev); text.addEventListener('input', repaintPrev);
  const sound = el('input', { type: 'checkbox', checked: a.sound, onchange: set('sound') });
  const cls = el('select', { onchange: set('cls') }, ...CONTENT_CLASSES.map((c) => opt(c.key, c.label, a.cls === c.key)));
  const dur = el('select', { onchange: (e) => { a.durationMin = Number(e.target.value); } }, ...[[10, '10 minutos'], [30, '30 minutos'], [60, '1 hora'], [180, '3 horas'], [720, '12 horas'], [1440, '24 horas'], [4320, '3 dias']].map(([v, t]) => opt(v, t, a.durationMin === v)));
  const until = el('input', { type: 'datetime-local', value: a.until, onchange: set('until') });
  const mode = el('select', { onchange: (e) => { a.mode = e.target.value; dur.hidden = a.mode !== 'dur'; until.hidden = a.mode === 'dur'; } }, opt('dur', 'Fica por', a.mode === 'dur'), opt('until', 'Fica até', a.mode === 'until'));
  dur.hidden = a.mode !== 'dur'; until.hidden = a.mode === 'dur';
  const picks = el('div', { class: 'pf-scope' });
  const mapBox = el('div', { class: 'pf-mapbox small' });
  const checks = (list, key) => (list.length ? el('div', { class: 'pf-checks tall' }, ...list.map((x) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: a[key].includes(x.id), onchange: (e) => { a[key] = e.target.checked ? [...a[key], x.id] : a[key].filter((y) => y !== x.id); paintReach(); } }), el('span', { text: x.label || x.name }))))
    : el('p', { class: 'dim small', text: key === 'regions' ? 'Cadastre as regiões na aba Regiões.' : 'Crie os grupos na aba Grupos.' }));
  const paintPicks = () => {
    if (a.kind === 'regions') picks.replaceChildren(checks(d.regions, 'regions'));
    else if (a.kind === 'groups') picks.replaceChildren(checks(d.groups.map((g) => ({ ...g, label: `${g.name}${g.officeType ? ` (automático: ${typeShort(g.officeType)})` : ''}` })), 'groups'));
    else if (a.kind === 'office') picks.replaceChildren(f('Repartição', el('select', { onchange: (e) => { a.office = e.target.value; paintReach(); } }, opt('', 'Escolha…', !a.office), ...d.offices.map((o) => opt(o.id, `${o.name} · ${typeShort(o.type)}`, String(a.office) === String(o.id))))));
    else if (a.kind === 'radius') picks.replaceChildren(f('Raio em metros', el('input', { type: 'number', min: String(LIMITS.radiusMin), max: String(LIMITS.radiusMax), step: '100', value: String(a.meters), oninput: (e) => { a.meters = Number(e.target.value); paintReach(); } }), 'Clique no mapa para marcar o centro. Recebem as telas dentro do círculo (pelo ponto da tela ou da repartição).'));
    else picks.replaceChildren(el('p', { class: 'dim small', text: 'Todas as telas da prefeitura.' }));
    paintReach();
  };
  const scope = el('select', { onchange: (e) => { a.kind = e.target.value; paintPicks(); } }, ...ALERT_SCOPES.map((s) => opt(s.key, s.label, a.kind === s.key)));
  const send = guard(async () => {
    const s = alertScope();
    if (a.title.trim().length < 2) return toast('Escreva o título do alerta.', true);
    if (!scopeReady(s)) return toast('Escolha para onde o alerta vai.', true);
    if (a.category && !a.kind) return toast('Escolha o tipo do aviso (ou tire a categoria).', true);
    const body = { title: a.title, text: a.text, level: a.level, sound: a.sound, class: a.cls, scope: s, ...kindF.body(), ...(a.mode === 'until' ? { until: new Date(a.until).getTime() } : { durationMin: a.durationMin }) };
    if (a.mode === 'until' && !a.until) return toast('Diga até quando o alerta fica.', true);
    if (!confirm(`Enviar o alerta "${a.title.trim()}" agora?\n${scopeText(s)}\n${$('#pfReach')?.textContent || ''}`)) return;
    // Extremo é o nível máximo: uma confirmação a mais (o servidor também cobra)
    if (a.level === 'critical') { if (!confirm(`Este é o nível máximo. Confirmar alerta EXTREMO para ${$('#pfReach')?.dataset.total || 'as'} telas?`)) return; body.confirmExtreme = true; }
    const r = await api('/api/prefeitura/alerts', { method: 'POST', body });
    toast(`Alerta enviado: ${r.reach.total} tela(s), ${r.reach.online} ligada(s) agora. Aparece em até 10 segundos.`);
    Object.assign(a, { title: '', text: '', category: null, kind: null });
    await loadAlerts(); paintAlertas(box);
  });
  const row = (x, live) => el('tr', {},
    el('td', {}, el('span', { class: `pf-level ${x.level}`, text: severityOf(x.level).label }), x.test ? el('span', { class: 'pf-chip', text: 'TESTE' }) : null, ' ', el('b', { text: x.title }), x.header ? el('div', { class: 'dim small', text: x.header }) : null, el('div', { class: 'dim small', text: x.text.slice(0, 120) }),
      x.class !== 'utilidade' || x.flag ? el('div', { class: 'dim small', text: [x.class !== 'utilidade' ? classLabel(x.class) : '', x.flag === 'sem-aprovacao' ? 'saiu sem a aprovação da SECOM (Defesa Civil)' : ''].filter(Boolean).join(' · ') }) : null),
    el('td', { text: scopeText(x.scope) }),
    el('td', { text: `${when(x.startsAt)} até ${when(x.until)}` }),
    el('td', { text: x.status }),
    el('td', { text: `${x.delivered} tela(s)` }),
    el('td', { text: x.createdBy || '—' }),
    el('td', { class: 'pf-actions' },
      el('button', { class: 'btn small', type: 'button', onclick: () => alertDetails(x) }, 'Entregas'),
      live ? el('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Encerrar o alerta "${x.title}"? Ele sai das telas em até 10 segundos.`)) return; await api(`/api/prefeitura/alerts/${x.id}/cancel`, { method: 'POST' }); toast('Alerta encerrado.'); await loadAlerts(); paintAlertas(box); }) }, 'Encerrar') : null));
  const heads = ['Alerta', 'Alcance', 'Período', 'Situação', 'Mostraram', 'Enviado por', ''];
  put(box, 
    el('div', { class: 'card pf-compose' },
      el('div', { class: 'label', text: 'Novo alerta em tela cheia' }),
      el('div', { class: 'pf-compose-grid' },
        el('div', { class: 'pf-grid' }, kindF.node, f('Título', title), f('Texto', text),
          el('div', { class: 'pf-grid two' }, el('label', { class: 'pf-f' }, el('span', { text: 'Gravidade' }), level, sevHint), el('label', { class: 'pf-f' }, el('span', { text: 'Duração' }), el('div', { class: 'pf-inline' }, mode, dur, until))),
          el('label', { class: 'pf-check' }, sound, el('span', { text: 'Tocar o som de alerta nas telas' })),
          f('Classificação', cls, 'Institucional: fica retido no período eleitoral. Emergência e utilidade pública vão sempre.'),
          f('Para onde', scope), picks,
          el('p', { class: 'pf-reach', id: 'pfReach', 'aria-live': 'polite' }),
          el('div', { class: 'pf-btns left' }, el('button', { class: 'btn primary', type: 'button', onclick: send }, 'Enviar alerta'))),
        el('div', {}, mapBox, el('p', { class: 'dim small', text: 'No mapa, as telas que vão receber. No alcance "Raio no mapa", clique para marcar o centro.' }),
          el('div', { class: 'label', text: 'Como aparece na TV' }), prev))),
    el('div', { class: 'label', text: 'Em vigor e agendados' }),
    P.alerts.active.length ? table(heads, P.alerts.active.map((x) => row(x, true))) : el('p', { class: 'dim small', text: 'Nenhum alerta nas telas agora.' }),
    el('div', { class: 'label', text: 'Histórico' }),
    P.alerts.history.length ? table(heads, P.alerts.history.map((x) => row(x, false))) : el('p', { class: 'dim small', text: 'Nenhum alerta enviado ainda.' }));
  P.amap = createMap(mapBox, { onClick: (p) => { if (a.kind !== 'radius') return; a.lat = p.lat; a.lng = p.lng; paintReach(); } });
  cityOutline(P.amap); cityView(P.amap);
  paintPicks(); repaintPrev();
}

/* ================================================================== tela */
function paint() {
  const root = $('#pfPanel');
  if (!root || !P.data) return;
  P.map?.destroy(); P.map = null; P.amap?.destroy(); P.amap = null;
  const tabs = el('div', { class: 'cg-tabs', role: 'tablist' }, ...TABS.map(([id, label]) => el('button', { class: `cg-tab${P.tab === id ? ' on' : ''}`, role: 'tab', type: 'button', 'aria-selected': String(P.tab === id), text: label, onclick: () => { location.hash = `#prefeitura/${id}`; } })));
  const box = el('div', { class: 'pf-box', id: 'pfBox' });
  root.replaceChildren(...[electoralBanner(P.data), tabs, box].filter(Boolean));
  if (ASYNC_TABS[P.tab]) { put(box, el('p', { class: 'dim small', text: 'Carregando…' })); guard(() => ASYNC_TABS[P.tab](box, ui))(); return; }
  ({ mapa: paintMapa, telas: paintTelas, grupos: paintGrupos, reparticoes: paintReparticoes, regioes: paintRegioes, alertas: paintAlertas })[P.tab](box);
}
/** A cada 10 s (Mapa, Telas, Grupos e Repartições): só a situação das telas; o cadastro fica como está na tela. */
async function tick() {
  if (!P.data || document.hidden || !$('#view-prefeitura') || $('#view-prefeitura').hidden || document.querySelector('dialog.pf-dlg[open]')) return;
  try {
    const s = await api('/api/prefeitura/status');
    P.skew = s.serverTime - Date.now();
    const byId = new Map(s.devices.map((x) => [x.id, x]));
    for (const d of P.data.devices) Object.assign(d, byId.get(d.id) || {});
    if (P.tab === 'mapa') { paintMapLive(); if (P.office != null && sideSig() !== P.sideSig) paintMapSide(); } else if (P.tab !== 'alertas' && P.tab !== 'regioes' && !ASYNC_TABS[P.tab] && !document.activeElement?.closest?.('#pfBox input, #pfBox select, #pfBox textarea') && !document.querySelector('#pfBox .pf-secret-v:not(.masked)')) paint(); // senha à vista na ficha: não redesenha por baixo
  } catch { /* próxima volta */ }
}
/** Esc sai da tela cheia do mapa (com uma janela aberta, o Esc é dela). */
const onEsc = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && P.full && P.tab === 'mapa' && $('#pfBox.pf-full') && !document.querySelector('dialog[open]')) { e.preventDefault(); setFull(false); } };
/** Janelas abertas não sobrevivem à troca de aba ou de tela. */
const closeDialogs = () => document.querySelectorAll('dialog.pf-dlg').forEach((d) => { d.close(); d.remove(); });
async function show(sub) {
  closeDialogs();
  P.tab = TABS.some(([id]) => id === sub) ? sub : 'mapa';
  if (P.tab === 'alertas') await loadAlerts();
  if (P.tab === 'telas') await loadAvail();
  paint();
}

export default {
  id: 'prefeitura',
  async load(sub) { await load(); loadPrefs(); document.addEventListener('keydown', onEsc); await show(sub); clearInterval(P.timer); P.timer = setInterval(tick, POLL_MS); },
  async sub(s) { await show(s); },
  leave() { document.removeEventListener('keydown', onEsc); closeDialogs(); clearInterval(P.timer); P.timer = null; P.map?.destroy(); P.map = null; P.amap?.destroy(); P.amap = null; if (P.shotUrl) { URL.revokeObjectURL(P.shotUrl); P.shotUrl = null; } },
};
