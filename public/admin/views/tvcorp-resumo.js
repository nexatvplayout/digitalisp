// TV Corporativa · aba Resumo (docs/TV-CORPORATIVA.md §6): telas no ar, sem imagem e desligadas, itens em exibição agora,
// horas em exibição (hoje, 7 e 30 dias), pedidos aguardando e a lista das telas desligadas com "desde quando".
// GET /api/tvcorp/summary; sem ele (módulo ainda sem a rota), os contadores saem das telas que o painel já tem.
import { el, tapi, put, note, label, table, btn, btns, empty, active, counters, statusOf, officeOf, when, ago, now, dot, STATUS } from './tvcorp-base.js';
import { hoursText } from './tvcorp-catalogo.js';

const card = (num, text, cls = '', onclick = null) => el(onclick ? 'button' : 'div', { class: `tc-card ${cls}`, type: onclick ? 'button' : null, onclick },
  el('b', { class: 'tc-num', text: String(num) }), el('span', { text }));

export default async function paintResumo(box, ctx) {
  let s = null;
  try { s = await tapi('/api/tvcorp/summary'); } catch { /* sem o resumo do servidor: conta pelo que tem */ }
  const devs = active();
  const n = s?.devices || { ...counters(devs), total: devs.length };
  const off = s?.off || devs.filter((d) => ['off', 'never'].includes(statusOf(d))).map((d) => ({ id: d.id, name: d.name, office: officeOf(d.officeId)?.name, since: d.lastSeen }));
  const total = n.total ?? devs.length;
  if (!total) {
    put(box, el('div', { class: 'card pf-empty' },
      el('h3', { text: 'Comece pela primeira tela' }),
      note('Cadastre a unidade (matriz, filial, fábrica, loja), gere a chave de acesso e digite-a na TV box com o aplicativo NEXA Telas. Depois monte as mídias, as playlists e a grade.', 'dim'),
      btns(btn('Unidades e grupos', () => ctx.go('unidades'), 'primary'), btn('Aplicativos', () => ctx.go('instalar')), btn('Ver as mídias', () => ctx.go('midias')))));
    return;
  }
  put(box,
    el('div', { class: 'tc-cards' },
      card(n.on ?? 0, 'telas no ar', 'on'),
      card(n.warn ?? 0, 'ligadas, sem imagem', 'warn'),
      card((n.off ?? 0) + (n.never ?? 0), n.never ? `desligadas (${n.never} nunca ligaram)` : 'desligadas', 'off'),
      card(total, 'telas na rede')),
    el('div', { class: 'tc-cards' },
      card(s?.itemsNow ?? '—', 'itens em exibição agora'),
      card(s ? hoursText(s.hours?.today) : '—', 'em exibição hoje (todas as telas)'),
      card(s ? hoursText(s.hours?.days7) : '—', 'nos últimos 7 dias'),
      card(s ? hoursText(s.hours?.days30) : '—', 'nos últimos 30 dias'),
      card(s?.pending ?? '—', 'pedidos aguardando aprovação', s?.pending ? 'warn' : '', s?.pending ? () => ctx.go('aprovacoes') : null)),
    s ? null : note('As horas em exibição e os itens no ar aparecem quando o servidor mandar o resumo da TV Corporativa.'),
    label(`Telas desligadas (${off.length})`),
    off.length ? table(['Tela', 'Unidade', 'Desde'], off.map((x) => el('tr', {},
      el('td', {}, dot(x.since ? 'off' : 'never'), ' ', el('b', { text: x.name })),
      el('td', { text: x.office || '—' }),
      el('td', { text: x.since ? `${when(x.since)} (${ago(now() - x.since)})` : STATUS.never }))))
      : empty('Nenhuma tela desligada agora.'),
    s?.top?.length ? label('O que mais passou hoje') : null,
    s?.top?.length ? table(['Item', 'Vezes', 'Tempo'], s.top.map((x) => el('tr', {}, el('td', { text: x.title || x.ref }), el('td', { text: String(x.plays) }), el('td', { text: hoursText(x.seconds) })))) : null,
    btns(btn('Ver as telas', () => ctx.go('telas')), btn('Relatórios', () => ctx.go('relatorios')), btn('Grade', () => ctx.go('grade'))));
}
