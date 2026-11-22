// TV Corporativa · aba Barras e blocos (docs/TV-CORPORATIVA.md §2.2 e §6): a barra inferior (o texto rolante com os avisos
// escritos e as fontes de notícias e cotações), a barra lateral dos layouts de sempre, e os widgets (contador regressivo,
// dias sem acidente, relógio mundial e o cardápio da semana) que entram nas playlists e nas zonas.
// Rotas: PUT /api/tvcorp/rede/defaults (avisos e blocos da lateral), GET/POST/PATCH/DELETE /api/tvcorp/widgets[/:id].
// Os dados dos widgets no formato do servidor (server/tvcorp-dados.js cleanWidget).
import { el, guard, toast, tapi, put, f, opt, label, note, empty, btn, btns, chip, dialog, D, listOf, lines, when, toLocalInput, fromLocalInput } from './tvcorp-base.js';
import { itemPreview } from '../../shared/tvcorp-previa.js';
import { WIDGETS, LIMITS as TL } from '../../shared/telas-tipos.js';
import { WIDGET_KINDS, widgetLabel, WEEK_SHORT } from './tvcorp-catalogo.js';
import { widgetItem, learnZones } from './tvcorp-playlists.js';
import { themeOf } from './tvcorp-midias.js';

const MENU_DAYS = [1, 2, 3, 4, 5, 6, 0];

let ZONES = []; // os fusos do relógio mundial (a lista do servidor)
function editWidget(w, reload, kindKey = 'countdown') {
  const kind = w?.kind || kindKey; const d = w?.data || {};
  const name = el('input', { type: 'text', maxlength: '80', value: w?.name || '', placeholder: 'Nome no painel' });
  const box = el('div', { class: 'pf-grid' }); const pv = el('div', {});
  let read = () => ({});
  const paintPv = () => { try { put(pv, itemPreview(widgetItem({ kind, name: name.value, data: read() }), { theme: themeOf() })); } catch { /* campo pela metade */ } };
  if (kind === 'countdown') {
    const title = el('input', { type: 'text', maxlength: '60', value: d.title || '', placeholder: 'Ex.: Faltam para a SIPAT' });
    const target = el('input', { type: 'datetime-local', value: toLocalInput(d.at) });
    const text = el('input', { type: 'text', maxlength: '120', value: d.text || '' });
    put(box, f('Nome do evento', title), f('Data e hora do evento', target), f('Texto curto (opcional)', text));
    read = () => ({ title: title.value.trim(), at: fromLocalInput(target.value), text: text.value.trim() });
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
  } else {
    const title = el('input', { type: 'text', maxlength: '60', value: d.title || '', placeholder: 'Ex.: Cardápio do refeitório' });
    const showPrice = el('input', { type: 'checkbox', checked: Boolean(d.showPrice) });
    const areas = Object.fromEntries(MENU_DAYS.map((n) => { const a = el('textarea', { rows: '4', placeholder: 'Um prato por linha. Preço opcional depois de " | ": Prato feito | 18,90' }); a.value = (d.days?.[String(n)] || []).map((x) => `${x.name}${x.price != null ? ` | ${String(x.price).replace('.', ',')}` : ''}`).join('\n'); return [n, a]; }));
    put(box, f('Título', title), el('div', { class: 'tc-week-menu' }, ...MENU_DAYS.map((n) => f(WEEK_SHORT[n], areas[n]))), el('label', { class: 'pf-check' }, showPrice, el('span', { text: 'Mostrar o preço na tela' })), note('A tela mostra o cardápio do dia (até 12 pratos).'));
    read = () => ({ title: title.value.trim(), showPrice: showPrice.checked, days: Object.fromEntries(MENU_DAYS.map((n) => [String(n), lines(areas[n].value).slice(0, 12).map((l) => { const [nm, pr] = l.split('|').map((x) => x.trim()); const price = pr ? Number(pr.replace(',', '.')) : null; return Number.isFinite(price) ? { name: nm, price } : { name: nm }; })])) });
  }
  box.addEventListener('input', paintPv); box.addEventListener('change', paintPv); paintPv();
  dialog(w ? `${widgetLabel(kind)} · ${w.name}` : `Novo: ${widgetLabel(kind)}`, el('div', { class: 'tc-two' }, el('div', { class: 'pf-grid' }, f('Nome', name), box), el('div', {}, label('Como aparece na TV'), pv)), {
    wide: true,
    save: async () => {
      const data = read();
      if (kind === 'countdown' && !data.at) throw new Error('Escolha a data e a hora do evento.');
      if (kind === 'countdown' && data.title.length < 2) throw new Error('Escreva o nome do evento.');
      if (kind === 'safety' && !data.lastAccident) throw new Error('Escolha a data do último acidente.');
      if (kind === 'worldclock' && !data.zones.length) throw new Error('Escolha pelo menos uma cidade.');
      const body = { kind, name: name.value.trim() || widgetLabel(kind), data };
      if (w) await tapi(`/api/tvcorp/widgets/${w.id}`, { method: 'PATCH', body }); else await tapi('/api/tvcorp/widgets', { method: 'POST', body });
      toast('Salvo. Ponha numa playlist (ou numa zona do layout) para ir às telas.'); await reload();
    },
  });
}

export default async function paintBarras(box, ctx) {
  const d = D();
  const wr = await tapi('/api/tvcorp/widgets');
  const widgets = listOf(wr, 'widgets'); ZONES = wr?.zones || []; learnZones(ZONES);
  const again = () => paintBarras(box, ctx);
  const cfg = d.defaults?.config || {};
  /* barra inferior */
  const avisos = el('textarea', { rows: '5', maxlength: String(TL.tickerItems * (TL.tickerItem + 1)), placeholder: 'Um aviso por linha' }); avisos.value = (cfg.tickerItems || []).join('\n');
  const saveTicker = guard(async () => {
    const items = lines(avisos.value);
    if (items.length > TL.tickerItems) throw new Error(`No máximo ${TL.tickerItems} avisos.`);
    await tapi('/api/tvcorp/rede/defaults', { method: 'PUT', body: { config: { tickerItems: items } } });
    toast('Texto rolante salvo. As telas trocam em até 1 minuto.'); await ctx.reload();
  });
  /* barra lateral (os layouts de sempre) */
  const wid = new Set(cfg.widgets || []);
  const saveSide = guard(async () => { await tapi('/api/tvcorp/rede/defaults', { method: 'PUT', body: { config: { widgets: [...wid] } } }); toast('Barra lateral salva.'); await ctx.reload(); });
  put(box,
    el('div', { class: 'card tc-sec' },
      el('h3', { text: 'Barra inferior (texto rolante)' }),
      note('Vale em toda zona "Texto rolante" dos layouts. Os avisos escritos aqui são da empresa toda; cada unidade e cada grupo podem ter os seus (aba Unidades e grupos e o link da unidade).'),
      f(`Avisos (até ${TL.tickerItems}, ${TL.tickerItem} letras cada)`, avisos),
      note('Notícias e cotações vão às telas como itens de playlist (aba Playlists) ou numa zona própria do layout.'),
      btns(btn('Salvar o texto rolante', saveTicker, 'primary'))),
    el('div', { class: 'card tc-sec' },
      el('h3', { text: 'Barra lateral' }),
      note('Nos layouts por zonas, a lateral é uma zona: escolha o que ela mostra na aba Layouts (playlist, relógio, clima, QR code, notícias, cotações, contador…). Aqui ficam os blocos da lateral dos formatos de sempre (quando nenhuma grade vale).'),
      el('div', { class: 'pf-checks row' }, ...WIDGETS.map((w) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: wid.has(w.key), onchange: (e) => { if (e.target.checked) wid.add(w.key); else wid.delete(w.key); } }), el('span', { text: w.label })))),
      btns(btn('Salvar a barra lateral', saveSide))),
    el('div', { class: 'card tc-sec' },
      el('h3', { text: 'Blocos informativos (widgets)' }),
      note('Contador regressivo para eventos e campanhas, dias sem acidente, relógio mundial e o cardápio da semana. Entram nas playlists (item "Contador, dias sem acidente…").'),
      btns(...WIDGET_KINDS.map((k) => btn(`+ ${k.label}`, () => editWidget(null, again, k.key), 'small'))),
      widgets.length ? el('div', { class: 'tc-wgrid' }, ...widgets.map((w) => el('div', { class: 'tc-wcard' },
        itemPreview(widgetItem(w), { theme: themeOf() }),
        el('div', { class: 'tc-lcard-b' }, chip(widgetLabel(w.kind)), ' ', el('b', { text: w.name }), el('div', { class: 'dim small', text: `atualizado ${when(w.updatedAt)}` }),
          btns(btn('Editar', () => editWidget(w, again), 'small'), btn('Apagar', guard(async () => { if (!confirm(`Apagar "${w.name}"? Sai das playlists.`)) return; await tapi(`/api/tvcorp/widgets/${w.id}`, { method: 'DELETE' }); await again(); }), 'small danger'))))))
        : empty('Nenhum widget ainda.')));
}
