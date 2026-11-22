// TV Corporativa · aba Relatórios (docs/TV-CORPORATIVA.md §2.6 e §6): o relatório de exibição (o que passou, onde,
// quantas vezes e por quanto tempo; por item, tela ou unidade), as horas em exibição por tela e a disponibilidade das
// telas (7 e 30 dias). CSV para planilha e Imprimir (o navegador salva em PDF). O vídeo do canal não entra aqui: a
// audiência do canal fica nos relatórios do canal.
// Rotas: GET /api/tvcorp/reports/plays?from=&to=&by=&format=csv, GET /api/tvcorp/reports/hours, GET /api/tvcorp/rede/availability.
import { el, guard, tapi, tdownload, put, f, opt, table, label, note, empty, btn, btns, D, isoDay, dayText, pct, officeOf } from './tvcorp-base.js';
import { hoursText } from './tvcorp-catalogo.js';

const V = { from: null, to: null, by: 'item', sec: 'exibicao' };
const BY = [['item', 'Por item'], ['device', 'Por tela'], ['office', 'Por unidade']];
const KIND = { media: 'Imagem ou slide', posts: 'Comunicados em vigor', card: 'Cartão', image: 'Imagem', slide: 'Slide', post: 'Comunicado', kpi: 'Indicador', birthdays: 'Aniversariantes', news: 'Notícias', quotes: 'Cotações', widget: 'Widget', menu: 'Cardápio' };
const print = () => { document.body.classList.add('tc-printing-report'); window.print(); setTimeout(() => document.body.classList.remove('tc-printing-report'), 500); };

export default async function paintRelatorios(box, ctx) {
  V.from ??= isoDay(6); V.to ??= isoDay(0);
  const from = el('input', { type: 'date', value: V.from, 'aria-label': 'De' }); const to = el('input', { type: 'date', value: V.to, 'aria-label': 'Até' });
  const by = el('select', { 'aria-label': 'Agrupar' }, ...BY.map(([k, t]) => opt(k, t, V.by === k)));
  const out = el('div', { class: 'tc-report' });
  const q = () => `from=${encodeURIComponent(V.from)}&to=${encodeURIComponent(V.to)}`;
  const read = () => { V.from = from.value; V.to = to.value; V.by = by.value; if (V.to < V.from) throw new Error('O fim do período vem antes do começo.'); };
  const show = guard(async () => {
    read();
    if (V.sec === 'exibicao') {
      const r = await tapi(`/api/tvcorp/reports/plays?${q()}&by=${V.by}`);
      const rows = r.rows || [];
      const tot = rows.reduce((a, x) => ({ plays: a.plays + (x.plays || 0), seconds: a.seconds + (x.seconds || 0) }), { plays: 0, seconds: 0 });
      put(out, el('h3', { text: `Relatório de exibição · ${dayText(V.from)} a ${dayText(V.to)} · ${BY.find(([k]) => k === V.by)[1].toLowerCase()}` }),
        rows.length ? table(V.by === 'item' ? ['Item', 'Tipo', 'Vezes', 'Tempo na tela', 'Telas'] : V.by === 'device' ? ['Tela', 'Unidade', 'Vezes', 'Tempo na tela', 'Dias com exibição'] : ['Unidade', 'Vezes', 'Tempo na tela', 'Telas'],
          [...rows.map((x) => el('tr', {}, el('td', { text: x.name || x.label || x.ref || '—' }), V.by === 'office' ? null : el('td', { text: V.by === 'item' ? KIND[x.kind] || x.kind || '—' : x.office || '—' }),
            el('td', { text: (x.plays || 0).toLocaleString('pt-BR') }), el('td', { text: hoursText(x.seconds) }), el('td', { text: String(V.by === 'device' ? x.days ?? '—' : x.devices ?? '—') }))),
          el('tr', { class: 'tc-total' }, el('td', { text: 'Total' }), V.by === 'office' ? null : el('td', { text: '' }), el('td', { text: tot.plays.toLocaleString('pt-BR') }), el('td', { text: hoursText(tot.seconds) }), el('td', { text: '' }))])
          : empty('Nada passou neste período (ou as telas ainda não mandaram a contagem).'),
        note('Conta cada vez que um item apareceu numa tela e por quanto tempo, pelo que a própria TV box informa a cada sinal de vida.'));
    } else if (V.sec === 'horas') {
      const r = await tapi(`/api/tvcorp/reports/hours?${q()}`);
      const rows = r.rows || [];
      put(out, el('h3', { text: `Horas em exibição · ${dayText(V.from)} a ${dayText(V.to)}` }),
        rows.length ? table(['Tela', 'Unidade', 'Horas em exibição', 'Dias com sinal'], rows.map((x) => el('tr', {}, el('td', { text: x.name || x.device || `#${x.deviceId}` }), el('td', { text: x.office || officeOf(x.officeId)?.name || '—' }), el('td', { text: hoursText(x.seconds) }), el('td', { text: String(x.days ?? '—') }))))
          : empty('Sem horas registradas neste período.'));
    } else {
      const r = await tapi('/api/tvcorp/rede/availability');
      const byId = new Map((r.devices || []).map((x) => [x.id, x]));
      const devs = D().devices.filter((x) => !x.revokedAt);
      put(out, el('h3', { text: 'Disponibilidade das telas (tempo no ar sobre o tempo acompanhado)' }),
        devs.length ? table(['Tela', 'Unidade', 'Últimos 7 dias', 'Últimos 30 dias'], devs.map((x) => el('tr', {}, el('td', { text: x.name }), el('td', { text: officeOf(x.officeId)?.name || '—' }), el('td', { text: pct(byId.get(x.id)?.d7) }), el('td', { text: pct(byId.get(x.id)?.d30) }))))
          : empty('Nenhuma tela ainda.'));
    }
  });
  const csv = guard(async () => { read(); await tdownload(V.sec === 'horas' ? `/api/tvcorp/reports/hours?${q()}&format=csv` : `/api/tvcorp/reports/plays?${q()}&by=${V.by}&format=csv`, `${V.sec === 'horas' ? 'horas-em-exibicao' : 'relatorio-de-exibicao'}-${V.from}-a-${V.to}.csv`); });
  const seg = (id, text) => el('button', { class: `btn small${V.sec === id ? ' primary' : ''}`, type: 'button', 'aria-pressed': String(V.sec === id), onclick: () => { V.sec = id; paintRelatorios(box, ctx); } }, text);
  put(box,
    el('div', { class: 'pf-btns left tc-seg' }, seg('exibicao', 'Relatório de exibição'), seg('horas', 'Horas em exibição'), seg('disponibilidade', 'Disponibilidade das telas')),
    V.sec === 'disponibilidade' ? null : el('div', { class: 'pf-bar' }, f('De', from), f('Até', to), V.sec === 'exibicao' ? f('Agrupar', by) : null,
      btn('Ver', show, 'primary'), btn('Baixar CSV', csv), btn('Imprimir ou salvar em PDF', print)),
    V.sec === 'disponibilidade' ? btns(btn('Imprimir ou salvar em PDF', print)) : null,
    out);
  await show();
}
