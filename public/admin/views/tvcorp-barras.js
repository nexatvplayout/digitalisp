// TV Corporativa · aba Barras e blocos (docs/TV-CORPORATIVA.md §2.2 e §6): a barra inferior (o texto rolante com os avisos
// escritos e as fontes de notícias e cotações), a barra lateral dos layouts de sempre, e os widgets (contador regressivo,
// dias sem acidente, relógio mundial e o cardápio da semana) que entram nas playlists e nas zonas.
// Rotas: PUT /api/tvcorp/rede/defaults (avisos e blocos da lateral), GET/POST/PATCH/DELETE /api/tvcorp/widgets[/:id].
// Os dados dos widgets no formato do servidor (server/tvcorp-dados.js cleanWidget).
import { el, guard, toast, tapi, put, f, opt, label, note, empty, btn, btns, chip, dialog, D, listOf, lines, when, toLocalInput, fromLocalInput } from './tvcorp-base.js';
import { itemPreview, tickWidgets } from '../../shared/tvcorp-previa.js';
import { WIDGETS, LIMITS as TL } from '../../shared/telas-tipos.js';
import { WIDGET_KINDS, widgetLabel, WEEK_SHORT } from './tvcorp-catalogo.js';
import { widgetItem, learnZones } from './tvcorp-playlists.js';
import { themeOf } from './tvcorp-midias.js';
import { faixaCard } from './tvcorp-faixa.js';

const MENU_DAYS = [1, 2, 3, 4, 5, 6, 0];

let ZONES = []; // os fusos do relógio mundial (a lista do servidor)
let FEEDS = []; // as fontes (o clima escolhe a dele)
let KPIS = []; // os indicadores (o painel de indicadores escolhe os dele)
function editWidget(w, reload, kindKey = 'countdown') {
  const kind = w?.kind || kindKey; const d = w?.data || {};
  const name = el('input', { type: 'text', maxlength: '80', value: w?.name || '', placeholder: 'Nome no painel' });
  const box = el('div', { class: 'pf-grid' }); const pv = el('div', {});
  let read = () => ({});
  const paintPv = () => { try { put(pv, itemPreview(widgetItem({ kind, name: name.value, data: read() }, { kpis: KPIS, feeds: FEEDS }), { theme: themeOf() })); } catch { /* campo pela metade */ } };
  if (kind === 'countdown') {
    const title = el('input', { type: 'text', maxlength: '60', value: d.title || '', placeholder: 'Ex.: Faltam para a SIPAT' });
    const target = el('input', { type: 'datetime-local', value: toLocalInput(d.at) });
    const until = el('input', { type: 'datetime-local', value: toLocalInput(d.until) });
    const text = el('input', { type: 'text', maxlength: '120', value: d.text || '' });
    put(box, f('Nome do evento', title), f('Começa em (data e hora)', target, 'Antes disso, a tela mostra quanto falta para começar.'),
      f('Termina em (opcional)', until, 'Depois de começar, a tela mostra quanto falta para terminar (promoção, inscrições, evento).'), f('Texto curto (opcional)', text));
    read = () => ({ title: title.value.trim(), at: fromLocalInput(target.value), ...(until.value ? { until: fromLocalInput(until.value) } : {}), text: text.value.trim() });
  } else if (kind === 'safety') {
    const title = el('input', { type: 'text', maxlength: '60', value: d.title || '', placeholder: 'Dias sem acidente' });
    const since = el('input', { type: 'date', value: d.lastAccident || '' });
    const record = el('input', { type: 'number', min: '0', value: d.record ?? '' }); const goal = el('input', { type: 'number', min: '1', value: d.goal ?? '' });
    put(box, f('Título', title), f('Data do último acidente', since, 'A tela conta os dias sozinha a partir desta data.'), el('div', { class: 'pf-grid two' }, f('Recorde (dias)', record), f('Meta (dias)', goal)));
    read = () => ({ title: title.value.trim(), lastAccident: since.value || null, record: record.value === '' ? null : Number(record.value), goal: goal.value === '' ? null : Number(goal.value) });
  } else if (kind === 'worldclock') {
    const picks = new Set(d.zones || []);
    put(box, label('Cidades (até 6)'), el('div', { class: 'pf-checks tall' }, ...ZONES.map(({ tz, label: l }) => el('label', { class: 'pf-check' },
      el('input', { type: 'checkbox', checked: picks.has(tz), onchange: (e) => { if (e.target.checked) { if (picks.size >= 6) { e.target.checked = false; toast('No máximo 6 cidades.', true); return; } picks.add(tz); } else picks.delete(tz); paintPv(); } }), el('span', { text: l })))));
    read = () => ({ zones: [...picks] });
  } else if (kind === 'weather') {
    const feeds = FEEDS.filter((x) => x.kind === 'weather');
    const feed = el('select', {}, opt('', feeds.length ? 'A fonte de clima da unidade' : 'Nenhuma fonte de clima (aba Notícias e dados)', !d.feedId), ...feeds.map((x) => opt(x.id, x.name, Number(d.feedId) === x.id)));
    const days = el('select', {}, ...[1, 2, 3, 4].map((n) => opt(n, `${n} ${n === 1 ? 'dia' : 'dias'} de previsão`, Number(d.days || 4) === n)));
    const title = el('input', { type: 'text', maxlength: '60', value: d.title || '', placeholder: 'Vazio = o nome da cidade' });
    put(box, f('Fonte do clima', feed, 'A cidade vem da fonte de clima (aba Notícias e dados).'), f('Previsão', days), f('Título (opcional)', title));
    read = () => ({ ...(feed.value ? { feedId: Number(feed.value) } : {}), days: Number(days.value), title: title.value.trim() });
  } else if (kind === 'clock') {
    const face = el('select', {}, opt('digital', 'Digital (números)', d.face !== 'analog'), opt('analog', 'Analógico (ponteiros)', d.face === 'analog'));
    const tz = el('select', {}, opt('', 'O fuso da empresa (Configurações)', !d.tz), ...ZONES.map(({ tz: z, label: l }) => opt(z, l, d.tz === z)));
    const lbl = el('input', { type: 'text', maxlength: '40', value: d.label || '', placeholder: 'Ex.: Horário de Brasília' });
    const secs = el('input', { type: 'checkbox', checked: d.showSeconds !== false }); const date = el('input', { type: 'checkbox', checked: d.date !== false });
    put(box, f('Tipo', face), f('Fuso', tz), f('Legenda (opcional)', lbl), el('label', { class: 'pf-check' }, secs, el('span', { text: 'Mostrar os segundos' })), el('label', { class: 'pf-check' }, date, el('span', { text: 'Mostrar a data' })));
    read = () => ({ face: face.value, tz: tz.value, label: lbl.value.trim(), showSeconds: secs.checked, date: date.checked });
  } else if (kind === 'agenda') {
    const title = el('input', { type: 'text', maxlength: '60', value: d.title || '', placeholder: 'Ex.: Agenda da semana, Sala de reuniões 2' });
    const ev = el('textarea', { rows: '8', placeholder: 'Um por linha: data | horário | compromisso | local\n25/11 | 09:00-10:00 | Reunião geral | Auditório\n28/11 | | Treinamento de brigada | Pátio' });
    const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
    ev.value = (d.events || []).map((e) => [br(e.date), [e.time, e.end].filter(Boolean).join('-'), e.title, e.place || ''].join(' | ')).join('\n');
    const ics = el('input', { type: 'url', value: d.icsUrl || '', placeholder: 'Cole aqui o endereço iCal (.ics) da agenda' });
    const icsOk = el('p', { class: 'small', 'aria-live': 'polite' });
    const conferir = guard(async () => { icsOk.textContent = 'Conferindo…'; const r = await tapi('/api/tvcorp/widgets/conferir-fonte', { method: 'POST', body: { kind: 'agenda', url: ics.value } }).catch((e) => { icsOk.textContent = e.message; return null; }); if (r) icsOk.textContent = `Achei ${r.count} compromisso(s) dos próximos 45 dias${r.sample?.[0] ? `, por exemplo: ${r.sample[0].title}` : ''}.`; });
    put(box, f('Título', title),
      f('Agenda do Google ou do Outlook (opcional)', ics, 'Google Agenda: Configurações da agenda > "Endereço público no formato iCal" (ou o endereço secreto). Outlook: Calendário > Publicar agenda > link ICS. A tela atualiza sozinha a cada 15 minutos.'),
      btns(btn('Conferir o link', conferir, 'small')), icsOk,
      f('Compromissos digitados (até 40, somam com os da agenda)', ev, 'A tela mostra de hoje em diante, até 6 por vez. Data como 25/11 (o ano é o próximo 25/11) ou 25/11/2027.'));
    read = () => ({ title: title.value.trim(), icsUrl: ics.value.trim(), events: lines(ev.value).map((l) => {
      const [dt = '', hr = '', what = '', place = ''] = l.split('|').map((x) => x.trim());
      const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(dt); const now = new Date();
      let y = m?.[3] ? Number(m[3]) : now.getFullYear();
      if (m && !m[3] && new Date(y, Number(m[2]) - 1, Number(m[1]) + 1) < now) y += 1;
      const [time, end] = hr.split('-').map((x) => x.trim()).map((x) => (/^\d{1,2}:\d{2}$/.test(x) ? x.padStart(5, '0') : ''));
      return { date: m ? `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : dt, ...(time ? { time } : {}), ...(end ? { end } : {}), title: what, place };
    }) });
  } else if (kind === 'reviews') {
    const title = el('input', { type: 'text', maxlength: '60', value: d.title || '', placeholder: 'O que dizem os clientes' });
    const rv = el('textarea', { rows: '6', placeholder: 'Um por linha: nome | estrelas (1 a 5) | depoimento\nAna P. | 5 | Atendimento excelente e entrega rápida!' });
    rv.value = (d.items || []).map((x) => [x.name, x.stars, x.text].join(' | ')).join('\n');
    const qr = el('input', { type: 'url', value: d.qr || '', placeholder: 'https://… (onde o cliente avalia, opcional)' });
    put(box, f('Título', title), f('Depoimentos (até 12; a tela mostra 3 por vez)', rv, 'Escreva só depoimentos que os clientes autorizaram mostrar.'), f('QR code para avaliar (opcional)', qr));
    read = () => ({ title: title.value.trim(), items: lines(rv.value).map((l) => { const [name = '', st = '5', ...rest] = l.split('|').map((x) => x.trim()); return { name, stars: Number(st) || 5, text: rest.join(' | ') }; }), ...(qr.value.trim() ? { qr: qr.value.trim() } : {}) });
  } else if (kind === 'dashboard') {
    const title = el('input', { type: 'text', maxlength: '60', value: d.title || '', placeholder: 'Ex.: Resultados do mês' });
    const picks = new Set((d.kpis || []).map(Number));
    put(box, f('Título', title), label('Indicadores (até 6)'), KPIS.length ? el('div', { class: 'pf-checks tall' }, ...KPIS.map((k) => el('label', { class: 'pf-check' },
      el('input', { type: 'checkbox', checked: picks.has(k.id), onchange: (e) => { if (e.target.checked) { if (picks.size >= 6) { e.target.checked = false; toast('No máximo 6 indicadores.', true); return; } picks.add(k.id); } else picks.delete(k.id); paintPv(); } }),
      el('span', { text: k.name })))) : note('Nenhum indicador ainda: crie na aba Indicadores (à mão, por planilha ou por API).'));
    read = () => ({ title: title.value.trim(), kpis: [...picks] });
  } else if (kind === 'directions') {
    const title = el('input', { type: 'text', maxlength: '60', value: d.title || '', placeholder: 'Como chegar' });
    const addr = el('input', { type: 'text', maxlength: '120', value: d.address || '', placeholder: 'Rua, número, bairro, cidade' });
    const ref = el('input', { type: 'text', maxlength: '120', value: d.reference || '', placeholder: 'Ponto de referência (opcional)' });
    const hours = el('input', { type: 'text', maxlength: '80', value: d.hours || '', placeholder: 'Horário (opcional)' });
    const phone = el('input', { type: 'text', maxlength: '30', value: d.phone || '', placeholder: 'Telefone (opcional)' });
    const qr = el('input', { type: 'url', value: d.qr || '', placeholder: 'https://… o link do mapa (opcional)' });
    put(box, f('Título', title), f('Endereço', addr), f('Referência', ref), f('Horário', hours), f('Telefone', phone), f('QR code com o mapa', qr, 'Cole o link de compartilhar do aplicativo de mapas que você usa.'));
    read = () => ({ title: title.value.trim(), address: addr.value.trim(), reference: ref.value.trim(), hours: hours.value.trim(), phone: phone.value.trim(), ...(qr.value.trim() ? { qr: qr.value.trim() } : {}) });
  } else if (kind === 'web') {
    const url = el('input', { type: 'url', value: d.url || '', placeholder: 'https://…' });
    const refresh = el('input', { type: 'number', min: '0', max: '1440', value: String(d.refreshMin ?? 0) });
    put(box, f('Endereço da página', url), f('Recarregar a cada (minutos, 0 = não)', refresh),
      note('Painéis públicos (Power BI, Looker Studio, Grafana), cardápio on-line, site da empresa. Alguns sites não deixam ser abertos dentro de outro (bloqueio do próprio site): nesses, a TV Samsung/LG mostra o aviso e o Android abre direto.'));
    read = () => ({ url: url.value.trim(), refreshMin: Number(refresh.value) || 0 });
  } else {
    const title = el('input', { type: 'text', maxlength: '60', value: d.title || '', placeholder: 'Ex.: Cardápio do refeitório' });
    const showPrice = el('input', { type: 'checkbox', checked: Boolean(d.showPrice) });
    const areas = Object.fromEntries(MENU_DAYS.map((n) => { const a = el('textarea', { rows: '4', placeholder: 'Um prato por linha. Preço opcional depois de " | ": Prato feito | 18,90' }); a.value = (d.days?.[String(n)] || []).map((x) => `${x.name}${x.price != null ? ` | ${String(x.price).replace('.', ',')}` : ''}`).join('\n'); return [n, a]; }));
    const csv = el('input', { type: 'url', value: d.csvUrl || '', placeholder: 'Cole aqui o link da planilha do Google' });
    const csvOk = el('p', { class: 'small', 'aria-live': 'polite' });
    const conferirCsv = guard(async () => { csvOk.textContent = 'Conferindo…'; const r = await tapi('/api/tvcorp/widgets/conferir-fonte', { method: 'POST', body: { kind: 'menu', url: csv.value } }).catch((e) => { csvOk.textContent = e.message; return null; }); if (r) csvOk.textContent = `Achei ${r.count} item(ns)${r.sample?.[0] ? `, por exemplo: ${r.sample[0].name}${r.sample[0].price != null ? ` (R$ ${String(r.sample[0].price).replace('.', ',')})` : ''}` : ''}.`; });
    put(box, f('Título', title),
      f('Planilha do Google (opcional: cardápio ou tabela de preços que se atualiza sozinha)', csv, 'Na primeira linha: item, preço, descrição e, se quiser, dia (seg, ter… ou vazio para todo dia). Compartilhe como "qualquer pessoa com o link pode ver" e cole o link. A tela confere a cada 15 minutos; com a planilha, os pratos digitados abaixo só valem se ela não responder.'),
      btns(btn('Conferir a planilha', conferirCsv, 'small')), csvOk,
      el('div', { class: 'tc-week-menu' }, ...MENU_DAYS.map((n) => f(WEEK_SHORT[n], areas[n]))), el('label', { class: 'pf-check' }, showPrice, el('span', { text: 'Mostrar o preço na tela' })), note('A tela mostra o cardápio do dia (até 12 pratos).'));
    read = () => ({ title: title.value.trim(), showPrice: showPrice.checked, csvUrl: csv.value.trim(), days: Object.fromEntries(MENU_DAYS.map((n) => [String(n), lines(areas[n].value).slice(0, 12).map((l) => { const [nm, pr] = l.split('|').map((x) => x.trim()); const price = pr ? Number(pr.replace(',', '.')) : null; return Number.isFinite(price) ? { name: nm, price } : { name: nm }; })])) });
  }
  box.addEventListener('input', paintPv); box.addEventListener('change', paintPv); paintPv();
  dialog(w ? `${widgetLabel(kind)} · ${w.name}` : `Novo: ${widgetLabel(kind)}`, el('div', { class: 'tc-two' }, el('div', { class: 'pf-grid' }, f('Nome', name), box), el('div', {}, label('Como aparece na TV'), pv)), {
    wide: true,
    save: async () => {
      const data = read();
      if (kind === 'countdown' && !data.at) throw new Error('Escolha a data e a hora do evento.');
      if (kind === 'countdown' && data.title.length < 2) throw new Error('Escreva o nome do evento.');
      if (kind === 'countdown' && data.until && data.until <= data.at) throw new Error('O fim precisa ser depois do começo.');
      if (kind === 'safety' && !data.lastAccident) throw new Error('Escolha a data do último acidente.');
      if (kind === 'worldclock' && !data.zones.length) throw new Error('Escolha pelo menos uma cidade.');
      if (kind === 'dashboard' && !data.kpis.length) throw new Error('Escolha pelo menos um indicador.');
      if (kind === 'web' && !/^https:\/\//.test(data.url)) throw new Error('O endereço precisa começar com https://');
      if (kind === 'directions' && data.address.length < 4) throw new Error('Escreva o endereço.');
      const body = { kind, name: name.value.trim() || widgetLabel(kind), data };
      const saved = w ? await tapi(`/api/tvcorp/widgets/${w.id}`, { method: 'PATCH', body }) : await tapi('/api/tvcorp/widgets', { method: 'POST', body });
      // a página que recusa ser aberta dentro de outra (o servidor conferiu os cabeçalhos do site ao salvar)
      if (kind === 'web' && saved?.data?.embeddable === false) toast('Salvo, mas este site não deixa ser aberto dentro de outro: nas TVs Samsung e LG aparece um aviso no lugar dele (no Android abre normalmente).', true);
      else toast('Salvo. Ponha numa playlist (ou numa zona do layout) para ir às telas.');
      await reload();
    },
  });
}

export default async function paintBarras(box, ctx) {
  const d = D();
  const wr = await tapi('/api/tvcorp/widgets');
  const widgets = listOf(wr, 'widgets'); ZONES = wr?.zones || []; learnZones(ZONES);
  [FEEDS, KPIS] = await Promise.all([['/api/tvcorp/feeds', 'feeds'], ['/api/tvcorp/kpis', 'kpis']].map(([p, k]) => tapi(p).then((r) => listOf(r, k)).catch(() => [])));
  const again = () => paintBarras(box, ctx);
  // os relógios e os contadores andam também aqui (um por segundo, enquanto a aba está aberta)
  clearInterval(paintBarras.tick); paintBarras.tick = setInterval(() => { if (!box.isConnected) { clearInterval(paintBarras.tick); return; } tickWidgets(box); }, 1000);
  const cfg = d.defaults?.config || {};
  /* barra lateral (os layouts de sempre) */
  const wid = new Set(cfg.widgets || []);
  const saveSide = guard(async () => { await tapi('/api/tvcorp/rede/defaults', { method: 'PUT', body: { config: { widgets: [...wid] } } }); toast('Barra lateral salva.'); await ctx.reload(); });
  put(box,
    /* barra inferior: os avisos com estilo e a faixa (tvcorp-faixa.js) */
    faixaCard(cfg, () => ctx.reload()),
    el('div', { class: 'card tc-sec' },
      el('h3', { text: 'Barra lateral' }),
      note('Nos layouts por zonas, a lateral é uma zona: escolha o que ela mostra na aba Layouts (playlist, relógio, clima, QR code, notícias, cotações, contador…). Aqui ficam os blocos da lateral dos formatos de sempre (quando nenhuma grade vale).'),
      // com grade, esta lateral não aparece: dizer onde pôr o relógio e o clima (o dono marcou aqui e nada saiu na TV)
      d.schedules?.length ? el('div', { class: 'tc-onde' },
        el('b', { text: 'Suas telas estão numa grade, então esta barra lateral não aparece nelas.' }),
        note(`Grade(s): ${d.schedules.map((s) => s.name).join(', ')}. Para o relógio, o clima ou outro bloco aparecer, edite o layout da grade (aba Layouts) e ponha uma zona "Relógio", "Clima" ou "Gadget" — ou acrescente o gadget na playlist da zona.`, 'small'),
        btns(btn('Abrir os Layouts', () => { location.hash = '#tvcorp/layouts'; }, 'small'))) : null,
      el('div', { class: 'pf-checks row' }, ...WIDGETS.map((w) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: wid.has(w.key), onchange: (e) => { if (e.target.checked) wid.add(w.key); else wid.delete(w.key); } }), el('span', { text: w.label })))),
      btns(btn('Salvar a barra lateral', saveSide))),
    el('div', { class: 'card tc-sec' },
      el('h3', { text: 'Blocos informativos (widgets)' }),
      note('Os gadgets da tela: contador para eventos e promoções, relógio (digital ou analógico), clima com previsão, agenda e salas, painel de indicadores, avaliações de clientes, como chegar, página da internet, dias sem acidente, relógio mundial e cardápio da semana. Entram numa playlist (item "Gadget") ou direto numa zona do layout (zona "Gadget").'),
      btns(...WIDGET_KINDS.map((k) => btn(`+ ${k.label}`, () => editWidget(null, again, k.key), 'small'))),
      widgets.length ? el('div', { class: 'tc-wgrid' }, ...widgets.map((w) => el('div', { class: 'tc-wcard' },
        itemPreview(widgetItem(w, { kpis: KPIS, feeds: FEEDS }), { theme: themeOf() }),
        el('div', { class: 'tc-lcard-b' }, chip(widgetLabel(w.kind)), ' ', el('b', { text: w.name }), el('div', { class: 'dim small', text: `atualizado ${when(w.updatedAt)}` }),
          btns(btn('Editar', () => editWidget(w, again), 'small'), btn('Apagar', guard(async () => { if (!confirm(`Apagar "${w.name}"? Sai das playlists.`)) return; await tapi(`/api/tvcorp/widgets/${w.id}`, { method: 'DELETE' }); await again(); }), 'small danger'))))))
        : empty('Nenhum widget ainda.')));
}
