// TV Corporativa · aba Notícias e dados (docs/TV-CORPORATIVA.md §2.3 e §7.3): as fontes que o servidor busca sozinho e
// entrega prontas às telas (o aparelho nunca busca nada fora): notícias de agências públicas com o crédito na tela, o RSS
// da própria empresa, cotações (valores de referência), clima por unidade e trânsito. "Testar" busca uma vez e mostra.
// Rotas: GET/POST/PATCH/DELETE /api/tvcorp/feeds[/:id], POST /api/tvcorp/feeds/:id/test.
import { el, guard, toast, tapi, put, f, opt, table, label, note, empty, btn, btns, chip, dialog, D, listOf, when, ago, now, lines } from './tvcorp-base.js';
import { ufCityPicker } from '../../shared/uf-city.js'; // o mesmo seletor de UF e Município dos cadastros (lista do IBGE)
import { FEED_KINDS, feedKindLabel, LIMITS } from './tvcorp-catalogo.js';

/** O catálogo do servidor (GET /api/tvcorp/feeds): as agências liberadas, as moedas e as fontes de cotação. */
let CAT = { news: [], currencies: {}, ptax: [], providers: {} };

function detail(x) {
  const c = x.config || {};
  if (x.kind === 'rss') return c.source && c.source !== 'own' ? CAT.news.find((p) => p.key === c.source)?.name || c.source : c.url || '—';
  if (x.kind === 'quotes') return `${CAT.providers[c.provider] || ''}: ${(c.currencies || []).map((k) => CAT.currencies[k] || k).join(', ')}`;
  if (x.kind === 'weather') return `${c.city || ''}${c.uf ? `/${c.uf}` : ''} · ${c.offices?.length ? `${c.offices.length} unidade(s)` : 'todas as unidades'}`;
  if (x.kind === 'traffic') return c.mode === 'rio' ? 'ocorrências do Rio de Janeiro' : `${(c.lines || []).length} aviso(s) escrito(s)`;
  return '—';
}

function testFeed(x) {
  const body = el('div', {}, note('Buscando…'));
  dialog(`Testar · ${x.name}`, body, { wide: true });
  guard(async () => {
    const r = await tapi(`/api/tvcorp/feeds/${x.id}/test`, { method: 'POST', body: {} });
    // o clima não tem lista de itens: mostra a temperatura de agora, a mínima e a máxima e os próximos dias
    if (x.kind === 'weather') {
      const c = r.cache || r.feed?.preview || null;
      const deg = (v) => (v == null ? '—' : `${Math.round(v)}°`);
      const dia = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? `${m[3]}/${m[2]}` : String(s || ''); };
      put(body, r.error ? el('p', { class: 'pf-err', text: r.error }) : null,
        c && c.tempC != null ? el('div', {},
          el('p', { text: `${c.city || ''}${c.uf ? `/${c.uf}` : ''}: ${deg(c.tempC)}${c.text ? ` · ${c.text}` : ''} (mín. ${deg(c.min)}, máx. ${deg(c.max)})` }),
          (c.days || []).length ? table(['Dia', 'Mín.', 'Máx.', 'Tempo'], c.days.map((d) => el('tr', {}, el('td', { text: dia(d.date) }), el('td', { text: deg(d.min) }), el('td', { text: deg(d.max) }), el('td', { text: d.text || '' })))) : null,
          note(`Fonte: ${c.source || '—'}${c.at ? ` · ${when(c.at)}` : ''}. A tela mostra a temperatura e a previsão desta cidade.`, 'small dim'))
          : r.error ? null : empty('A fonte do clima respondeu sem a previsão. Confira o município (UF e cidade).'));
      return;
    }
    const items = (r.cache?.items || r.feed?.preview?.items || []).map((it) => ({ ...it, title: it.title || (it.code ? `${it.code}: ${it.sell ?? it.buy ?? ''}` : '') }));
    put(body, r.error ? el('p', { class: 'pf-err', text: r.error }) : null,
      items.length ? table(['Item', 'Fonte', 'Hora'], items.slice(0, 20).map((it) => el('tr', {}, el('td', { text: it.title || it.label || '—' }), el('td', { text: it.source || '' }), el('td', { text: it.at ? when(it.at) : '' }))))
        : empty('A fonte respondeu sem itens.'),
      note('Na tela sai só o título, a fonte e a hora (e o QR code para a matéria). O texto vem limpo, sem formatação.'));
  })();
}

function editFeed(x, reload, kindKey = 'rss') {
  const kind = x?.kind || kindKey; const c = x?.config || {};
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name), value: x?.name || '' });
  const refresh = el('input', { type: 'number', min: String(LIMITS.feedRefreshMin), max: String(LIMITS.feedRefreshMax), value: String(x?.refreshMin ?? (kind === 'rss' ? 30 : 60)) });
  const enabled = el('input', { type: 'checkbox', checked: x ? x.enabled !== false : true });
  const kindSel = el('select', { disabled: Boolean(x) }, ...FEED_KINDS.map((k) => opt(k.key, k.label, k.key === kind)));
  const box = el('div', { class: 'pf-grid' });
  let read = () => ({});
  const paint = () => {
    const k = kindSel.value;
    if (k === 'rss') {
      const cur = c.source || (x ? 'own' : CAT.news[0]?.key || 'own');
      const src = el('select', {}, ...CAT.news.map((p) => opt(p.key, p.name, cur === p.key)), opt('own', 'Endereço próprio da empresa (https)', cur === 'own'));
      const url = el('input', { type: 'url', maxlength: '500', value: c.url || '', placeholder: 'https://…/feed' });
      const credit = el('input', { type: 'text', maxlength: '60', value: c.credit || '', placeholder: 'Ex.: Blog da empresa' });
      const hint = note('');
      const sync = () => { const own = src.value === 'own'; url.disabled = !own; credit.disabled = !own; const p = CAT.news.find((y) => y.key === src.value); hint.textContent = p ? `Uso livre com o crédito. Na tela: "Fonte: ${p.credit}".` : 'Só o RSS da própria empresa (intranet, blog). Portais comerciais de notícia pedem contrato de licença: não cadastre.'; if (p && !name.value) name.value = p.name; };
      src.addEventListener('change', sync); sync();
      const each = el('input', { type: 'number', min: '5', max: '120', value: String(c.secondsEach ?? 12) });
      put(box, f('Fonte', src), f('Endereço', url), f('Crédito na tela', credit), f('Cada notícia fica na tela (segundos, 5 a 120)', each), hint);
      const segs = () => Math.max(5, Math.min(120, Math.round(Number(each.value) || 12)));
      read = () => { if (src.value !== 'own') return { source: src.value, secondsEach: segs() }; if (!/^https:\/\//.test(url.value.trim())) throw new Error('O endereço precisa começar com https://'); return { source: 'own', url: url.value.trim(), credit: credit.value.trim(), secondsEach: segs() }; };
    } else if (k === 'quotes') {
      const picks = new Set(c.currencies || ['USD', 'EUR']);
      const provider = el('select', {}, ...Object.entries(CAT.providers).map(([k, l]) => opt(k, l, (c.provider || 'awesome') === k)));
      const list = el('div', { class: 'pf-checks' });
      const paintCur = () => { const allowed = provider.value === 'ptax' ? CAT.ptax : Object.keys(CAT.currencies); for (const k of [...picks]) if (!allowed.includes(k)) picks.delete(k);
        put(list, ...allowed.map((k) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: picks.has(k), onchange: (e) => { if (e.target.checked) picks.add(k); else picks.delete(k); } }), el('span', { text: CAT.currencies[k] || k })))); };
      provider.addEventListener('change', paintCur); paintCur();
      put(box, f('Fonte das cotações', provider), list, note('Cotações de dados abertos, com a hora da cotação e o aviso "valores de referência" na tela. Até 8 moedas.'));
      read = () => { if (!picks.size) throw new Error('Escolha pelo menos uma moeda.'); return { provider: provider.value, currencies: [...picks] }; };
    } else if (k === 'weather') {
      const picks = new Set(c.offices || []);
      const uc = ufCityPicker({ uf: c.uf || '', cityIbge: c.ibge || null, idPrefix: 'tcw' });
      const offices = D().offices;
      put(box, uc.ufField, uc.cityField, note('As unidades que mostram o clima desta cidade. Nenhuma marcada: vale para todas as unidades sem outra cidade.'),
        offices.length ? el('div', { class: 'pf-checks' }, ...offices.map((o) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: picks.has(o.id), onchange: (e) => { if (e.target.checked) picks.add(o.id); else picks.delete(o.id); } }), el('span', { text: o.name })))) : note('Nenhuma unidade ainda (aba Unidades e grupos).'),
        note('O provedor do clima é o escolhido pela equipe da plataforma, com licença para uso comercial.'));
      read = () => { const err = uc.validate(); if (err) throw new Error(err); const v = uc.value(); if (!v.cityIbge) throw new Error('Escolha o estado e o município.'); if (!name.value.trim()) name.value = `Clima de ${v.city}`; return { ibge: v.cityIbge, city: v.city, uf: v.uf, offices: [...picks] }; };
    } else {
      const mode = el('select', {}, opt('rio', 'Rio de Janeiro: as ocorrências oficiais', c.mode === 'rio'), opt('texto', 'Avisos escritos por mim', c.mode !== 'rio'));
      const txt = el('textarea', { rows: '4', placeholder: 'Um aviso por linha (até 10)' }); txt.value = (c.lines || []).join('\n');
      const sync = () => { txt.disabled = mode.value === 'rio'; };
      mode.addEventListener('change', sync); sync();
      put(box, f('De onde', mode), f('Avisos de trânsito', txt), note('Só o Rio de Janeiro tem fonte automática. Nas outras cidades, escreva os avisos.'));
      read = () => (mode.value === 'rio' ? { mode: 'rio' } : { mode: 'texto', lines: lines(txt.value).slice(0, 10) });
    }
  };
  kindSel.addEventListener('change', paint); paint();
  dialog(x ? `Fonte · ${x.name}` : 'Nova fonte de dados', el('div', { class: 'pf-grid' }, f('Tipo', kindSel), f('Nome', name), box,
    el('div', { class: 'pf-grid two' }, f(`Buscar a cada (minutos, ${LIMITS.feedRefreshMin} a ${LIMITS.feedRefreshMax})`, refresh), el('label', { class: 'pf-check' }, enabled, el('span', { text: 'Ligada' })))), {
    save: async () => {
      const body = { kind: kindSel.value, name: name.value.trim() || feedKindLabel(kindSel.value), config: read(), refreshMin: Math.max(LIMITS.feedRefreshMin, Math.min(LIMITS.feedRefreshMax, Number(refresh.value) || 60)), enabled: enabled.checked };
      if (x) await tapi(`/api/tvcorp/feeds/${x.id}`, { method: 'PATCH', body }); else await tapi('/api/tvcorp/feeds', { method: 'POST', body });
      toast('Fonte salva. A primeira busca sai em instantes.');
      await reload();
    },
  });
}

/**
 * As notícias de uma fonte, uma a uma, como vão para as telas: a foto e a manchete. "Tirar da programação" esconde a notícia
 * das telas (e "Devolver" traz de volta); as notícias novas da próxima busca entram sozinhas.
 */
function newsCards(x) {
  const wrap = el('div', { class: 'tc-news-sec' }, label(`Notícias de ${x.name} na programação`), note('Carregando…', 'small dim'));
  const paint = guard(async () => {
    const r = await tapi(`/api/tvcorp/feeds/${x.id}/noticias`);
    const items = r?.items || [];
    const vai = items.filter((i) => !i.hidden).length;
    const toggle = (i) => guard(async () => {
      await tapi(`/api/tvcorp/feeds/${x.id}/noticias/${i.key}/ocultar`, { method: i.hidden ? 'DELETE' : 'POST', body: {} });
      toast(i.hidden ? 'A notícia voltou para a programação.' : 'Notícia tirada da programação: as telas param de mostrar na próxima atualização.');
      await paint();
    });
    put(wrap, label(`Notícias de ${x.name} na programação (${vai} de ${items.length}) · cada uma fica ${x.config?.secondsEach ?? 12} s na tela`),
      note('Para mudar o tempo de cada notícia, use "Editar" nesta fonte.', 'small dim'),
      items.length ? el('div', { class: 'tc-news-grid' }, ...items.map((i) => el('div', { class: `tc-news-card${i.hidden ? ' off' : ''}` },
        i.image ? el('img', { src: i.image, alt: '', loading: 'lazy' }) : el('div', { class: 'tc-news-nofoto', text: 'Sem foto' }),
        el('div', { class: 'tc-news-body' }, el('b', { text: i.title }), el('span', { class: 'dim small', text: [i.at ? when(i.at) : '', i.hidden ? 'fora da programação' : ''].filter(Boolean).join(' · ') }),
          btn(i.hidden ? 'Devolver à programação' : 'Tirar da programação', toggle(i), i.hidden ? 'small' : 'small danger')))))
        : empty('Nenhuma notícia ainda: use "Buscar agora".'));
  });
  paint();
  return wrap;
}

export default async function paintDados(box, ctx) {
  const r = await tapi('/api/tvcorp/feeds');
  const list = listOf(r, 'feeds');
  if (r?.catalog) CAT = { news: r.catalog.news || [], currencies: r.catalog.currencies || {}, ptax: r.catalog.ptax || [], providers: r.catalog.providers || {} };
  const again = () => paintDados(box, ctx);
  // buscar agora: a mesma busca do servidor, na hora (sem esperar o intervalo); depois a lista mostra a hora e a situação novas
  const buscar = async (x) => {
    const r2 = await tapi(`/api/tvcorp/feeds/${x.id}/test`, { method: 'POST', body: {} });
    if (r2?.error) throw new Error(`${x.name}: ${r2.error}`);
  };
  const buscarUma = (x) => guard(async () => { try { await buscar(x); toast(`${x.name}: buscada agora.`); } finally { await again(); } });
  const buscarTodas = guard(async () => {
    const erros = [];
    for (const x of list.filter((y) => y.enabled !== false)) { try { await buscar(x); } catch (e) { erros.push(e.message); } }
    toast(erros.length ? erros.join(' · ') : 'Todas as fontes foram buscadas agora.', erros.length > 0);
    await again();
  });
  const rows = list.map((x) => el('tr', { class: x.enabled === false ? 'pf-gone' : '' },
    el('td', {}, el('b', { text: x.name }), el('div', { class: 'dim small', text: detail(x) })),
    el('td', {}, chip(feedKindLabel(x.kind))),
    el('td', { text: `a cada ${x.refreshMin} min` }),
    el('td', {}, x.fetchedAt ? ago(now() - x.fetchedAt) : 'ainda não buscou', x.preview?.items ? el('div', { class: 'dim small', text: `${x.preview.items.length} item(ns)${x.stale ? ' · antigo' : ''}` }) : null),
    el('td', {}, x.lastError ? el('span', { class: 'pf-err small', text: x.lastError }) : el('span', { class: 'dim small', text: x.enabled === false ? 'desligada' : 'ok' })),
    el('td', { class: 'pf-actions' }, btn('Buscar agora', buscarUma(x), 'small primary'), btn('Testar', () => testFeed(x), 'small'), btn('Editar', () => editFeed(x, again), 'small'),
      btn('Apagar', guard(async () => { if (!confirm(`Apagar a fonte "${x.name}"? Os itens dela somem das playlists.`)) return; await tapi(`/api/tvcorp/feeds/${x.id}`, { method: 'DELETE' }); await again(); }), 'small danger'))));
  put(box,
    note('O servidor busca cada fonte sozinho e entrega às telas os itens prontos. Se uma busca falha, a tela continua com o último resultado bom por até 6 horas.'),
    btns(...FEED_KINDS.map((k) => btn(`+ ${k.label}`, () => editFeed(null, again, k.key), k.key === 'rss' ? 'primary' : '')), el('span', { class: 'dim small', text: `${list.length} de ${LIMITS.feeds}` }), list.length ? btn('Buscar todas agora', buscarTodas) : null),
    rows.length ? table(['Fonte', 'Tipo', 'Atualiza', 'Última busca', 'Situação', ''], rows) : empty('Nenhuma fonte ainda. Comece pelas notícias da Agência Brasil ou pelas cotações.'),
    ...list.filter((x) => x.kind === 'rss').map((x) => newsCards(x)),
    label('Fontes de notícias liberadas'),
    el('ul', { class: 'pf-plain' }, ...CAT.news.map((p) => el('li', { text: `${p.name}: uso livre com o crédito (na tela: "Fonte: ${p.credit}")` }))),
    note('Notícias: só título, fonte, hora e o QR code para a matéria, sempre com o crédito. Esportes, celebridades e horóscopo não entram: falta direito de uso e qualidade de fonte.'));
}
