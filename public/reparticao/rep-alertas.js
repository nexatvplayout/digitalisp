// NEXA Telas · página de controle da repartição · os avisos (texto rolante) e o alerta em tela cheia.
//   Avisos: a lista, a classificação de cada um, o formato da tela e a prévia.
//   Alerta: título, texto, gravidade, duração, som e o alcance; nas repartições comuns, só as próprias telas.
//   Novo alerta (Defesa Civil): primeiro a categoria, depois o tipo do catálogo (preenche o título e o texto, que continuam
//     editáveis), a gravidade com a definição ao lado (Aviso, Severo, Extremo), o alcance com o mapa (cidade, regiões, grupos
//     ou raio), a contagem de telas ao vivo, a prévia e a confirmação com o alcance. Extremo pede uma confirmação a mais.
//   No ar: os alertas desta repartição, com Encerrar e "Repetir para outra área".
// O mapa é o do Painel da Prefeitura (public/admin/telas-mapa.js) sem o fundo de fora: o contorno guardado do município e
// as repartições (GET /api/reparticao/mapa). A mesma escolha de alcance serve à aba Desaparecidos.
import {
  LAYOUTS, CONTENT_CLASSES, splitAviso, markAviso, layoutLabel, SEVERITIES, severityOf, ALERT_CATEGORIES, alertCategory, alertTypeText, alertHeader,
  scopeHits, typeSigla, typeLabel, LIMITS, isWide, issuerOf, issuerHeader, alertCategoriesOf, isExternal,
} from '/shared/telas-tipos.js';
import { S, el, put, api, act, ok, err, card, cols, field, option, check, hhmm, left, now } from '/reparticao/rep-base.js';
import { tvPreview } from '/shared/telas-previa.js';
import { createMap } from '/admin/telas-mapa.js';
import { devicesCard } from '/reparticao/rep-telas.js';

const classOptions = (sel) => CONTENT_CLASSES.map((c) => option(c.key, c.label, c.key === sel));
const DURATIONS = [[10, '10 minutos'], [30, '30 minutos'], [60, '1 hora'], [180, '3 horas'], [720, '12 horas'], [1440, '24 horas']];

/* ------------------------------------------------------------------ Avisos */
export function avisos(ctx) {
  const st = () => S.state;
  const rows = el('div', { class: 'r-avisos' }); const layout = el('select', {}); const pv = el('div', { class: 'r-pv' });
  const read = () => [...rows.querySelectorAll('.r-aviso')].map((row) => { const t = row.querySelector('input').value.trim(); return t ? markAviso(t, row.querySelector('select').value) : ''; }).filter(Boolean);
  // o formato com avisos mais perto do escolhido: com a lateral, o L (lateral + avisos); sem ela, Vídeo + avisos
  const withAvisos = (lay) => (lay === 'side' && st().layouts.includes('lbar') ? 'lbar' : st().layouts.includes('ticker') ? 'ticker' : null);
  const showsAvisos = (lay) => ['ticker', 'lbar', 'portrait'].includes(lay);
  // o que cada TV recebe AGORA e de onde vem (GET /state devices[].ticker): a lista vazia aqui devolve a vez aos avisos da
  // prefeitura, e os da própria tela e dos grupos vencem os da repartição
  const FROM = {
    tela: () => 'avisos gravados na própria TV (só o Painel da Prefeitura, em Telas, tira)',
    grupo: (t) => `avisos do grupo de telas ${t.groups.map((g) => `"${g}"`).join(', ')} (o grupo vence a repartição; só o Painel da Prefeitura, em Grupos, tira)`,
    reparticao: () => 'os avisos desta repartição (a lista ao lado)',
    prefeitura: () => 'os avisos gerais da prefeitura: com a lista desta repartição vazia, a TV mostra os da prefeitura (o Painel da Prefeitura tira em Repartições → Padrão da prefeitura)',
    nenhum: () => 'nenhum aviso',
  };
  const origins = () => {
    const devs = (st().devices || []).filter((d) => d.ticker);
    if (!devs.length) return null;
    return el('div', { class: 'r-origins' }, el('p', { class: 'r-dim', text: 'Na TV agora (depois de salvar, troca em até 30 segundos):' }),
      ...devs.map((d) => el('p', { class: d.ticker.from === 'reparticao' || d.ticker.from === 'nenhum' ? 'r-dim' : 'r-warn' },
        el('b', { text: `${d.name}: ` }), `${d.ticker.items.length ? `${d.ticker.items.length} aviso(s), ` : ''}${FROM[d.ticker.from](d.ticker)}${d.ticker.items.length ? ` — "${d.ticker.items.slice(0, 2).join('" · "')}"${d.ticker.items.length > 2 ? '…' : ''}` : ''}.`)));
  };
  const repaint = () => {
    const lay = layout.value || st().layout || 'ticker';
    const shows = showsAvisos(lay);
    const alt = shows ? null : withAvisos(lay);
    repaintPv(lay, shows, alt);
    pv.append(...[origins()].filter(Boolean));
  };
  const repaintPv = (lay, shows, alt) => {
    put(pv, shows
      ? [tvPreview({ layout: lay, ticker: read(), side: { title: st().office.name, widgets: ['clock'] } }), el('p', { class: 'r-dim', text: `Prévia no formato ${layoutLabel(lay)}.` })]
      : [tvPreview({ layout: lay, ticker: [], side: { title: st().office.name, widgets: ['clock'] } }),
        el('p', { class: 'r-warn', role: 'alert', text: `Os avisos NÃO aparecem na TV no formato ${layoutLabel(lay)}: ele não tem a faixa do texto rolante.` }),
        alt ? el('button', { type: 'button', class: 'r-btn', onclick: () => { layout.value = alt; repaint(); } }, `Usar o formato ${layoutLabel(alt)}`) : null]);
  };
  function row(item = '') {
    const a = splitAviso(item);
    const input = el('input', { type: 'text', maxlength: String(st().avisos.maxLength), value: a.text, 'aria-label': 'Aviso', oninput: repaint });
    const cls = el('select', { 'aria-label': 'Classificação do aviso', class: 'r-class' }, ...classOptions(a.class));
    const r = el('div', { class: 'r-aviso' }, input, cls, el('button', { type: 'button', class: 'r-btn small', onclick: () => { r.remove(); if (!rows.children.length) rows.append(row()); repaint(); } }, 'Tirar'));
    return r;
  }
  function fill() {
    put(rows, (st().avisos.items.length ? st().avisos.items : ['']).map((t) => row(t)));
    put(layout, option('', 'O padrão da prefeitura', !st().layout), ...LAYOUTS.filter((l) => st().layouts.includes(l.key)).map((l) => option(l.key, `${l.label}: ${l.desc}`, l.key === st().layout)));
    repaint();
  }
  layout.addEventListener('change', repaint);
  const add = el('button', { type: 'button', class: 'r-link', onclick: () => { if (rows.children.length >= st().avisos.max) return err(`No máximo ${st().avisos.max} avisos.`); const r = row(); rows.append(r); r.querySelector('input').focus(); return null; } }, '+ Outro aviso');
  const save = act(async () => {
    const lay = layout.value || st().layout || 'ticker'; const alt = withAvisos(lay);
    if (read().length && !showsAvisos(lay) && alt && confirm(`No formato ${layoutLabel(lay)} os avisos não aparecem na TV.\n\nTrocar para ${layoutLabel(alt)} (a coluna lateral continua e a faixa dos avisos aparece embaixo)?`)) { layout.value = alt; repaint(); }
    const r = await api('/avisos', { method: 'PUT', body: { layout: layout.value || null, items: read() } });
    st().layout = r.layout;
    if (r.pending) { ok('Avisos enviados para a SECOM. As telas seguem com os avisos de antes até a aprovação.'); await ctx.refresh(); return; }
    st().avisos.items = r.items; try { await ctx.refresh(); } catch { /* a origem atualiza no próximo ciclo */ } fill();
    ok('Avisos salvos. As telas trocam em até 30 segundos.');
  });
  const btn = el('button', { type: 'submit', class: 'r-btn primary' }, st().approval?.on && st().office.type !== 'secom' ? 'Enviar para a SECOM' : 'Salvar avisos');
  const dev = devicesCard();
  const node = cols(
    card('Avisos na tela',
      el('p', { class: 'r-dim', text: 'O texto que passa na tela, um aviso depois do outro. Marque como institucional o que divulga ações da gestão: no período eleitoral esse aviso fica guardado e não vai às telas.' }),
      el('form', { novalidate: true, onsubmit: save }, rows, add, field('Formato da tela', layout), btn)),
    [card('Como aparece na TV', pv), dev.node]);
  fill();
  return { node, refresh: dev.refresh };
}

/* ------------------------------------------------------------------ o alcance (cidade, regiões, grupos, raio, a própria repartição) */
let mapData = null;
const loadMap = async () => { if (!mapData) mapData = await api('/mapa'); return mapData; };
/**
 * A escolha do alcance. Devolve { controls, mapCard (ou null: repartição que só alcança as próprias telas), get(),
 * ready(), reach(), text(), reset(), onChange }. Com o mapa: a área que recebe fica destacada e a contagem é ao vivo.
 */
export function scopePicker({ onChange = () => {} } = {}) {
  const st = S.state; const wide = isWide(st.office.type);
  // o "Alcance da prefeitura" (repartição de emergência): o que a ficha marcou; "só as próprias telas" é o mesmo que a repartição
  const hasReach = Boolean(st.reach && st.reach.mode !== 'own');
  const scopes = (st.alertScopes || ['office']).filter((k) => k !== 'reach' || hasReach);
  const first = () => (hasReach ? 'reach' : wide ? 'city' : 'office');
  let kind = first(); let point = null; let reach = null; let seq = 0; let map = null; let live = false; let touched = false;
  const changed = () => { if (live) onChange(); }; // só depois de montado (quem chama ainda não tem o objeto)
  const picks = el('div', { class: 'r-picks', hidden: true });
  const meters = el('input', { type: 'number', min: String(LIMITS.radiusMin), max: String(LIMITS.radiusMax), step: '100', value: '1000' });
  const radiusNote = el('p', { class: 'r-dim' });
  const radiusRow = el('div', { class: 'r-radius', hidden: true }, field('Raio em metros', meters), radiusNote);
  const reachEl = el('p', { class: 'r-reach', 'aria-live': 'polite' });
  const LABEL = { reach: 'Alcance da prefeitura', city: 'Cidade toda', regions: 'Regiões', groups: 'Grupos', radius: 'Raio no mapa', office: 'As telas desta repartição' };
  const btns = el('div', { class: 'r-seg', role: 'group', 'aria-label': 'Para onde vai' });
  const chosen = () => [...picks.querySelectorAll('input:checked')].map((i) => Number(i.value));
  const get = () => (kind === 'reach' ? { kind } : kind === 'regions' ? { kind, regions: chosen() } : kind === 'groups' ? { kind, groups: chosen() } : kind === 'radius' ? { kind, lat: point?.lat, lng: point?.lng, meters: Number(meters.value) } : { kind });
  const ready = () => { const s = get(); return s.kind === 'reach' || s.kind === 'city' || s.kind === 'office' || (s.kind === 'regions' && s.regions.length > 0) || (s.kind === 'groups' && s.groups.length > 0) || (s.kind === 'radius' && point && s.meters >= LIMITS.radiusMin && s.meters <= LIMITS.radiusMax); };
  const text = () => { const s = get(); return s.kind === 'reach' ? `o alcance da prefeitura: ${st.reach.text}${st.reach.eas ? ' (e no ar do canal, se Severo ou Extremo)' : ''}` : s.kind === 'city' ? 'a cidade toda' : s.kind === 'office' ? 'as telas desta repartição' : s.kind === 'regions' ? `${s.regions.length} ${s.regions.length === 1 ? 'região' : 'regiões'} (${st.regions.filter((r) => s.regions.includes(r.id)).map((r) => r.name).join(', ')})` : s.kind === 'groups' ? `${s.groups.length} grupo(s) de telas (${st.groups.filter((g) => s.groups.includes(g.id)).map((g) => g.name).join(', ')})` : `um raio de ${s.meters} m no mapa`; };
  function paintMap() {
    if (!map || !mapData) return;
    const s = get(); const ok2 = ready();
    map.setPins(mapData.offices.filter((o) => o.lat != null && o.lng != null).map((o) => {
      const hit = ok2 && (o.devices ?? 1) > 0 && (s.kind === 'office' ? o.name === st.office.name : scopeHits(s.kind === 'reach' ? st.reach.scope : s, { officeId: o.id, regionId: o.regionId, groups: o.groups, lat: o.lat, lng: o.lng }));
      return { id: o.id, lat: o.lat, lng: o.lng, status: 'none', cls: hit ? 'hit' : 'dim', label: typeSigla(o.type), count: o.devices ?? null, color: mapData.regions.find((r) => r.id === o.regionId)?.color || null, title: `${o.name} · ${typeLabel(o.type)}${o.devices != null ? ` · ${o.devices} tela(s)` : ''}${hit ? ' · recebe' : ''}` };
    }));
    map.setCircle(kind === 'radius' && point ? { lat: point.lat, lng: point.lng, meters: Number(meters.value) || 0 } : null);
  }
  async function paintReach() {
    const n = ++seq; paintMap(); changed();
    radiusNote.replaceChildren(point ? `Centro: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}. Clique no mapa (ou numa repartição) para mudar.` : 'Clique no mapa, ou numa repartição, para marcar o centro do raio.');
    if (!ready()) { reach = null; reachEl.textContent = kind === 'radius' ? 'Marque o centro do raio no mapa.' : 'Escolha ao menos um.'; return; }
    try {
      const r = await api('/alerts/preview', { method: 'POST', body: { scope: get() } });
      if (n !== seq) return;
      reach = r; reachEl.textContent = `Alcance: ${r.total} ${r.total === 1 ? 'tela' : 'telas'} em ${r.offices} ${r.offices === 1 ? 'repartição' : 'repartições'} · ${r.online} ligada(s) agora`;
      changed();
    } catch (x) { if (n === seq && x.message !== 'sessão') { reach = null; reachEl.textContent = x.message; } }
  }
  function setKind(k) {
    kind = k;
    for (const b of btns.children) { const on = b.getAttribute('data-kind') === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    const list = k === 'regions' ? st.regions : k === 'groups' ? st.groups : null;
    picks.hidden = !list; radiusRow.hidden = k !== 'radius';
    put(picks, (list || []).map((x) => check(x.name, el('input', { type: 'checkbox', value: String(x.id), onchange: () => { touched = true; paintReach(); } }))),
      list && !list.length ? el('p', { class: 'r-dim', text: k === 'regions' ? 'A prefeitura ainda não cadastrou regiões.' : 'A prefeitura ainda não criou grupos de telas.' }) : null);
    paintReach();
  }
  put(btns, ['reach', 'city', 'regions', 'groups', 'radius', 'office'].filter((k) => scopes.includes(k)).map((k) => el('button', { type: 'button', class: 'r-btn small', 'data-kind': k, 'aria-pressed': 'false', onclick: () => { touched = true; setKind(k); } }, LABEL[k])));
  meters.addEventListener('input', () => { touched = true; paintReach(); });
  const controls = el('div', { class: 'r-scope' }, scopes.length > 1 ? el('div', { class: 'r-field' }, el('span', { text: 'Para onde' }), btns) : null, picks, radiusRow, reachEl);
  let mapCard = null;
  if (wide) {
    const box = el('div', { class: 'r-mapbox' }); const note = el('p', { class: 'r-dim', text: 'Carregando o mapa…' });
    mapCard = card('Mapa da cidade', box, note);
    const setPoint = (p) => { touched = true; point = { lat: p.lat, lng: p.lng }; if (kind !== 'radius' && scopes.includes('radius')) setKind('radius'); else paintReach(); };
    loadMap().then((m) => {
      map = createMap(box, { tiles: false, onClick: (p) => { if (scopes.includes('radius')) setPoint(p); }, onPin: (id) => { const o = m.offices.find((x) => x.id === id); if (o && scopes.includes('radius')) setPoint(o); } });
      if (m.municipio?.polygons) { map.setOutline(m.municipio.polygons, { mask: false }); map.setBounds(m.municipio.bbox); map.fitBounds(m.municipio.bbox); } else map.fit(m.offices.filter((o) => o.lat != null));
      note.textContent = m.municipio ? `${m.municipio.name}/${m.municipio.uf}: o contorno do município e as repartições (a sigla é o tipo; o número, quantas telas). As que recebem ficam em destaque.` : 'A prefeitura ainda não definiu o município: o mapa mostra só as repartições com ponto.';
      paintMap();
    }, () => { note.textContent = 'Não foi possível carregar o mapa agora. O alcance por cidade, regiões e grupos continua valendo.'; });
  }
  setKind(kind); live = true;
  return { controls, mapCard, get, ready, reach: () => reach, text, reset: () => { point = null; setKind(first()); touched = false; }, touched: () => touched, show: () => map?.render() };
}

/* ------------------------------------------------------------------ o formulário do alerta */
/** A janela de confirmação: a prévia, o alcance e o botão que envia. Devolve true se confirmou. */
export function confirmDialog({ title, body, okLabel, danger = true }) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'r-dlg', 'aria-labelledby': 'dlgTitle' });
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(el('h2', { id: 'dlgTitle', text: title }), el('div', { class: 'r-dlg-body' }, body),
      el('div', { class: 'r-btns' }, el('button', { type: 'button', class: 'r-btn', onclick: () => done(false) }, 'Voltar'), el('button', { type: 'button', class: `r-btn ${danger ? 'danger' : 'primary'}`, onclick: () => done(true) }, okLabel)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dlg); dlg.showModal();
  });
}
function alertForm(ctx, { catalog }) {
  const st = S.state; const dc = Boolean(issuerOf(st.office.type)); // repartição emissora: assina a linha de cima e confirma o Extremo
  const issuer = st.office.name; const external = isExternal(st.office.type);
  const cats = alertCategoriesOf(st.office.type);
  const waits = external ? !st.direct : st.approval?.on && !dc; // o emissor conveniado espera o CCO; as repartições comuns, a SECOM
  let cat = null; let type = null; let level = catalog ? 'warn' : 'info'; let soundTouched = false;
  const title = el('input', { type: 'text', maxlength: String(LIMITS.alertTitle), required: true });
  const text = el('textarea', { rows: '4', maxlength: String(LIMITS.alertText) });
  const duration = el('select', {}, ...DURATIONS.map(([v, t]) => option(v, t, v === (catalog ? 60 : 30))));
  const sound = el('input', { type: 'checkbox', onchange: () => { soundTouched = true; } });
  const cls = el('select', {}, ...classOptions(catalog ? 'emergencia' : 'utilidade'));
  const catBox = el('div', { class: 'r-cats', role: 'group', 'aria-label': 'Categoria do aviso' }); const typeBox = el('div', { class: 'r-chips', role: 'group', 'aria-label': 'Tipo do aviso' });
  const sevBox = el('div', { class: 'r-sevs', role: 'radiogroup', 'aria-label': 'Gravidade' });
  const pv = el('div', { class: 'r-pv' });
  const isTest = () => Boolean(cat && alertCategory(cat)?.test);
  const header = () => (isTest() ? alertHeader({ level, test: true }) : dc ? issuerHeader(st.office.type, level) : level === 'info' ? alertHeader({ level, issuer }) : '');
  const scope = scopePicker({ onChange: () => repaint() });
  function repaint() {
    const r = scope.reach();
    put(pv, tvPreview({ alert: { level, head: `${isTest() ? 'TESTE · ' : ''}${header() || severityOf(level).word}`, title: `${isTest() && !/^TESTE\b/i.test(title.value) ? 'TESTE: ' : ''}${title.value.trim() || 'Título do alerta'}`, text: text.value.trim(), foot: `${scope.ready() ? scope.text() : 'alcance a escolher'}${r ? ` · ${r.total} tela(s)` : ''}${sound.checked ? ' · com som' : ''}` } }),
      isTest() ? el('p', { class: 'r-dim', text: 'Teste ou simulado: a tela mostra a palavra TESTE grande durante todo o alerta.' }) : null);
  }
  function setLevel(k, fromType = false) {
    level = k;
    for (const b of sevBox.children) { const on = b.getAttribute('data-level') === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    // Extremo vem com o som ligado; o teste, desligado (a pessoa pode trocar)
    if (!soundTouched || fromType) sound.checked = isTest() ? false : severityOf(k).sound;
    repaint();
  }
  function setType(t) {
    type = t;
    for (const b of typeBox.children) { const on = b.getAttribute('data-type') === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    const x = alertTypeText(t, st.alertTexts);
    if (x && t !== 'outro') { title.value = x.title; text.value = x.text; }
    if (x) setLevel(x.level, true);
    repaint();
  }
  function setCat(k) {
    cat = k; type = null;
    for (const b of catBox.children) { const on = b.getAttribute('data-cat') === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    const c = alertCategory(k);
    put(typeBox, c.types.map((t) => el('button', { type: 'button', class: 'r-chip', 'data-type': t.id, 'aria-pressed': 'false', onclick: () => setType(t.id) }, t.name)));
    if (c.types.length === 1) setType(c.types[0].id);
    repaint();
  }
  if (catalog) {
    // cada emissor com as categorias dele, as dele primeiro (Segurança pública e Trânsito no CCO e nas polícias)
    const list = cats ? cats.map((k) => ALERT_CATEGORIES.find((c) => c.key === k)).filter(Boolean) : ALERT_CATEGORIES.filter((c) => !['seguranca', 'transito'].includes(c.key));
    put(catBox, list.map((c) => el('button', { type: 'button', class: 'r-cat', 'data-cat': c.key, 'aria-pressed': 'false', onclick: () => setCat(c.key) }, el('b', { text: c.label }), el('small', { text: c.short }))),
      st.office.type !== 'policia-militar' ? el('button', { type: 'button', class: 'r-cat link', onclick: () => ctx.go('desaparecidos') }, el('b', { text: 'Pessoa desaparecida' }), el('small', { text: 'Abrir a aba Desaparecidos' })) : null);
  }
  put(sevBox, SEVERITIES.map((s) => el('button', { type: 'button', role: 'radio', class: `r-sev sev-${s.key}`, 'data-level': s.key, 'aria-checked': 'false', onclick: () => setLevel(s.key) }, el('b', { text: s.label }), el('small', { text: s.desc }))));
  title.addEventListener('input', repaint); text.addEventListener('input', repaint); sound.addEventListener('change', repaint);
  const reset = () => { title.value = ''; text.value = ''; soundTouched = false; scope.reset(); repaint(); };
  /** Abre o formulário com um alerta de antes e o alcance em branco ("Repetir para outra área"). */
  const fillFrom = (a) => {
    if (catalog && a.category) { setCat(a.category); if (a.kind) setType(a.kind); }
    title.value = a.title.replace(/^TESTE:\s*/i, ''); text.value = a.text || ''; setLevel(a.level); sound.checked = a.sound; soundTouched = true;
    scope.reset(); repaint(); title.focus();
  };
  const send = act(async () => {
    const t = title.value.trim();
    if (catalog && !cat) throw new Error('Escolha a categoria do aviso.');
    if (catalog && !type) throw new Error('Escolha o tipo do aviso.');
    if (t.length < 2) { title.focus(); throw new Error('Escreva o título do alerta.'); }
    if (!scope.ready()) throw new Error('Escolha para onde o alerta vai.');
    const r = scope.reach(); const n = r ? r.total : 0;
    const sev = severityOf(level);
    const body2 = el('div', {}, tvPreview({ alert: { level, head: `${isTest() ? 'TESTE · ' : ''}${header() || sev.word}`, title: `${isTest() && !/^TESTE\b/i.test(t) ? 'TESTE: ' : ''}${t}`, text: text.value.trim(), foot: sound.checked ? 'com som' : 'sem som' } }),
      el('p', { class: 'r-dlg-reach' }, el('b', { text: `Vai para ${scope.text()}.` }), ` ${r ? `${r.total} ${r.total === 1 ? 'tela recebe' : 'telas recebem'} em ${r.offices} ${r.offices === 1 ? 'repartição' : 'repartições'}; ${r.online} ligada(s) agora.` : ''}`),
      el('p', { class: 'r-dim', text: `Gravidade: ${sev.label}. Fica no ar por ${duration.options[duration.selectedIndex].text}${waits ? (external ? '. O alerta espera a aprovação da Segurança (CCO) antes de ir às telas.' : '. Com a aprovação da SECOM ligada, o alerta espera a aprovação.') : '.'}` }));
    if (!(await confirmDialog({ title: 'Conferir antes de enviar', body: body2, okLabel: waits ? 'Enviar para a aprovação' : `Enviar para ${n} ${n === 1 ? 'tela' : 'telas'}` }))) return;
    // Extremo é o nível máximo: uma confirmação a mais
    if (level === 'critical' && dc && !confirm(`Este é o nível máximo. Confirmar alerta EXTREMO para ${n} ${n === 1 ? 'tela' : 'telas'}?`)) return;
    const out = await api('/alerts', { method: 'POST', body: { title: t, text: text.value, level, sound: sound.checked, durationMin: Number(duration.value), scope: scope.get(), class: cls.value, ...(catalog ? { category: cat, kind: type } : {}), ...(level === 'critical' ? { confirmExtreme: true } : {}) } });
    reset();
    ok(out.pending ? (external ? 'Alerta enviado para a aprovação da Segurança (CCO): só vai às telas depois de aprovado. Acompanhe em Meus envios.' : 'Alerta enviado para a aprovação da SECOM: só vai às telas depois de aprovado.') : `Alerta no ar: ${out.reach.total} tela(s), ${out.reach.online} ligada(s) agora.`);
    await ctx.refresh();
  });
  const form = el('form', { novalidate: true, onsubmit: send },
    catalog ? [el('h3', { text: '1. Categoria' }), catBox, el('h3', { text: '2. Tipo' }), typeBox, el('p', { class: 'r-dim', text: 'O tipo preenche o título e o texto sugeridos; troque o que precisar.' })] : null,
    field('Título', title), field('Texto', text),
    el('h3', { text: catalog ? '3. Gravidade' : 'Gravidade' }), sevBox,
    el('div', { class: 'r-row' }, field('Fica por', duration), field('Classificação', cls)),
    check('Tocar o som de alerta', sound),
    scope.controls,
    el('div', { class: 'r-btns' }, el('button', { type: 'button', class: 'r-btn', onclick: () => { repaint(); pv.scrollIntoView({ block: 'nearest' }); } }, 'Pré-visualizar'), el('button', { type: 'submit', class: 'r-btn danger big' }, 'Enviar alerta')));
  setLevel(level);
  return { form, pv, scope, fillFrom };
}

/** Os alertas desta repartição: no ar (com Encerrar e, se der, Repetir para outra área) e o histórico recente. */
function alertsList({ live, onRepeat = null, ctx }) {
  const list = el('ul', { class: 'r-list' }); const empty = el('p', { class: 'r-dim', text: live ? 'Nenhum alerta no ar.' : 'Nenhum alerta enviado.' });
  const paint = () => {
    const all = S.state.alerts || []; const isLive = (a) => a.status === 'em vigor' || a.status === 'agendado';
    const rows = live ? all.filter(isLive) : all;
    empty.hidden = rows.length > 0;
    put(list, rows.map((a) => el('li', {},
      el('span', { class: `r-tag${isLive(a) ? ' live' : ''}`, text: a.status }),
      el('span', {}, el('b', {}, a.test ? el('span', { class: 'r-tag test', text: 'TESTE' }) : null, a.title),
        el('small', { text: `${severityOf(a.level).label}${a.header ? ` · ${a.header}` : ''} · ${isLive(a) ? `termina em ${left(a.until - now())}` : `até ${hhmm(a.until)}`}${a.flag ? ' · sem aprovação (urgente)' : ''}` })),
      onRepeat ? el('button', { type: 'button', class: 'r-btn small', onclick: () => onRepeat(a) }, 'Repetir para outra área') : null,
      isLive(a) ? el('button', { type: 'button', class: 'r-btn small', onclick: act(async () => {
        if (!confirm(`Encerrar o alerta "${a.title}"? Ele sai das telas em até 30 segundos.`)) return;
        await api(`/alerts/${a.id}/cancel`, { method: 'POST' }); ok('Alerta encerrado.'); await ctx.refresh();
      }) }, 'Encerrar') : null)));
  };
  paint();
  return { list, empty, paint };
}
const liveCount = () => (S.state.alerts || []).filter((a) => a.status === 'em vigor' || a.status === 'agendado').length;

/** A aba Alerta das repartições comuns e da SECOM. */
export function alerta(ctx) {
  const f = alertForm(ctx, { catalog: false });
  const mine = alertsList({ live: false, ctx });
  const dev = devicesCard();
  const node = cols(
    card('Alerta em tela cheia', el('p', { class: 'r-dim', text: 'O alerta cobre o vídeo nas telas até o fim do prazo ou até você encerrar.' }), f.form),
    [f.scope.mapCard, card('Como aparece na TV', f.pv), card('Alertas desta repartição', mine.list, mine.empty), f.scope.mapCard ? null : dev.node]);
  return { node, show: () => f.scope.show(), refresh: () => { mine.paint(); dev.refresh(); } };
}
/** Novo alerta (Defesa Civil): o catálogo, a gravidade, o mapa e a contagem ao vivo. */
let dcForm = null;
export function novoAlerta(ctx) {
  const f = alertForm(ctx, { catalog: true }); dcForm = f;
  const air = alertsList({ live: true, ctx, onRepeat: (a) => f.fillFrom(a) });
  const node = cols(
    card('O alerta', f.form),
    [f.scope.mapCard, card('Como aparece na TV', f.pv), card('Alertas no ar', air.list, air.empty)]);
  ctx.badge('no-ar', liveCount());
  return { node, show: () => f.scope.show(), refresh: () => { air.paint(); ctx.badge('no-ar', liveCount()); } };
}
/** No ar (Defesa Civil): os alertas em vigor e o histórico. */
export function noAr(ctx) {
  const repeat = (a) => { ctx.go('novo-alerta'); dcForm?.fillFrom(a); };
  const air = alertsList({ live: true, ctx, onRepeat: repeat }); const all = alertsList({ live: false, ctx, onRepeat: repeat });
  const dev = devicesCard(); const external = isExternal(S.state.office.type);
  // o emissor conveniado acompanha aqui o que espera o CCO, o que foi aprovado e o que foi devolvido (com o motivo)
  const reqs = el('ul', { class: 'r-list' }); const reqsEmpty = el('p', { class: 'r-dim', text: 'Nenhum pedido esperando a aprovação.' });
  const REQ = { pending: 'aguardando', approved: 'aprovado', rejected: 'devolvido' };
  const paintReqs = () => { const list = (S.state.approval?.requests || []).filter((r) => r.kind === 'alert'); reqsEmpty.hidden = list.length > 0; put(reqs, list.map((r) => el('li', {}, el('span', { class: `r-tag${r.status === 'pending' ? ' live' : ''}`, text: REQ[r.status] || r.status }), el('span', {}, el('b', { text: r.summary }), el('small', { text: `enviado em ${hhmm(r.requestedAt)}${r.decidedBy ? ` · ${REQ[r.status]} por ${r.decidedBy}` : ''}${r.note ? ` · motivo: "${r.note}"` : ''}` }))))); };
  const node = cols([external ? card('Esperando a aprovação do CCO', el('p', { class: 'r-dim', text: S.state.direct ? 'A prefeitura liberou este órgão para emitir alertas direto: eles vão às telas na hora.' : 'O que este órgão envia só vai às telas depois de aprovado pela Segurança (CCO) da prefeitura.' }), reqs, reqsEmpty) : null,
    card('Alertas no ar', el('p', { class: 'r-dim', text: 'Acompanhe aqui e encerre quando o risco passar.' }), air.list, air.empty), card(external ? 'Enviados por este órgão' : 'Enviados por esta repartição', all.list, all.empty)], external ? null : dev.node);
  const paint = () => { air.paint(); all.paint(); dev.refresh(); paintReqs(); ctx.badge('no-ar', liveCount()); };
  return { node, show: paint, refresh: paint };
}
