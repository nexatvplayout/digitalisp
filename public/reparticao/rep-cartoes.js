// NEXA Telas · página de controle da repartição · os cartões de informação, uma aba por tipo (o módulo que a prefeitura ligou):
// o editor por linhas (adicionar, tirar, arrastar para ordenar ou subir/descer pelo teclado), a validade, os segundos na
// tela e a prévia "Como aparece na TV" ao lado. A Merenda é a grade da semana (segunda a sexta): cada dia é o cartão
// "merenda" daquele dia da semana, e a tela mostra sozinha o de hoje. /api/reparticao/cards*.
import { CARD_KIND, CARD_TAB_LABEL, WEEKDAYS, CONTENT_CLASSES, LIMITS, layoutLabel } from '/shared/telas-tipos.js';
import { S, el, put, api, act, ok, card, cols, field, option } from '/reparticao/rep-base.js';
import { tvPreview } from '/shared/telas-previa.js';

let data = null; // { kinds, cards, limits }
const listeners = new Set();
async function load() { data = await api('/cards'); for (const f of listeners) f(); return data; }
const classOptions = (sel) => CONTENT_CLASSES.map((c) => option(c.key, c.label, c.key === sel));
const savedMsg = (r) => (r?.pending ? 'Enviado para a aprovação da SECOM: as telas seguem como estão até a aprovação.' : 'Salvo. As telas trocam em até 30 segundos.');
/** A prévia do cartão no formato das telas da repartição (formato sem lateral: mostra na lateral e avisa). */
function cardPreview(box, c) {
  const st = S.state; const lay = st.layout || 'side';
  const shows = ['side', 'lbar', 'portrait', 'queue'].includes(lay);
  const layout = shows ? lay : 'side';
  put(box, tvPreview({ layout, program: ['Canal da prefeitura', 'O vídeo aparece aqui'], ticker: st.avisos?.items || [], side: { title: st.office.name, widgets: ['clock'], card: c }, queue: { title: 'Chamada de senha', now: ['A 128', 'Guichê 3'], last: ['P 031', 'A 127', 'A 126'], waiting: 4 } }),
    el('p', { class: 'r-dim', text: shows ? `Prévia no formato das telas desta repartição (${layoutLabel(layout)}). O cartão se reveza com os outros na lateral.` : `As telas desta repartição estão no formato ${layoutLabel(lay)}, que não tem lateral: o cartão só aparece num formato com lateral (troque em Avisos ou em Telas).` }));
}

/** O editor por linhas: devolve { node, get(), set(linhas), focus() }; onChange a cada mudança. */
function linesEditor({ max = LIMITS.cardLines, maxLength = LIMITS.cardLine, placeholder = '', onChange = () => {} }) {
  let lines = [''];
  const list = el('ol', { class: 'r-lines' });
  const add = el('button', { type: 'button', class: 'r-link' }, '+ Linha');
  const note = el('p', { class: 'r-dim', text: `Até ${max} linhas de ${maxLength} letras. Arraste pelo ≡ para ordenar, ou use os botões de subir e descer.` });
  let dragging = null;
  const move = (i, j) => { if (j < 0 || j >= lines.length) return; const [x] = lines.splice(i, 1); lines.splice(j, 0, x); paint(j); onChange(); };
  function paint(focus = -1) {
    put(list, lines.map((text, i) => {
      const input = el('input', { type: 'text', maxlength: String(maxLength), value: text, placeholder, 'aria-label': `Linha ${i + 1}`, oninput: (e) => { lines[i] = e.target.value; onChange(); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (lines.length < max) { lines.splice(i + 1, 0, ''); paint(i + 1); onChange(); } } } });
      const row = el('li', { class: 'r-line' },
        el('span', { class: 'r-grip', draggable: 'true', title: 'Arraste para ordenar', 'aria-hidden': 'true', ondragstart: (e) => { dragging = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); row.classList.add('drag'); }, ondragend: () => { dragging = null; row.classList.remove('drag'); } }, '≡'),
        input,
        el('button', { type: 'button', class: 'r-btn small icon', 'aria-label': `Subir a linha ${i + 1}`, disabled: i === 0, onclick: () => move(i, i - 1) }, '↑'),
        el('button', { type: 'button', class: 'r-btn small icon', 'aria-label': `Descer a linha ${i + 1}`, disabled: i === lines.length - 1, onclick: () => move(i, i + 1) }, '↓'),
        el('button', { type: 'button', class: 'r-btn small', 'aria-label': `Tirar a linha ${i + 1}`, onclick: () => { lines.splice(i, 1); if (!lines.length) lines = ['']; paint(Math.min(i, lines.length - 1)); onChange(); } }, 'Tirar'));
      row.addEventListener('dragover', (e) => { if (dragging == null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('over'); });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('over'); if (dragging != null && dragging !== i) move(dragging, i); dragging = null; });
      return row;
    }));
    add.hidden = lines.length >= max;
    if (focus >= 0) list.children[focus]?.querySelector('input')?.focus();
  }
  add.addEventListener('click', () => { if (lines.length < max) { lines.push(''); paint(lines.length - 1); onChange(); } });
  paint();
  return { node: el('div', { class: 'r-linesbox' }, list, add, note), get: () => lines.map((s) => s.trim()).filter(Boolean), set: (v) => { lines = v && v.length ? [...v] : ['']; paint(); }, focus: () => list.querySelector('input')?.focus() };
}

/* ------------------------------------------------------------------ o editor de um tipo de cartão (pauta, agenda, linhas, escala…) */
function kindEditor(kind, ctx, { only = null, heading = null } = {}) {
  const K = CARD_KIND[kind];
  let editing = null; // o cartão aberto (null = novo)
  const chips = el('div', { class: 'r-chips', role: 'group', 'aria-label': 'Cartões deste tipo' });
  const title = el('input', { type: 'text', maxlength: String(LIMITS.cardTitle), placeholder: K.title });
  const weekday = el('select', {}, option('', 'Todos os dias', true), ...WEEKDAYS.map((d, i) => option(i, d)));
  const from = el('input', { type: 'date' }); const to = el('input', { type: 'date' });
  const seconds = el('input', { type: 'number', min: String(LIMITS.cardSecondsMin), max: String(LIMITS.cardSecondsMax), step: '1', value: String(LIMITS.cardSeconds) });
  const cls = el('select', {}, ...classOptions('utilidade'));
  const pv = el('div', { class: 'r-pv' });
  const current = () => ({ title: title.value.trim() || K.title, lines: ed.get() });
  const repaint = () => cardPreview(pv, current());
  const ed = linesEditor({ onChange: repaint, placeholder: K.hint.split('.')[0] });
  const del = el('button', { type: 'button', class: 'r-btn', hidden: true }, 'Excluir este cartão');
  const formTitle = el('h3', {});
  const mine = () => (data?.cards || []).filter((c) => c.kind === kind && (!only || only(c)));
  function open(c) {
    editing = c;
    formTitle.textContent = c ? `Editar: ${c.title}` : 'Novo cartão';
    title.value = c ? c.title : ''; ed.set(c ? c.lines : ['']);
    weekday.value = c && c.weekday != null ? String(c.weekday) : '';
    from.value = c?.dateFrom || ''; to.value = c?.dateTo || '';
    seconds.value = c ? c.seconds : LIMITS.cardSeconds; cls.value = c ? c.class : 'utilidade';
    del.hidden = !c;
    paintChips(); repaint();
  }
  function paintChips() {
    const list = mine();
    put(chips, list.map((c) => el('button', { type: 'button', class: `r-chip${editing?.id === c.id ? ' on' : ''}`, 'aria-pressed': String(editing?.id === c.id), onclick: () => open(c) }, `${c.title}${c.weekday != null ? ` · ${WEEKDAYS[c.weekday]}` : ''}`)),
      el('button', { type: 'button', class: `r-chip new${editing ? '' : ' on'}`, 'aria-pressed': String(!editing), onclick: () => open(null) }, '+ Novo cartão'));
  }
  const save = act(async () => {
    const body = { kind, title: title.value.trim() || K.title, lines: ed.get(), weekday: weekday.value === '' ? null : Number(weekday.value), dateFrom: from.value || null, dateTo: to.value || null, seconds: Number(seconds.value) || LIMITS.cardSeconds, class: cls.value };
    if (!body.lines.length) throw new Error('Escreva ao menos uma linha.');
    const r = editing ? await api(`/cards/${editing.id}`, { method: 'PATCH', body }) : await api('/cards', { method: 'POST', body });
    ok(savedMsg(r));
    await load();
    open(r.pending ? null : mine().find((c) => c.id === r.id) || null);
    if (r.pending) await ctx.refresh();
  });
  del.addEventListener('click', act(async () => {
    if (!editing || !confirm(`Excluir o cartão "${editing.title}"?`)) return;
    await api(`/cards/${editing.id}`, { method: 'DELETE' }); ok('Cartão excluído.'); await load(); open(mine()[0] || null);
  }));
  title.addEventListener('input', repaint);
  const main = card(heading || CARD_TAB_LABEL[kind] || K.label,
    el('p', { class: 'r-dim', text: K.hint }), chips,
    el('form', { novalidate: true, onsubmit: save }, formTitle,
      field('Título', title), ed.node,
      el('div', { class: 'r-row three' }, field('Vale de (opcional)', from), field('até (opcional)', to), field('Segundos na tela', seconds)),
      el('div', { class: 'r-row' }, field('Dia da semana', weekday, 'Com um dia marcado, o cartão só aparece naquele dia.'), field('Classificação', cls)),
      el('div', { class: 'r-btns' }, el('button', { type: 'submit', class: 'r-btn primary' }, 'Salvar'), del)));
  const side = card('Como aparece na TV', pv);
  const sync = () => { const list = mine(); if (editing) { const again = list.find((c) => c.id === editing.id); if (again) editing = again; else return open(list[0] || null); } paintChips(); return null; };
  const first = () => open(mine()[0] || null);
  return { main, side, first, sync };
}

/* ------------------------------------------------------------------ Merenda: a grade da semana */
const WEEK = [1, 2, 3, 4, 5]; const SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function merendaWeek(ctx) {
  const today = new Date().getDay();
  let sel = WEEK.includes(today) ? today : 1;
  const areas = new Map(); const cols5 = el('div', { class: 'r-week' });
  const pv = el('div', { class: 'r-pv' }); const pvTitle = el('h3', {});
  const linesOf = (d) => areas.get(d).value.split('\n').map((s) => s.trim()).filter(Boolean);
  const cardOfDay = (d) => (data?.cards || []).find((c) => c.kind === 'merenda' && c.weekday === d && !c.dateFrom && !c.dateTo) || null;
  const repaint = () => { pvTitle.textContent = `O cartão de ${WEEKDAYS[sel]}${sel === today ? ' (hoje)' : ''}`; cardPreview(pv, { title: CARD_KIND.merenda.title, lines: linesOf(sel) }); };
  for (const d of WEEK) {
    const ta = el('textarea', { rows: '8', maxlength: String((LIMITS.cardLine + 1) * LIMITS.cardLines), 'aria-label': `Cardápio de ${WEEKDAYS[d]}`, placeholder: 'Um item por linha', oninput: repaint, onfocus: () => { sel = d; mark(); repaint(); } });
    areas.set(d, ta);
    cols5.append(el('div', { class: `r-day${d === today ? ' today' : ''}`, 'data-day': String(d) },
      el('h3', { text: `${SHORT[d]}${d === today ? ' · hoje' : ''}` }), ta,
      d === 1 ? null : el('button', { type: 'button', class: 'r-btn small', onclick: () => { ta.value = areas.get(d - 1).value; sel = d; mark(); repaint(); } }, `Copiar de ${SHORT[d - 1].toLowerCase()}`)));
  }
  const mark = () => { for (const n of cols5.children) n.classList.toggle('sel', Number(n.getAttribute('data-day')) === sel); };
  const fill = () => { for (const d of WEEK) areas.get(d).value = (cardOfDay(d)?.lines || []).join('\n'); mark(); repaint(); };
  const save = act(async () => {
    for (const d of WEEK) if (linesOf(d).length > LIMITS.cardLines) throw new Error(`${WEEKDAYS[d]}: no máximo ${LIMITS.cardLines} itens.`);
    let pending = false; let n = 0;
    for (const d of WEEK) {
      const cur = cardOfDay(d); const lines = linesOf(d);
      if (!lines.length) { if (cur) { await api(`/cards/${cur.id}`, { method: 'DELETE' }); n++; } continue; }
      if (cur && JSON.stringify(cur.lines) === JSON.stringify(lines)) continue;
      const body = { kind: 'merenda', title: cur?.title || CARD_KIND.merenda.title, lines, weekday: d, seconds: cur?.seconds || LIMITS.cardSeconds, class: cur?.class || 'utilidade' };
      const r = cur ? await api(`/cards/${cur.id}`, { method: 'PATCH', body }) : await api('/cards', { method: 'POST', body });
      pending = pending || Boolean(r.pending); n++;
    }
    await load(); fill();
    ok(!n ? 'Nada mudou na semana.' : pending ? 'Semana enviada para a aprovação da SECOM: as telas seguem como estão até a aprovação.' : 'Semana salva. A tela troca de cardápio sozinha a cada dia.');
    if (pending) await ctx.refresh();
  });
  const clear = () => { if (!confirm('Limpar os cinco dias? Só vale depois de "Salvar a semana".')) return; for (const d of WEEK) areas.get(d).value = ''; repaint(); };
  const main = card('Merenda da semana',
    el('p', { class: 'r-dim', text: 'Uma coluna por dia, um item do cardápio por linha (até 8). A tela mostra sozinha a de hoje.' }),
    cols5,
    el('div', { class: 'r-btns' },
      el('button', { type: 'button', class: 'r-btn', onclick: clear }, 'Limpar a semana'),
      el('button', { type: 'button', class: 'r-btn primary', onclick: save }, 'Salvar a semana')),
    el('p', { class: 'r-dim', text: 'O cardápio fica guardado por dia da semana e vale toda semana até ser trocado: na segunda, ajuste só o que mudou. Para repetir um dia no seguinte, use "Copiar de…".' }));
  const side = card('Como aparece na TV', pvTitle, pv);
  return { main, side, fill };
}

/** A aba de um tipo de cartão. */
export function cardTab(kind, ctx) {
  const node = el('div', {});
  let onData = () => {};
  if (kind === 'merenda') {
    const week = merendaWeek(ctx);
    // cartões de merenda fora da grade (sem dia, de fim de semana ou com validade): continuam editáveis embaixo
    const extra = kindEditor('merenda', ctx, { only: (c) => !(c.weekday >= 1 && c.weekday <= 5 && !c.dateFrom && !c.dateTo), heading: 'Outros cartões de merenda' });
    const extraBox = el('div', {}, cols(extra.main, extra.side));
    node.append(cols(week.main, week.side), extraBox);
    let filled = false;
    onData = () => { if (!filled) { week.fill(); extra.first(); filled = true; } else extra.sync(); extraBox.hidden = !data.cards.some((c) => c.kind === 'merenda' && !(c.weekday >= 1 && c.weekday <= 5 && !c.dateFrom && !c.dateTo)); };
  } else {
    const e = kindEditor(kind, ctx);
    node.append(cols(e.main, e.side));
    let filled = false;
    onData = () => { if (!filled) { e.first(); filled = true; } else e.sync(); };
  }
  listeners.add(onData);
  if (data) onData();
  load().catch(() => {});
  return { node, show: () => {} };
}
