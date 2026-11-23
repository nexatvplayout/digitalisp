// TV Corporativa · aba Playlists (docs/TV-CORPORATIVA.md §2.2, §3.1 e §6): a sequência de itens com o tempo de cada um,
// a validade (início e fim), os dias e a faixa de horário por item, e os itens automáticos (aniversariantes, notícias e
// cotações, indicadores, comunicados, contador e outros widgets). Montar arrastando ou pelas setas.
// Rotas: GET/POST/PATCH/DELETE /api/tvcorp/playlists[/:id] e PUT /api/tvcorp/playlists/:id/items (a lista inteira).
import {
  el, guard, toast, tapi, tblob, put, f, opt, table, label, note, empty, btn, btns, chip, dialog, D, listOf, when, dayText,
} from './tvcorp-base.js';
import { itemPreview } from '../../shared/tvcorp-previa.js';
import { ITEM_KINDS, ITEM_KIND, LIMITS, WEEK_SHORT, minToHm, hmToMin, daysOf, daysText, kpiBand, shortName, widgetLabel, feedKindLabel } from './tvcorp-catalogo.js';
import { themeOf, slideEditor } from './tvcorp-midias.js';
import { quadrosDaPlaylist, formatoDaMidia, combina, dicaArte, FORMATO_TXT } from './tvcorp-quadros.js';
import { templatesPara } from './tvcorp-templates.js';
import { SLIDE_TEMPLATE } from './tvcorp-catalogo.js';

const officeName = (id) => (id == null ? 'Empresa toda' : D().offices.find((o) => o.id === id)?.name || `#${id}`);
const secs = (n) => { const m = Math.floor(n / 60); const s = n % 60; return m ? `${m} min${s ? ` ${s} s` : ''}` : `${s} s`; };

/** As listas que os itens citam (lidas ao abrir o editor; uma que falhe fica vazia). */
export async function sources() {
  const get = ([p, key]) => tapi(p).then((r) => listOf(r, key)).catch(() => []);
  const [media, posts, kpis, feeds, widgets, people] = await Promise.all([['/api/tvcorp/media', 'media'], ['/api/tvcorp/posts', 'posts'], ['/api/tvcorp/kpis', 'kpis'], ['/api/tvcorp/feeds', 'feeds'], ['/api/tvcorp/widgets', 'widgets'], ['/api/tvcorp/people?limit=500', 'people']].map(get));
  return { media: media.filter((m) => m.status !== 'rejected'), posts, kpis, feeds: feeds.filter((x) => x.kind === 'rss' || x.kind === 'quotes' || x.kind === 'weather'), widgets, people };
}
/** O nome de um item na lista. */
export function itemTitle(it, src) {
  const k = ITEM_KIND[it.refKind]?.label || it.refKind;
  const find = (list) => list.find((x) => x.id === it.refId);
  if (it.refKind === 'media') return find(src.media)?.title || `Mídia #${it.refId} (apagada?)`;
  if (it.refKind === 'post') return `Comunicado: ${find(src.posts)?.title || `#${it.refId}`}`;
  if (it.refKind === 'kpi') return `Indicador: ${find(src.kpis)?.name || `#${it.refId}`}`;
  if (it.refKind === 'news' || it.refKind === 'quotes') { const x = find(src.feeds); return x ? `${feedKindLabel(x.kind)}: ${x.name}` : it.refId ? `Fonte #${it.refId}` : k; }
  if (it.refKind === 'widget') { const x = find(src.widgets); return x ? `${widgetLabel(x.kind)}: ${x.name}` : `Widget #${it.refId}`; }
  if (it.refKind === 'birthdays') return `Aniversariantes ${({ day: 'do dia', week: 'da semana', month: 'do mês' })[it.params?.range || 'week']}`;
  return k;
}
/** O item como o app desenha, com os dados que o painel tem (a prévia; na TV os dados vêm prontos do servidor). */
export async function previewOf(it, src) {
  const theme = themeOf();
  const find = (list) => list.find((x) => x.id === it.refId);
  if (it.refKind === 'media') {
    const m = find(src.media); if (!m) return itemPreview({ kind: 'none', title: 'Mídia apagada' }, { theme });
    if (m.kind === 'slide') {
      // a foto do slide (boas-vindas, oferta…) é outra mídia, guardada pelo número em fields.image
      const image = m.fields?.image ? await tblob(`/api/tvcorp/media/${m.fields.image}/file`).catch(() => null) : null;
      return itemPreview({ kind: 'slide', template: m.template, fields: m.fields, image }, { theme });
    }
    if (m.kind === 'video') return itemPreview({ kind: 'video', poster: m.poster ? await tblob(m.poster).catch(() => null) : null, seconds: m.seconds, title: m.title, processing: m.status !== 'ok' }, { theme });
    return itemPreview({ kind: 'image', url: await tblob(`/api/tvcorp/media/${m.id}/file`).catch(() => null), title: m.title }, { theme });
  }
  if (it.refKind === 'post') { const p = find(src.posts); return itemPreview({ kind: 'post', category: p?.category, title: p?.title, body: p?.text, qr: p?.qr }, { theme }); }
  if (it.refKind === 'posts') { const p = src.posts.filter((x) => x.situation === 'em vigor')[0]; return p ? itemPreview({ kind: 'post', category: p.category, title: p.title, body: p.text, qr: p.qr }, { theme }) : itemPreview({ kind: 'text', title: 'Comunicados em vigor', text: 'Nenhum comunicado em vigor agora.' }, { theme }); }
  if (it.refKind === 'kpi') { const k = find(src.kpis); return itemPreview({ kind: 'kpi', name: k?.name, value: k?.value, target: k?.target, unit: k?.unit, band: kpiBand(k), direction: k?.direction }, { theme }); }
  if (it.refKind === 'birthdays') {
    const now = new Date(); const range = it.params?.range || 'week';
    const bd = (p) => p.birthday || { day: p.bdayDay, month: p.bdayMonth };
    const ppl = src.people.filter((p) => p.active !== false && bd(p).month && (range === 'month' ? bd(p).month === now.getMonth() + 1 : range === 'day' ? bd(p).month === now.getMonth() + 1 && bd(p).day === now.getDate()
      : (() => { for (let i = 0; i < 7; i++) { const d = new Date(now.getTime() + i * 86400000); if (bd(p).month === d.getMonth() + 1 && bd(p).day === d.getDate()) return true; } return false; })()));
    // pela data (como o servidor manda): da virada do ano em diante, a partir de hoje
    const key = (p) => { const d = bd(p); const v = d.month * 100 + d.day; const today = (now.getMonth() + 1) * 100 + now.getDate(); return v < today ? v + 1300 : v; };
    ppl.sort((x, y) => key(x) - key(y));
    // a foto de quem autorizou (pela sessão, como a miniatura das mídias); sem ela, as iniciais
    const photos = await Promise.all(ppl.slice(0, 8).map((p) => (p.photo && p.photoConsent !== false ? tblob(`/api/tvcorp/people/${p.id}/photo`).catch(() => null) : null)));
    const title = { day: 'Aniversariantes do dia', week: 'Aniversariantes da semana', month: 'Aniversariantes do mês' }[range];
    return itemPreview({ kind: 'birthdays', title, people: ppl.slice(0, 8).map((p, i) => ({ name: p.display || shortName(p.name), day: bd(p).day, month: bd(p).month, sector: p.sector, ...(photos[i] ? { photo: photos[i] } : {}) })) }, { theme });
  }
  if (it.refKind === 'news' || it.refKind === 'quotes') {
    const x = find(src.feeds); const c = x?.preview || {};
    if (it.refKind === 'quotes') return itemPreview({ kind: 'quotes', title: x?.name, at: c.at, source: c.source || '', items: (c.items || []).map((i) => ({ label: i.code, value: i.sell ?? i.buy, change: i.change ?? null, prefix: 'R$', decimals: 2 })) }, { theme });
    return itemPreview({ kind: 'news', title: x?.name, items: (c.items || []).map((i) => ({ ...i, source: c.source })), source: c.source || x?.name || '' }, { theme });
  }
  if (it.refKind === 'widget') return itemPreview(widgetItem(find(src.widgets), { kpis: src.kpis, feeds: src.feeds }), { theme });
  return itemPreview({ kind: 'none' }, { theme });
}
/** Um widget (tvcorp_widgets) no formato do item que o app recebe (contrato §4.1). */
const ZONE_NAMES = new Map();
/** O nome da cidade de um fuso (a lista vem do servidor em GET /api/tvcorp/widgets; sem ela, o fim do nome do fuso). */
export const zoneName = (tz) => ZONE_NAMES.get(tz) || String(tz).split('/').pop().replace(/_/g, ' ');
export const learnZones = (list) => { for (const z of list || []) ZONE_NAMES.set(z.tz, z.label); };
export function widgetItem(w, { kpis = [], feeds = [] } = {}) {
  const d = w?.data || {};
  // DIGITAL ISP: os gadgets novos (o painel não tem os dados ao vivo do clima: usa o último da fonte, ou um exemplo)
  if (w?.kind === 'weather') {
    const f = feeds.find((x) => x.id === Number(d.feedId)) || feeds.find((x) => x.kind === 'weather'); const c = f?.preview || {};
    const sample = [['seg', 19, 28], ['ter', 18, 27], ['qua', 20, 30], ['qui', 19, 26]].map(([weekday, min, max]) => ({ weekday, min, max }));
    return { kind: 'weather', title: d.title || c.city || 'Clima', city: c.city, tempC: c.tempC ?? 26, text: c.text || 'Exemplo: a tela mostra o clima da fonte', days: (c.days?.length ? c.days : sample).slice(0, d.days || 4), source: c.source };
  }
  if (w?.kind === 'clock') return { kind: 'clock', face: d.face, tz: d.tz || undefined, label: d.label, showSeconds: d.showSeconds, date: d.date };
  if (w?.kind === 'agenda') { const t = new Date(); const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; return { kind: 'agenda', title: d.title, today, events: (d.events || []).filter((e) => e.date >= today) }; }
  if (w?.kind === 'reviews') return { kind: 'reviews', title: d.title, items: d.items || [], qr: d.qr };
  if (w?.kind === 'dashboard') return { kind: 'dashboard', title: d.title, items: (d.kpis || []).map((id) => kpis.find((k) => k.id === Number(id))).filter(Boolean).map((k) => ({ name: k.name, value: k.value, target: k.target, unit: k.unit, band: kpiBand(k) })) };
  if (w?.kind === 'directions') return { kind: 'directions', ...d };
  if (w?.kind === 'web') return { kind: 'web', url: d.url, refreshMin: d.refreshMin, embeddable: d.embeddable };
  // os dados como o servidor guarda (server/tvcorp-dados.js cleanWidget) no formato do item que a tela recebe
  if (w?.kind === 'menu') { const day = new Date().getDay(); return { kind: 'menu', title: d.title || 'Cardápio de hoje', day: WEEK_SHORT[day], items: (d.days?.[String(day)] || []).map((x) => (d.showPrice ? x : { name: x.name })) }; }
  if (w?.kind === 'worldclock') return { kind: 'worldclock', title: w.name, clocks: (d.zones || []).map((tz) => ({ tz, label: zoneName(tz) })) };
  if (w?.kind === 'countdown') return { kind: 'countdown', title: d.title, target: d.at, ...(d.until ? { until: d.until } : {}), text: d.text };
  if (w?.kind === 'safety') return { kind: 'safety', title: d.title, since: d.lastAccident, record: d.record, goal: d.goal };
  return { kind: 'none' };
}

/** O editor dos itens de uma playlist. */
async function editItems(pl, reload) {
  const [full, src] = await Promise.all([tapi(`/api/tvcorp/playlists/${pl.id}`), sources()]);
  let items = (full?.items || []).map((x) => ({ ...x, params: x.params || {} }));
  let sel = items.length ? 0 : -1; let dragFrom = null;
  const quadros = quadrosDaPlaylist(D(), pl.id);
  const formatos = [...new Set(quadros.map((q) => q.formato))];
  // o formato pedido pelos quadros (um só formato: ele; quase quadrado ou mistura: nenhum filtro)
  const alvo = formatos.length === 1 && formatos[0] !== 'quad' ? formatos[0] : null;
  const serve = (m) => quadros.every((q) => combina(formatoDaMidia(m), q.formato));
  const ondePassa = quadros.length
    ? el('div', { class: 'tc-onde' }, el('b', { text: 'Onde esta playlist passa' }),
      ...quadros.map((q) => note(`${q.grade} · ${q.nome}. ${dicaArte(q)}`, 'small')),
      formatos.length > 1 ? note('Atenção: ela passa em quadros de formatos diferentes. O que combina com um fica cortado ou com sobras no outro; o ideal é uma playlist para cada formato.', 'small warn') : null)
    : note('Esta playlist ainda não está em nenhuma grade: quando ela entrar num layout, aqui aparece o tamanho do quadro e as artes que combinam.', 'small');
  const list = el('ol', { class: 'tc-items' });
  const pv = el('div', { class: 'tc-item-pv' });
  const total = el('span', { class: 'dim small' });
  const paintPv = guard(async () => { put(pv, sel >= 0 && items[sel] ? await previewOf(items[sel], src) : note('Escolha um item para ver a prévia.')); });
  const move = (from, to) => { if (to < 0 || to >= items.length || from === to) return; const [x] = items.splice(from, 1); items.splice(to, 0, x); sel = to; paint(); };
  function whenBox(it) {
    const days = new Set(daysOf(it.days));
    const tf = el('input', { type: 'time', value: minToHm(it.timeFrom), 'aria-label': 'A partir de' }); const tt = el('input', { type: 'time', value: minToHm(it.timeTo), 'aria-label': 'Até' });
    const vf = el('input', { type: 'date', value: it.validFrom || '', 'aria-label': 'Começa em' }); const vt = el('input', { type: 'date', value: it.validTo || '', 'aria-label': 'Termina em' });
    const sync = () => { it.days = [...days].sort().join(','); it.timeFrom = hmToMin(tf.value); it.timeTo = hmToMin(tt.value); it.validFrom = vf.value || null; it.validTo = vt.value || null; };
    for (const n of [tf, tt, vf, vt]) n.addEventListener('change', () => { sync(); paintSummary(); });
    return el('div', { class: 'tc-when' },
      el('div', { class: 'pf-checks row' }, ...[1, 2, 3, 4, 5, 6, 0].map((n) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: days.has(n), onchange: (e) => { if (e.target.checked) days.add(n); else days.delete(n); sync(); paintSummary(); } }), el('span', { text: WEEK_SHORT[n] })))),
      el('div', { class: 'pf-grid two' }, f('Das (vazio = o dia todo)', tf), f('Até', tt), f('Começa em (validade)', vf), f('Termina em', vt)),
      note('Nenhum dia marcado = todo dia. Fora do dia, do horário ou da validade, o item é pulado.'));
  }
  const whenText = (it) => [daysText(it.days), it.timeFrom != null || it.timeTo != null ? `${minToHm(it.timeFrom) || '00:00'}–${minToHm(it.timeTo) || '24:00'}` : '', it.validFrom || it.validTo ? `de ${dayText(it.validFrom)} a ${dayText(it.validTo)}` : ''].filter(Boolean).join(' · ');
  function paintSummary() { const n = items.reduce((a, x) => a + (Number(x.seconds) || 0), 0); total.textContent = `${items.length} de ${LIMITS.itemsPerZone} itens · uma volta leva ${secs(n)}`; }
  function paint() {
    put(list, ...items.map((it, i) => {
      const s = el('input', { type: 'number', min: String(LIMITS.secondsMin), max: String(LIMITS.secondsMax), value: String(it.seconds ?? LIMITS.secondsDefault), 'aria-label': 'Segundos', class: 'tc-secs',
        onchange: (e) => { it.seconds = Math.max(LIMITS.secondsMin, Math.min(LIMITS.secondsMax, Number(e.target.value) || LIMITS.secondsDefault)); e.target.value = String(it.seconds); paintSummary(); } });
      const wb = el('div', { hidden: true }, whenBox(it));
      const li = el('li', { class: `tc-item${i === sel ? ' sel' : ''}`, draggable: 'true',
        ondragstart: (e) => { dragFrom = i; e.dataTransfer?.setData?.('text/plain', String(i)); li.classList.add('drag'); },
        ondragend: () => li.classList.remove('drag'),
        ondragover: (e) => { e.preventDefault(); li.classList.add('over'); }, ondragleave: () => li.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); li.classList.remove('over'); if (dragFrom != null) move(dragFrom, i); dragFrom = null; } },
      el('div', { class: 'tc-item-row' },
        el('span', { class: 'tc-grip', 'aria-hidden': 'true', text: '⋮⋮' }),
        el('button', { class: 'tc-item-name', type: 'button', onclick: () => { sel = i; paint(); } }, el('b', { text: itemTitle(it, src) }), el('span', { class: 'dim small', text: whenText(it) })),
        s, el('span', { class: 'dim small', text: 's' }),
        el('select', { class: 'tc-fx', 'aria-label': 'Como o item entra na tela', title: 'Como o item entra na tela', onchange: (e) => { it.params = { ...it.params, transition: e.target.value || undefined }; if (!e.target.value) delete it.params.transition; } },
          ...[['', 'Entra: corte'], ['fade', 'Esmaecer'], ['slide', 'Deslizar'], ['zoom', 'Aproximar']].map(([v, t]) => opt(v, t, (it.params?.transition || '') === v))),
        it.refKind === 'media' && src.media.find((x) => x.id === it.refId)?.kind !== 'video' ? el('label', { class: 'pf-check small', title: 'A foto aproxima devagar enquanto está na tela' }, el('input', { type: 'checkbox', checked: Boolean(it.params?.kenburns), onchange: (e) => { it.params = { ...it.params }; if (e.target.checked) it.params.kenburns = true; else delete it.params.kenburns; } }), el('span', { text: 'Zoom lento' })) : null,
        btn('Quando passa', () => { wb.hidden = !wb.hidden; }, 'small'),
        el('button', { class: 'btn small', type: 'button', 'aria-label': 'Subir', onclick: () => move(i, i - 1), disabled: i === 0 }, '↑'),
        el('button', { class: 'btn small', type: 'button', 'aria-label': 'Descer', onclick: () => move(i, i + 1), disabled: i === items.length - 1 }, '↓'),
        btn('Tirar', () => { items.splice(i, 1); sel = Math.min(sel, items.length - 1); paint(); }, 'small danger')),
      wb);
      return li;
    }));
    if (!items.length) list.append(el('li', { class: 'dim tc-empty', text: 'Playlist vazia. Acrescente itens ao lado.' }));
    paintSummary(); paintPv();
  }
  /* acrescentar: o tipo e o registro (ou o automático), a prévia do que vai entrar e a criação rápida */
  const kind = el('select', {}, ...ITEM_KINDS.map((k) => opt(k.key, k.label)));
  const pick = el('select', { 'aria-label': 'Qual' });
  const range = el('select', { 'aria-label': 'Quais aniversariantes' }, opt('day', 'do dia'), opt('week', 'da semana', true), opt('month', 'do mês'));
  const pickHint = note('');
  const quick = el('div', { class: 'tc-quick' });
  const candPv = el('div', { class: 'tc-item-pv tc-cand-pv' });
  const candLabel = label('Como vai aparecer');
  const poolOf = (k) => (k.pick === 'media' ? [...src.media].sort((a, b) => Number(serve(b)) - Number(serve(a))).map((m) => [m.id, `${serve(m) ? '' : '⚠ '}${m.kind === 'slide' ? 'Slide' : m.kind === 'video' ? 'Vídeo' : 'Imagem'}: ${m.title}${formatoDaMidia(m) ? ` (${formatoDaMidia(m) === 'port' ? 'em pé' : formatoDaMidia(m) === 'land' ? 'deitado' : 'quadrado'})` : ''}${serve(m) ? '' : ' · formato diferente do quadro'}${m.status === 'pending' ? ' (aguardando aprovação)' : ''}`])
    : k.pick === 'post' ? src.posts.filter((p) => p.status !== 'rejected').map((p) => [p.id, `${p.title} (${p.situation || 'em vigor'})`]) : k.pick === 'kpi' ? src.kpis.map((x) => [x.id, x.name])
      : k.pick === 'feed' ? src.feeds.filter((x) => x.kind === k.feedKind).map((x) => [x.id, x.name]) : k.pick === 'widget' ? src.widgets.map((x) => [x.id, `${widgetLabel(x.kind)}: ${x.name}`]) : []);
  /** O item que entraria agora (o tipo e o registro escolhidos). */
  const candidate = () => { const k = ITEM_KIND[kind.value]; return k.auto ? { refKind: k.key, refId: null, params: k.key === 'birthdays' ? { range: range.value } : {} } : pick.value ? { refKind: k.key, refId: Number(pick.value), params: {} } : null; };
  let candSeq = 0;
  const paintCand = guard(async () => {
    const seq = ++candSeq; const it = candidate();
    const node = it ? await previewOf(it, src) : null;
    if (seq !== candSeq) return;
    // sem nada escolhido (lista vazia), a prévia não ocupa espaço: a criação rápida fica logo abaixo do tipo
    candPv.hidden = !node; candLabel.hidden = !node;
    const m = it?.refKind === 'media' ? src.media.find((x) => x.id === it.refId) : null;
    const aviso = m && !serve(m) ? note(`Este item é ${formatoDaMidia(m) === 'port' ? 'em pé' : 'deitado'} e o quadro é ${quadros.map((q) => FORMATO_TXT[q.formato]).join(' / ')}: na TV ele fica cortado ou com sobras. Prefira um no formato do quadro.`, 'small warn') : null;
    put(candPv, node, aviso);
  });
  let paintPick = () => {};
  /** Depois de criar algo aqui mesmo: relê as listas e já deixa o novo escolhido. */
  const created = async (r) => {
    const id = r?.id ?? r?.feed?.id ?? r?.widget?.id ?? r?.kpi?.id ?? r?.post?.id ?? r?.media?.id ?? null;
    Object.assign(src, await sources());
    paintPick();
    if (id != null && [...pick.options].some((o) => o.value === String(id))) pick.value = String(id);
    else if (pick.options.length) pick.value = pick.options[pick.options.length - 1].value;
    paintCand();
    toast('Criado. Confira a prévia e clique em "+ Acrescentar".');
  };
  const post = (path, body) => guard(async () => created(await tapi(path, { method: 'POST', body })));
  const nextAt = (m, d, h = 0) => { const n = new Date(); let t = new Date(n.getFullYear(), m - 1, d, h); if (t < n) t = new Date(n.getFullYear() + 1, m - 1, d, h); return t.getTime(); };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  /** A criação rápida de cada tipo: fontes e blocos prontos num clique; indicador e comunicado num formulário curto. */
  function paintQuick(k, none) {
    const box = [];
    if (k.pick === 'media') {
      const images = src.media.filter((m) => m.kind === 'image');
      const preset = alvo === 'port' ? { template: 'comunicado', fields: { ...(SLIDE_TEMPLATE.comunicado?.sample || {}), orient: 'port' } } : {};
      box.push(btns(btn(`+ Criar um slide agora${alvo ? ` (${alvo === 'port' ? 'em pé' : 'deitado'})` : ''}`, () => slideEditor(null, images, async () => created(null), preset), 'small'),
        btn(alvo ? `Ver os templates ${alvo === 'port' ? 'em pé' : 'deitados'}` : 'Ver os templates prontos', () => { templatesPara(alvo, quadros[0] || null); location.hash = '#tvcorp/templates'; }, 'small')),
        note('Os templates abrem em outra tela: salve a playlist antes de ir.'));
    } else if (k.pick === 'feed' && k.feedKind === 'rss') {
      const free = [['agencia-brasil', 'Agência Brasil'], ['agencia-senado', 'Agência Senado'], ['agencia-camara', 'Agência Câmara'], ['gov-br', 'gov.br']]
        .filter(([key]) => !src.feeds.some((x) => x.kind === 'rss' && x.config?.source === key));
      if (free.length) box.push(note(none ? 'Escolha uma agência pública (o crédito aparece na tela):' : 'Mais uma fonte:'),
        btns(...free.map(([key, name]) => btn(`+ ${name}`, post('/api/tvcorp/feeds', { kind: 'rss', name, config: { source: key }, refreshMin: 60, enabled: true }), 'small'))));
    } else if (k.pick === 'feed') {
      box.push(note(none ? 'Crie uma fonte de cotações pronta:' : 'Mais uma fonte:'),
        btns(btn('+ Dólar, euro e bitcoin', post('/api/tvcorp/feeds', { kind: 'quotes', name: 'Dólar, euro e bitcoin', config: { provider: 'awesome', currencies: ['USD', 'EUR', 'BTC'] }, refreshMin: 30, enabled: true }), 'small'),
          btn('+ Dólar e euro (Banco Central)', post('/api/tvcorp/feeds', { kind: 'quotes', name: 'Dólar e euro (Banco Central)', config: { provider: 'ptax', currencies: ['USD', 'EUR'] }, refreshMin: 60, enabled: true }), 'small')));
    } else if (k.pick === 'widget') {
      box.push(note(none ? 'Crie um bloco pronto (depois dá para mudar na aba Barras e blocos):' : 'Mais um bloco pronto:'),
        btns(btn('+ Relógio mundial', post('/api/tvcorp/widgets', { kind: 'worldclock', name: 'Relógio mundial', data: { zones: ['America/Sao_Paulo', 'Europe/Lisbon', 'America/New_York'] } }), 'small'),
          btn('+ Dias sem acidente', post('/api/tvcorp/widgets', { kind: 'safety', name: 'Dias sem acidente', data: { title: 'Dias sem acidente', lastAccident: today(), record: 0, goal: 365 } }), 'small'),
          btn('+ Contagem para o Natal', post('/api/tvcorp/widgets', { kind: 'countdown', name: 'Contagem para o Natal', data: { title: 'Natal', at: nextAt(12, 25), text: 'Faltam poucos dias!' } }), 'small')));
    } else if (k.pick === 'kpi') {
      const n = el('input', { type: 'text', maxlength: '60', placeholder: 'Nome (ex.: Vendas do mês)', 'aria-label': 'Nome do indicador' });
      const v = el('input', { type: 'number', step: 'any', placeholder: 'Valor', 'aria-label': 'Valor' });
      const t = el('input', { type: 'number', step: 'any', placeholder: 'Meta', 'aria-label': 'Meta' });
      const u = el('input', { type: 'text', maxlength: '10', placeholder: 'Unidade (%, R$…)', 'aria-label': 'Unidade' });
      box.push(note(none ? 'Crie um indicador digitado à mão (planilha e API ficam na aba Indicadores):' : 'Ou crie outro:'), el('div', { class: 'pf-grid two' }, n, u, v, t),
        btns(btn('+ Criar indicador', guard(async () => {
          if (n.value.trim().length < 2) throw new Error('Escreva o nome do indicador.');
          await created(await tapi('/api/tvcorp/kpis', { method: 'POST', body: { name: n.value.trim(), unit: u.value.trim(), target: t.value === '' ? null : Number(t.value), direction: 'up', bands: [], officeId: null, source: 'manual', sourceCfg: {}, refreshMin: 60, ...(v.value !== '' ? { value: Number(v.value) } : {}) } }));
        }), 'small')));
    } else if (k.pick === 'post') {
      const ti = el('input', { type: 'text', maxlength: '60', placeholder: 'Título', 'aria-label': 'Título do comunicado' });
      const tx = el('textarea', { rows: '2', maxlength: '280', placeholder: 'Texto', 'aria-label': 'Texto do comunicado' });
      box.push(note(none ? 'Escreva um comunicado para todas as telas (validade e alcance ficam na aba RH):' : 'Ou escreva outro:'), ti, tx,
        btns(btn('+ Criar comunicado', guard(async () => {
          if (ti.value.trim().length < 2) throw new Error('Escreva o título do comunicado.');
          await created(await tapi('/api/tvcorp/posts', { method: 'POST', body: { category: 'comunicado', title: ti.value.trim(), text: tx.value.trim(), qr: null, mediaId: null, validFrom: null, validTo: null, scope: { kind: 'all' } } }));
        }), 'small')));
    }
    put(quick, ...box);
  }
  paintPick = () => {
    const k = ITEM_KIND[kind.value];
    const pool = poolOf(k);
    put(pick, ...pool.map(([v, t]) => opt(v, t)));
    // lista vazia não aparece (uma caixa vazia parece defeito): no lugar dela, o aviso e a criação rápida
    pick.hidden = Boolean(k.auto) || !pool.length; range.hidden = kind.value !== 'birthdays';
    pickHint.textContent = k.key === 'birthdays' ? 'Automático: o servidor preenche na hora com quem faz aniversário (só nome e dia, sem o ano). As pessoas e as fotos ficam na aba RH.' : k.key === 'posts' ? 'Automático: todos os comunicados em vigor para a tela, um depois do outro.' : pool.length ? '' : ({ media: 'Nenhuma imagem ou slide ainda.', post: 'Nenhum comunicado ainda.', kpi: 'Nenhum indicador ainda.', feed: k.feedKind === 'quotes' ? 'Nenhuma fonte de cotações ainda.' : 'Nenhuma fonte de notícias ainda.', widget: 'Nenhum bloco ainda.' })[k.pick] || '';
    if (k.auto) put(quick); else paintQuick(k, !pool.length);
  };
  kind.addEventListener('change', () => { paintPick(); paintCand(); });
  pick.addEventListener('change', paintCand); range.addEventListener('change', paintCand);
  paintPick(); paintCand();
  const add = () => {
    if (items.length >= LIMITS.itemsPerZone) { toast(`No máximo ${LIMITS.itemsPerZone} itens por playlist.`, true); return; }
    const k = ITEM_KIND[kind.value];
    if (!k.auto && !pick.value) { toast(pick.hidden ? 'Crie primeiro o item, logo abaixo.' : 'Escolha o item.', true); return; }
    const m = k.pick === 'media' ? src.media.find((x) => x.id === Number(pick.value)) : null;
    items.push({ refKind: k.key, refId: k.auto ? null : Number(pick.value), params: k.key === 'birthdays' ? { range: range.value } : {}, seconds: m?.seconds || (k.key === 'media' ? 10 : 12), days: '', timeFrom: null, timeTo: null, validFrom: null, validTo: null });
    sel = items.length - 1; paint();
  };
  paint();
  // a mesma entrada (e o zoom lento) em todos os itens de uma vez
  const fxAll = el('select', { 'aria-label': 'Entrada para todos' }, ...[['', 'Corte seco'], ['fade', 'Esmaecer'], ['slide', 'Deslizar'], ['zoom', 'Aproximar']].map(([v, t]) => opt(v, t)));
  const kbAll = el('input', { type: 'checkbox' });
  const aplicarTodos = () => { for (const x of items) { x.params = { ...x.params }; if (fxAll.value) x.params.transition = fxAll.value; else delete x.params.transition; if (kbAll.checked && x.refKind === 'media') x.params.kenburns = true; else delete x.params.kenburns; } paint(); toast('Aplicado a todos os itens. Salve a playlist.'); };
  const fxBar = el('div', { class: 'tc-fxbar' }, el('span', { class: 'small', text: 'Efeito em todos:' }), fxAll, el('label', { class: 'pf-check small' }, kbAll, el('span', { text: 'Zoom lento nas fotos' })), btn('Aplicar', aplicarTodos, 'small'));
  dialog(`Itens da playlist · ${pl.name}`, el('div', {}, ondePassa, fxBar, el('div', { class: 'tc-two' },
    el('div', {}, total, list, note('Arraste pela alça (⋮⋮) ou use as setas. Clique no nome para ver a prévia.')),
    el('div', {}, label('Acrescentar'), el('div', { class: 'pf-grid' }, f('Tipo', kind), pick, range, pickHint, quick, candLabel, candPv, btns(btn('+ Acrescentar', add, 'primary'))),
      label('Prévia do item marcado na lista'), pv))), {
    wide: true, saveLabel: 'Salvar a playlist',
    save: async () => {
      const body = { items: items.map(({ refKind, refId, params, seconds, days, timeFrom, timeTo, validFrom, validTo }) => ({ refKind, refId, params, seconds: Number(seconds) || LIMITS.secondsDefault, days: days || '', timeFrom: timeFrom ?? null, timeTo: timeTo ?? null, validFrom: validFrom || null, validTo: validTo || null })) };
      await tapi(`/api/tvcorp/playlists/${pl.id}/items`, { method: 'PUT', body });
      toast('Playlist salva. As telas trocam em até 1 minuto.');
      await reload();
    },
  });
}

function editPlaylist(pl, reload) {
  const name = el('input', { type: 'text', maxlength: String(LIMITS.name), value: pl?.name || '' });
  const desc = el('input', { type: 'text', maxlength: String(LIMITS.description), value: pl?.description || '' });
  const office = el('select', {}, opt('', 'Empresa toda', pl?.officeId == null), ...D().offices.map((o) => opt(o.id, o.name, pl?.officeId === o.id)));
  const shuffle = el('input', { type: 'checkbox', checked: Boolean(pl?.shuffle) });
  dialog(pl ? `Playlist · ${pl.name}` : 'Nova playlist', el('div', { class: 'pf-grid' }, f('Nome', name), f('Descrição', desc), f('De quem é', office, 'Uma playlist da unidade só pode ir às telas dela.'), el('label', { class: 'pf-check' }, shuffle, el('span', { text: 'Ordem aleatória a cada volta' }))), {
    save: async () => {
      const body = { name: name.value, description: desc.value, officeId: office.value ? Number(office.value) : null, shuffle: shuffle.checked };
      const r = pl ? await tapi(`/api/tvcorp/playlists/${pl.id}`, { method: 'PATCH', body }) : await tapi('/api/tvcorp/playlists', { method: 'POST', body });
      toast('Playlist salva.'); await reload();
      if (!pl && r?.id) setTimeout(() => guard(() => editItems({ id: r.id, name: body.name }, reload))(), 0);
    },
  });
}

export default async function paintPlaylists(box, ctx) {
  const d = D(); const reload = ctx.reload;
  const used = (id) => d.schedules.filter((s) => Object.values(s.zonePlaylists || {}).map(Number).includes(id)).map((s) => s.name);
  const rows = d.playlists.map((pl) => el('tr', {},
    el('td', {}, el('b', { text: pl.name }), pl.description ? el('div', { class: 'dim small', text: pl.description }) : null),
    el('td', { text: officeName(pl.officeId) }),
    el('td', { text: `${pl.itemCount ?? pl.items ?? '—'} item(ns)${pl.seconds ? ` · ${secs(pl.seconds)}` : ''}${pl.shuffle ? ' · aleatória' : ''}` }),
    el('td', {}, ...(used(pl.id).length ? used(pl.id).map((n) => chip(n)) : [el('span', { class: 'dim small', text: 'em nenhuma grade' })])),
    el('td', { text: when(pl.updatedAt) }),
    el('td', { class: 'pf-actions' },
      btn('Itens', guard(() => editItems(pl, reload)), 'small primary'),
      btn('Renomear', () => editPlaylist(pl, reload), 'small'),
      btn('Apagar', guard(async () => { if (used(pl.id).length && !confirm(`"${pl.name}" está em ${used(pl.id).length} grade(s): a zona dela fica vazia. Apagar mesmo assim?`)) return; if (!used(pl.id).length && !confirm(`Apagar a playlist "${pl.name}"?`)) return; await tapi(`/api/tvcorp/playlists/${pl.id}`, { method: 'DELETE' }); await reload(); }), 'small danger'))));
  put(box,
    note('Uma playlist é a sequência que passa numa zona do layout: imagens e slides da biblioteca, comunicados, indicadores, notícias e cotações, aniversariantes e widgets. Cada item tem o seu tempo e pode valer só em alguns dias, horários ou num período.'),
    btns(btn('+ Nova playlist', () => editPlaylist(null, reload), 'primary'), el('span', { class: 'dim small', text: `${d.playlists.length} de ${LIMITS.playlists}` })),
    rows.length ? table(['Playlist', 'De quem é', 'Itens', 'Nas grades', 'Atualizada', ''], rows) : empty('Nenhuma playlist ainda. Crie a primeira e acrescente as mídias.'));
}
