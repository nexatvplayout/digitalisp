// NEXA Telas · página de controle da repartição · as abas da SECOM (comando da comunicação):
//   Aprovações: a fila de pedidos de TODAS as repartições (avisos, cartões e alertas escritos nos links de controle), com
//     "Ver como fica na tela", Aprovar e Devolver com motivo. A mesma regra da aba Aprovações do Painel da Prefeitura.
//   Aviso geral: os avisos do padrão da prefeitura (o texto rolante das telas que não têm avisos mais específicos).
// /api/reparticao/approvals* e /api/reparticao/geral: só o gestor de uma repartição do tipo SECOM alcança.
import { CONTENT_CLASSES, CARD_KIND, classLabel, splitAviso, markAviso, severityOf, typeLabel, layoutLabel } from '/shared/telas-tipos.js';
import { S, el, put, api, act, ok, err, card, cols, option, hhmm } from '/reparticao/rep-base.js';
import { tvPreview } from '/shared/telas-previa.js';
import { devicesCard } from '/reparticao/rep-telas.js';

const KIND = { avisos: 'Avisos', card: 'Cartão', alert: 'Alerta', missing: 'Desaparecido ou cartela' };
const STATUS = { approved: 'aprovado', rejected: 'devolvido', auto: 'saiu na hora' };

/** A prévia de um pedido no formato da tela da repartição que enviou. */
function previewOf(a) {
  const p = a.payload || {}; const lay = a.officeLayout || 'full';
  if (a.kind === 'missing') return tvPreview({ layout: 'full', missing: { mode: 'full', kind: p.kind, header: p.header || undefined, name: p.name, age: p.age, since: p.since, lastSeen: p.lastSeen, description: p.description, contact: p.contact, photo: null } });
  if (a.kind === 'alert') return tvPreview({ alert: { level: p.level, head: p.info?.header || severityOf(p.level).word, title: p.title, text: p.body || '', foot: a.office || '' } });
  if (a.kind === 'card') return tvPreview({ layout: ['side', 'lbar', 'portrait', 'queue'].includes(lay) ? lay : 'side', side: { title: a.office, widgets: ['clock'], card: { title: p.title, lines: p.lines || [] } }, queue: { now: ['A 128', 'Guichê 3'], last: [] }, ticker: [] });
  return tvPreview({ layout: ['ticker', 'lbar', 'portrait'].includes(lay) ? lay : 'ticker', ticker: p.items || [], side: { title: a.office, widgets: ['clock'] } });
}
function detailOf(a) {
  const p = a.payload || {};
  if (a.kind === 'avisos') return el('ul', { class: 'r-plain' }, (p.items || []).map((x) => { const s = splitAviso(x); return el('li', { text: `${s.text}${s.class !== 'utilidade' ? `  [${classLabel(s.class)}]` : ''}` }); }));
  if (a.kind === 'card') return el('div', {}, el('b', { text: `${CARD_KIND[p.kind]?.label || p.kind}: ${p.title}` }), el('ul', { class: 'r-plain' }, (p.lines || []).map((x) => el('li', { text: x }))));
  if (a.kind === 'missing') return el('div', {}, el('b', { text: `${p.header || 'Pessoa desaparecida'}${p.name ? `: ${p.name}` : ''}` }), el('p', { class: 'r-dim', text: [p.lastSeen, p.description, p.contact, p.hasPhoto ? 'com foto (aparece depois de aprovado)' : 'sem foto'].filter(Boolean).join(' · ') }));
  return el('div', {}, el('b', { text: p.title }), el('p', { class: 'r-dim', text: p.body || '' }));
}

export function aprovacoes(ctx) {
  let data = null; let open = null; // o pedido com a prévia aberta
  const list = el('div', { class: 'r-reqs' }); const hist = el('ul', { class: 'r-list' }); const note = el('p', { class: 'r-dim' });
  const pv = el('div', { class: 'r-pv' });
  const decide = (a, how) => act(async () => {
    let body;
    if (how === 'reject') {
      const why = prompt(`Devolver o pedido de "${a.office}"? Escreva o motivo (a repartição lê):`, '');
      if (why == null) return;
      if (why.trim().length < 3) throw new Error('Escreva o motivo da devolução.');
      body = { note: why.trim() };
    } else if (!confirm(`Aprovar o pedido de "${a.office}"? Ele vai às telas dela em até 30 segundos.`)) return;
    await api(`/approvals/${a.id}/${how}`, { method: 'POST', body: body || {} });
    ok(how === 'approve' ? 'Aprovado: vai às telas da repartição em até 30 segundos.' : 'Devolvido com o motivo: nada foi às telas.');
    if (open === a.id) open = null;
    await load(); await ctx.refresh();
  });
  function paint() {
    if (!data) return;
    ctx.badge('aprovacoes', data.pending.length);
    const cco = S.state.office.type === 'seguranca';
    note.textContent = cco ? `Aqui esperam os envios dos emissores conveniados (Polícia Civil e Militar)${data.enabled ? ' e, com a aprovação geral ligada, os das repartições da prefeitura (a SECOM também aprova estes; vale quem decidir primeiro)' : ''}. Nada vai às telas antes da aprovação.` : data.enabled ? 'A aprovação está ligada: o que as repartições escrevem nos links de controle espera aqui antes de ir às telas. O alerta da Defesa Civil sai na hora e fica marcado no histórico.' : 'A aprovação da SECOM está desligada no Padrão da prefeitura: o que as repartições escrevem vai direto às telas. Para ligar, peça ao Painel da Prefeitura.';
    put(list, data.pending.length ? data.pending.map((a) => el('article', { class: `r-req${open === a.id ? ' open' : ''}` },
      el('div', { class: 'r-req-head' }, el('span', { class: 'r-tag live', text: KIND[a.kind] || a.kind }), a.external ? el('span', { class: 'r-tag', text: 'emissor conveniado' }) : null, el('b', { text: a.office || 'Repartição' }), el('span', { class: 'r-dim', text: `${typeLabel(a.officeType)} · ${hhmm(a.requestedAt)} · por ${a.requestedBy}` }),
        a.class !== 'utilidade' ? el('span', { class: 'r-tag', text: classLabel(a.class) }) : null),
      detailOf(a),
      el('div', { class: 'r-btns' },
        el('button', { type: 'button', class: 'r-btn', 'aria-expanded': String(open === a.id), onclick: () => { open = open === a.id ? null : a.id; paint(); } }, 'Ver como fica na tela'),
        el('button', { type: 'button', class: 'r-btn', onclick: decide(a, 'reject') }, 'Devolver com motivo'),
        el('button', { type: 'button', class: 'r-btn primary', onclick: decide(a, 'approve') }, 'Aprovar')))) : el('p', { class: 'r-dim', text: 'Nenhum pedido esperando.' }));
    const sel = data.pending.find((a) => a.id === open);
    put(pv, sel ? [previewOf(sel), el('p', { class: 'r-dim', text: `${sel.office}: prévia no formato da tela dela (${layoutLabel(sel.officeLayout || 'full')}).` })] : el('p', { class: 'r-dim', text: 'Clique em "Ver como fica na tela" num pedido para abrir a prévia aqui.' }));
    put(hist, data.history.slice(0, 30).map((a) => el('li', {},
      el('span', { class: 'r-tag', text: STATUS[a.status] || a.status }),
      el('span', {}, el('b', { text: `${a.office || 'Repartição'} · ${KIND[a.kind] || a.kind}: ${a.summary}` }), el('small', { text: `${hhmm(a.decidedAt || a.requestedAt)}${a.decidedBy ? ` · por ${a.decidedBy}` : ''}${a.note ? ` · motivo: "${a.note}"` : ''}` })))));
  }
  async function load() { data = await api('/approvals'); paint(); }
  const node = cols(
    [card('Aguardando aprovação', note, list), card('Decididos há pouco', hist)],
    card('Como fica na tela', pv));
  load().catch((x) => { if (x.message !== 'sessão') err(x.message); });
  return { node, show: () => load().catch(() => {}), refresh: () => { if (open == null) load().catch(() => {}); } };
}

export function geral(ctx) {
  const g = () => S.state.general;
  const rows = el('div', { class: 'r-avisos' }); const pv = el('div', { class: 'r-pv' });
  const read = () => [...rows.querySelectorAll('.r-aviso')].map((r) => { const t = r.querySelector('input').value.trim(); return t ? markAviso(t, r.querySelector('select').value) : ''; }).filter(Boolean);
  const repaint = () => put(pv, tvPreview({ layout: 'ticker', program: ['Canal da prefeitura', 'O vídeo aparece aqui'], ticker: read() }));
  function row(item = '') {
    const a = splitAviso(item);
    const r = el('div', { class: 'r-aviso' }, el('input', { type: 'text', maxlength: String(g().maxLength), value: a.text, 'aria-label': 'Aviso geral', oninput: repaint }),
      el('select', { 'aria-label': 'Classificação do aviso', class: 'r-class' }, ...CONTENT_CLASSES.map((c) => option(c.key, c.label, c.key === a.class))),
      el('button', { type: 'button', class: 'r-btn small', onclick: () => { r.remove(); if (!rows.children.length) rows.append(row()); repaint(); } }, 'Tirar'));
    return r;
  }
  const fill = () => { put(rows, (g().items.length ? g().items : ['']).map((t) => row(t))); repaint(); };
  const save = act(async () => { const r = await api('/geral', { method: 'PUT', body: { items: read() } }); g().items = r.items; fill(); }, 'Aviso geral salvo. As telas trocam em até 30 segundos.');
  const dev = devicesCard();
  const node = cols(
    card('Aviso geral da prefeitura',
      el('p', { class: 'r-dim', text: 'O texto rolante do padrão da prefeitura. Ele aparece nas telas das repartições que não escreveram avisos próprios; a repartição (ou o grupo, ou a tela) que tem os seus mostra os seus.' }),
      el('form', { novalidate: true, onsubmit: save }, rows,
        el('button', { type: 'button', class: 'r-link', onclick: () => { if (rows.children.length >= g().max) return err(`No máximo ${g().max} avisos.`); const r = row(); rows.append(r); r.querySelector('input').focus(); return null; } }, '+ Outro aviso'),
        el('button', { type: 'submit', class: 'r-btn primary' }, 'Salvar avisos'))),
    [card('Como aparece na TV', pv), dev.node]);
  fill();
  return { node, refresh: dev.refresh };
}
