// NEXA Telas · a prévia "Como aparece na TV" (docs/TELAS.md): um desenho da tela da TV box nos seis formatos (full, ticker,
// side, lbar, portrait, queue), do alerta em tela cheia e do aviso de pessoa desaparecida (tela cheia e faixa; contrato §8.2).
// É um desenho do que o app foi programado para mostrar, não o vídeo de verdade. Usado na página de controle da repartição
// (public/reparticao/) e no Painel da Prefeitura. Sem dependências, sem estilo pelo script (a CSP da página da repartição
// não aceita inline): as cores saem de classes de public/shared/telas-previa.css.
//
//   tvPreview({
//     layout: 'full' | 'ticker' | 'side' | 'lbar' | 'portrait' | 'queue' | os do §15 (queue-table, queue-big, …),
//     channel: 'TV PREFEITURA', program: ['Título', 'subtítulo'],
//     ticker: ['aviso', …] | 'texto',
//     side: { title, widgets: ['clock', 'weather', 'qr', 'queue'], queue: ['A 128', 'Guichê 3'], queueLast: ['A 127', …], card: { title, lines: [] }, city },
//     queue: { title, now: ['A 128', 'Guichê 3'], last: ['P 031', …], risk: { vermelho: 1, … } | null, waiting: 14,
//              nowRisk, nowPrio, nowTime, rows: [{ ticket, desk, time, risk, prio }], services: [{ name, ticket, desk, color, hot }],
//              serving: [{ ticket, desk, risk }] },
//     office: 'UBS Centro', theme: { color: '#1d4ed8', mode: 'dark' | 'light' },   // os painéis de senha do §15
//     alert: { level: 'info' | 'warn' | 'critical', title, text, foot },      // cobre tudo
//     missing: { mode: 'full' | 'banner', kind, name, age, since, lastSeen, description, contact, photo: url | null },
//     clock: '14:32', date: 'quarta, 12 de novembro',
//   }) -> elemento
import { splitAviso, isQueueLayout, QUEUE_LAYOUT_KEYS, themeColorKey, SERVICE_COLORS } from './telas-tipos.js';
import { encodeQr } from './qr.js'; // o QR code do contato do caso de pessoa desaparecida

const h = (tag, cls, ...kids) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const k of kids.flat()) if (k != null && k !== false && k !== '') n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
export const PREVIEW_LAYOUTS = ['full', 'ticker', 'side', 'lbar', 'portrait', ...QUEUE_LAYOUT_KEYS];
const RISK_ORDER = ['vermelho', 'laranja', 'amarelo', 'verde', 'azul'];
const LEVEL_HEAD = { info: 'COMUNICADO', warn: 'ATENÇÃO', critical: 'ALERTA' };
/** O cabeçalho do aviso de pessoa desaparecida por tipo (contrato §8.2). */
export const MISSING_HEAD = { crianca: 'CRIANÇA DESAPARECIDA', adolescente: 'ADOLESCENTE DESAPARECIDO(A)', adulto: 'PESSOA DESAPARECIDA', idoso: 'IDOSO(A) DESAPARECIDO(A)' };
const nowClock = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const nowDate = () => new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const brDay = (d) => String(d || '').split('-').reverse().join('/');

const video = (c, small) => h('div', `vid${small ? ' small' : ''}`,
  h('div', 'ch', h('span', 'live', 'AO VIVO'), c.channel || 'TV PREFEITURA'),
  h('div', 'pt', c.program?.[0] || 'Canal da prefeitura'), h('div', 'ps', c.program?.[1] || 'O vídeo do canal aparece aqui'));
function tickerOf(c) {
  const items = (Array.isArray(c.ticker) ? c.ticker : [c.ticker]).map((x) => splitAviso(x).text.trim()).filter(Boolean);
  return h('div', 'tk', h('b', '', 'AVISOS'), h('span', 'tkt', items.length ? items.join('  ·  ') : 'Sem avisos: a faixa fica vazia'));
}
function cardOf(card) {
  const lines = (card.lines || []).filter(Boolean);
  return h('div', 'cd', h('div', 'ct', card.title || 'Cartão'), lines.length ? lines.map((x) => h('div', 'cl', x)) : h('div', 'cl dim', 'Sem linhas ainda'));
}
function sideOf(c) {
  const s = c.side || {};
  const n = h('div', 'sd', s.title ? h('div', 'st', s.title) : null);
  for (const w of s.widgets || ['clock']) {
    if (w === 'clock') n.append(h('div', '', h('div', 'ck', c.clock || nowClock()), h('div', 'sm', c.date || nowDate())));
    if (w === 'weather') n.append(h('div', 'sm', `29° · Sol entre nuvens${s.city ? ` · ${s.city}` : ''}`));
    if (w === 'qr') n.append(h('div', 'qr'), h('div', 'sm', 'Serviços da prefeitura'));
    // a senha atual numa caixa maior e, embaixo, até 3 anteriores em caixas menores (15/11, do dono)
    if (w === 'queue' && s.queue) n.append(h('div', 'sn', h('div', 'sc', s.queue[0]), h('div', 'sg', s.queue[1])),
      s.queueLast?.length ? h('div', 'snl', h('div', 'snt', 'Últimas chamadas'), s.queueLast.slice(0, 3).map((t) => h('div', 'snb', t))) : null);
  }
  if (s.card) n.append(cardOf(s.card));
  return n;
}
function queueOf(c) {
  const q = c.queue || {};
  const risks = q.risk
    ? h('div', 'qr2', 'Aguardando por cor:', RISK_ORDER.filter((k) => q.risk[k] != null).map((k) => h('i', `rk rk-${k}`, String(q.risk[k]))))
    : h('div', 'qr2', `Aguardando: ${q.waiting ?? 0}`);
  const { cur, rows } = qData(c);
  // 15/11, do dono: a última chamada no cartão grande; à direita "ÚLTIMAS CHAMADAS", cada anterior numa caixa; quem está em
  // atendimento também em caixas, embaixo, se couber (senão "+N em atendimento")
  const serving = q.serving || [];
  return [
    h('div', 'qp', h('div', 'qt', q.title || 'Chamada de senha'),
      h('div', 'qrow', h('div', `qn${cur.risk ? ` rkbg-${cur.risk}` : ''}`, h('div', 'qc', cur.ticket), h('div', 'qg', cur.desk)),
        h('div', 'qlc', h('div', 'qt', 'Últimas chamadas'), rows.slice(0, 4).map((r) => box(r)))),
      serving.length ? h('div', 'qsv', h('span', 'qt', 'Em atendimento'), serving.slice(0, 3).map((r) => box(r, 'sm')), serving.length > 3 ? h('span', 'qmore', `+${serving.length - 3} em atendimento`) : null) : null,
      risks),
    h('div', 'qs', video(c, true), sideOf({ ...c, side: { widgets: [], card: c.side?.card } })),
  ];
}

/* ------------------------------------------------------------------ os painéis de senha do §15 (15/11) */
const RISK_WORDS = { vermelho: 'EMERGÊNCIA', laranja: 'MUITO URGENTE', amarelo: 'URGENTE', verde: 'POUCO URGENTE', azul: 'NÃO URGENTE' };
/** A atual, as anteriores (com o local, se veio) e as filas, do que o painel mandou. */
function qData(c) {
  const q = c.queue || {};
  const now = q.now || ['—', ''];
  const cur = { ticket: now[0], desk: now[1] || '', risk: q.nowRisk || null, prio: Boolean(q.nowPrio), time: q.nowTime || '', service: q.nowService || '' };
  const rows = q.rows || (q.last || []).map((t) => ({ ticket: t, desk: '', time: '', risk: null }));
  return { q, cur, rows, services: q.services || [] };
}
/** O tipo da senha em palavras: o nível do risco (nunca o motivo da triagem), PREFERENCIAL ou NORMAL. */
const kindOf = (r, fallback = 'NORMAL') => (r.risk ? RISK_WORDS[r.risk] : r.prio ? 'PREFERENCIAL' : fallback);
/** Uma senha numa caixa: o código grande e o local embaixo; a faixa da cor do risco à esquerda. */
const box = (r, cls = '', withKind = false) => h('div', `qb${r.risk ? ` rk rk-${r.risk}` : ''}${cls ? ` ${cls}` : ''}`,
  withKind ? h('span', 'qbk', kindOf(r)) : null, h('b', 'qbt', r.ticket), r.desk ? h('span', 'qbd', r.desk) : null, r.time ? h('span', 'qbh', r.time) : null);
/** O cartão grande da senha atual, com o fundo da cor do risco (texto legível em cada cor: classes rkbg-*). */
const bigCard = (cur, extra = null, fallback = 'SENHA') => h('div', `qcur${cur.risk ? ` rkbg-${cur.risk}` : ''}`,
  h('div', 'qk', kindOf(cur, fallback)), h('div', 'qct', cur.ticket), cur.desk ? h('div', 'qcd', cur.desk) : null, extra ? h('div', 'qcx', extra) : null);
const clockBox = (c) => h('div', 'qclk', h('b', '', c.clock || nowClock()), h('span', '', c.date || nowDate()));
const header = (c) => h('div', 'qhd', h('div', 'qhn', c.office || c.side?.title || 'Repartição'), clockBox(c));
const table = (rows, cur, n) => h('div', 'qtab', h('div', 'qtr qth', h('span', '', 'SENHA'), h('span', '', 'GUICHÊ')),
  cur ? h('div', `qtr qtnow${cur.risk ? ` rkbg-${cur.risk}` : ''}`, h('b', '', cur.ticket), h('b', '', cur.desk)) : null,
  rows.slice(0, n).map((r) => h('div', `qtr${r.risk ? ` rk rk-${r.risk}` : ''}`, h('span', '', r.ticket), h('span', '', r.desk || '—'))));
const svClass = (s, i) => { const k = SERVICE_COLORS.indexOf(s.color); return `sv-${k >= 0 ? k : i % SERVICE_COLORS.length}`; };
function queueBoard(c, layout) {
  const { q, cur, rows, services } = qData(c);
  const title = q.title || 'Atendimento';
  const vid = () => video(c, true);
  switch (layout) {
    case 'queue-table': return [vid(), table(rows, cur, 4), h('div', 'qfoot', tickerOf(c), clockBox(c))];
    case 'queue-big': return [
      h('div', 'qbig', h('div', 'qk', kindOf(cur, title.toUpperCase())), h('div', 'qlab', 'SENHA'), h('div', `qbb${cur.risk ? ` rkbg-${cur.risk}` : ''}`, cur.ticket), h('div', 'qlab', 'GUICHÊ'), h('div', 'qbb qbbd', cur.desk || '—')),
      table(rows, null, 6)];
    case 'queue-cards': return [header(c), h('div', 'qmid', vid(), bigCard(cur)), h('div', 'qstrip', h('div', 'qt', 'ÚLTIMAS SENHAS'), h('div', 'qcards', rows.slice(0, 5).map((r) => box(r))))];
    case 'queue-header': return [header(c), h('div', 'qmid', bigCard(cur, 'Dirija-se ao local indicado'), h('div', 'qcol', h('div', 'qt', 'ÚLTIMAS CHAMADAS'), rows.slice(0, 3).map((r) => box(r, 'row')), vid()))];
    case 'queue-info': return [
      h('div', 'qleft', h('div', 'qhn', c.office || c.side?.title || 'Repartição'), clockBox(c), vid()),
      h('div', 'qbands', h('div', `qband${cur.risk ? ` rkbg-${cur.risk}` : ''}`, h('span', 'qbl', 'SENHA'), h('b', 'qbv big', cur.ticket)),
        h('div', 'qband', h('span', 'qbl', 'ATENDIMENTO'), h('b', 'qbv', cur.service || kindOf(cur, title))),
        h('div', 'qband', h('span', 'qbl', 'LOCAL'), h('b', 'qbv', cur.desk || '—')),
        h('div', 'qcards', rows.slice(0, 4).map((r) => box(r, 'sm'))))];
    case 'queue-mosaic': return [h('div', 'qmid', bigCard(cur), vid()), h('div', 'qcards', rows.slice(0, 3).map((r) => box(r, '', true))), h('div', 'qfoot2', h('span', '', c.office || c.side?.title || title), clockBox(c))];
    case 'queue-duo': {
      const two = (services.length ? services : [{ name: title, ticket: cur.ticket, desk: cur.desk, hot: true }]).slice(0, 2);
      return [header(c), h('div', 'qduo', two.map((s, i) => h('div', `qhalf ${svClass(s, i)}`, h('div', 'qsn', s.name), h('div', 'qct', `${s.hot ? '▶ ' : ''}${s.ticket || '—'}`), h('div', 'qcd', s.desk || '')))),
        h('div', 'qstrip', h('div', 'qt', 'ÚLTIMAS CHAMADAS'), h('div', 'qcards', rows.slice(0, 4).map((r) => box(r))))];
    }
    case 'queue-grid': return [vid(), h('div', 'qgrid', services.slice(0, 8).map((s, i) => h('div', `qcell ${svClass(s, i)}`, h('div', 'qsn', s.name), h('b', 'qcv', s.ticket || '—'), h('span', 'qcd', s.desk || '')))), h('div', 'qfoot2', h('span', '', c.date || nowDate()), h('b', '', c.clock || nowClock()))];
    case 'queue-list': return [
      h('div', 'qleft', h('div', 'qhn', c.office || c.side?.title || 'Repartição'), h('div', 'qt', 'ÚLTIMAS CHAMADAS'), rows.slice(0, 4).map((r) => box(r, 'row', true))),
      h('div', 'qright', h('div', `qbar${cur.risk ? ` rkbg-${cur.risk}` : ''}`, h('span', 'qk', kindOf(cur, 'SENHA')), h('b', 'qct', cur.ticket), h('span', 'qcd', cur.desk)), vid()),
      h('div', 'qfoot', tickerOf(c), clockBox(c))];
    default: return queueOf(c);
  }
}
function alertOf(a) {
  const lv = ['info', 'warn', 'critical'].includes(a.level) ? a.level : 'info';
  return h('div', `al lv-${lv}`, h('div', 'ah', a.head || LEVEL_HEAD[lv]), h('div', 'at', a.title || 'Título do alerta'), a.text ? h('div', 'ax', a.text) : null, a.foot ? h('div', 'af', a.foot) : null);
}
/** A foto do caso (ou a silhueta desenhada, sem foto). O endereço da foto é do próprio servidor (ou blob: da prévia). */
function photoOf(m, cls) {
  if (m.photo) { const img = h('img', cls); img.alt = m.name ? `Foto de ${m.name}` : 'Foto'; img.src = m.photo; return img; }
  return h('div', `${cls} sil`, h('span', 'sil-h'), h('span', 'sil-b'));
}
const ageText = (m) => (m.age != null && m.age !== '' ? `${m.age} ${Number(m.age) === 1 ? 'ano' : 'anos'}` : '');
/**
 * O QR code de verdade (o mesmo gerador do gerador de caracteres, public/shared/qr.js), num SVG com a margem branca: um
 * retângulo por módulo escuro, só com atributos (nenhum estilo pelo script). Conteúdo que não dá para codificar: nada.
 */
export function qrSvg(data, cls = 'qrc') {
  let qr; try { qr = encodeQr(String(data), { ecl: 'M' }); } catch { return null; }
  const NS = 'http://www.w3.org/2000/svg'; const pad = 4; const side = qr.size + pad * 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${side} ${side}`); svg.setAttribute('class', cls); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code de contato'); svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', String(side)); bg.setAttribute('height', String(side)); bg.setAttribute('fill', '#fff'); svg.append(bg);
  let d = '';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.get(x, y)) d += `M${x + pad} ${y + pad}h1v1h-1z`;
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); path.setAttribute('fill', '#000'); svg.append(path);
  return svg;
}
const qrOf = (m, cls) => (m.qr?.data ? qrSvg(m.qr.data, cls) : null);
function missingFull(m) {
  const qr = qrOf(m, 'qrc');
  return h('div', 'ms', photoOf(m, 'mph'),
    h('div', 'mtx', h('div', 'mh', m.header || MISSING_HEAD[m.kind] || MISSING_HEAD.adulto), h('div', 'mn', m.name || 'Nome da pessoa'), ageText(m) ? h('div', 'ma', ageText(m)) : null,
      m.since ? h('div', 'ml', `Desde ${brDay(m.since)}`) : null, m.lastSeen ? h('div', 'ml', `Visto(a) por último: ${m.lastSeen}`) : null,
      m.description ? h('div', 'ml', m.description) : null,
      // o contato em destaque no rodapé e, ao lado, o QR code com a frase (contrato §11)
      h('div', 'mfoot', h('div', 'mc', m.contact || 'Ligue 199 ou 190'), qr ? h('div', 'mqr', qr, h('span', 'mql', m.qr.label || 'Aponte a câmera do celular')) : null)));
}
const missingBanner = (m) => h('div', 'mb', photoOf(m, 'mbp'), h('b', '', m.header || 'DESAPARECIDA(O)'), h('span', 'mbn', [m.name || 'Nome da pessoa', ageText(m)].filter(Boolean).join(', ')), h('span', 'mbc', m.contact || 'Ligue 199 ou 190'), qrOf(m, 'qrc mbq'));

export function tvPreview(c = {}) {
  const layout = PREVIEW_LAYOUTS.includes(c.layout) ? c.layout : 'full';
  const up = layout === 'portrait';
  const n = h('div', `tv-previa tv l-${layout}${up ? ' up' : ''}`);
  n.setAttribute('role', 'img');
  n.setAttribute('aria-label', c.alert ? `Prévia do alerta na TV: ${c.alert.title || ''}` : 'Prévia de como aparece na TV');
  if (c.alert) { n.className = `tv-previa tv${up ? ' up' : ''}`; n.append(alertOf(c.alert)); return n; }
  const m = c.missing || null;
  // no painel de senha a tela cheia nunca cobre o painel: o caso sai só como faixa (contrato §8.2)
  if (m && m.mode === 'full' && !isQueueLayout(layout)) { n.className = `tv-previa tv${up ? ' up' : ''} l-missing`; n.append(missingFull(m)); return n; }
  if (layout === 'queue') n.append(...queueOf(c));
  else if (isQueueLayout(layout)) {
    // os do §15 (contrato): o tema (a cor e o claro/escuro) por classe
    n.classList.add('qx', `th-${themeColorKey(c.theme?.color)}`);
    if (c.theme?.mode === 'light') n.classList.add('th-light');
    n.append(...queueBoard(c, layout));
  }
  else {
    n.append(video(c));
    if (layout === 'side' || layout === 'lbar' || up) n.append(sideOf(c));
    if (layout === 'ticker' || layout === 'lbar' || up) n.append(m ? missingBanner(m) : tickerOf(c));
  }
  // faixa por cima do vídeo nos formatos sem texto rolante
  if (m && !(layout === 'ticker' || layout === 'lbar' || up)) { n.classList.add('has-mb'); n.append(h('div', 'mbo', missingBanner(m))); }
  return n;
}
/** A prévia com a legenda embaixo ("Vídeo + lateral · como fica na recepção"). */
export const tvFigure = (cfg, caption = '') => h('figure', 'tv-previa-fig', tvPreview(cfg), caption ? h('figcaption', '', caption) : null);
