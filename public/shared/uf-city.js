// Seletor de UF e Município (lista oficial do IBGE, ./municipios-ibge.json, gerada por scripts/gerar-municipios.mjs).
// NEUTRO: não depende do painel nem do comercial (só do br-docs.js ao lado), então qualquer página com DOM importa
// /shared/uf-city.js: o cadastro de anunciantes usa hoje; a tela de Alertas e o "Sua região" do app podem usar.
//   const uc = ufCityPicker({ uf: 'SP', cityIbge: 3509502, idPrefix: 'adv' });
//   form.append(uc.ufField, uc.cityField);   uc.value() -> { uf, cityIbge, city }   uc.validate() -> mensagem ou null
// O município é uma caixa de busca acessível (role=combobox + listbox): acha sem acento nem caixa ("sao jose" acha
// "São José dos Campos"), setas e Enter escolhem, Esc fecha. Trocar a UF limpa o município. A lista só é baixada quando o
// primeiro seletor abre (cerca de 190 KB, uma vez por sessão). Classes de estilo: .fx-* e .uc-* (o painel as define em
// public/admin/cadastro.css; outra página traz as dela). Sem página (servidor): server/br-places.js, com a mesma lista.
import { UFS, placeKey } from './br-docs.js';

/** Cria um elemento sem innerHTML (texto sempre como textContent), como o el() do painel, sem depender dele. */
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  n.append(...kids.flat().filter((x) => x != null));
  return n;
}

const MAX_SHOWN = 60;
let loading = null;

/** A lista do IBGE indexada por UF e por código (baixada uma vez). */
export function loadMunicipios() {
  loading ||= fetch('/shared/municipios-ibge.json') // endereço fixo: no painel empacotado (/_v/…/painel/) o import.meta.url não acha o arquivo
    .then((r) => { if (!r.ok) throw new Error(`lista de municípios: HTTP ${r.status}`); return r.json(); })
    .then((j) => {
      const byUf = new Map(); const byCode = new Map();
      for (const [code, name, uf] of j.municipios) {
        const m = { code: Number(code), name, uf, key: placeKey(name) };
        byCode.set(m.code, m);
        if (!byUf.has(uf)) byUf.set(uf, []);
        byUf.get(uf).push(m);
      }
      return { byUf, byCode, generatedAt: j.geradoEm, total: byCode.size };
    })
    .catch((err) => { loading = null; throw err; });
  return loading;
}

let seq = 0;
/**
 * Campo com rótulo visível, dica, aviso e a linha de erro embaixo (aria-describedby/aria-invalid ligados). control pode ser o
 * input/select ou um bloco que o contém (campo com prefixo, caixa de busca): o rótulo aponta para o input de dentro.
 */
export function fieldBox(label, control, { hint = '', id } = {}) {
  const target = control.matches('input,select,textarea') ? control : control.querySelector('input,select,textarea');
  const cid = target.id || (target.id = id || `fx${++seq}`);
  const hintEl = el('small', { class: 'fx-hint', id: `${cid}-hint`, text: hint, hidden: !hint });
  const err = el('small', { class: 'fx-err', id: `${cid}-err`, role: 'alert', hidden: true });
  const warn = el('small', { class: 'fx-warn', id: `${cid}-warn`, hidden: true });
  target.setAttribute('aria-describedby', `${cid}-hint ${cid}-warn ${cid}-err`);
  const box = el('div', { class: 'fx-field' }, el('label', { class: 'fx-label', for: cid, text: label }), control, hintEl, warn, err);
  return {
    box, control: target, hint: hintEl,
    setError(msg) { err.textContent = msg || ''; err.hidden = !msg; target?.setAttribute('aria-invalid', msg ? 'true' : 'false'); box.classList.toggle('bad', Boolean(msg)); },
    setWarn(msg) { warn.textContent = msg || ''; warn.hidden = !msg; },
    setHint(msg) { hintEl.textContent = msg || ''; hintEl.hidden = !msg; },
    setLabel(text) { box.querySelector('.fx-label').textContent = text; },
  };
}

/**
 * UF + Município. Devolve { ufField, cityField (os dois .fx-field), value(), validate(), setUfError(), setCityError(),
 * ready (promessa da lista) }. onChange({ uf, cityIbge, city }) a cada escolha.
 */
export function ufCityPicker({ uf = '', cityIbge = null, city = '', idPrefix = `uc${++seq}`, onChange } = {}) {
  const listId = `${idPrefix}-cities`;
  const ufSel = el('select', { id: `${idPrefix}-uf`, autocomplete: 'address-level1' },
    el('option', { value: '', text: 'Escolha a UF' }),
    ...Object.entries(UFS).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')).map(([k, n]) => el('option', { value: k, text: `${n} (${k})`, selected: k === uf })));
  const input = el('input', {
    id: `${idPrefix}-city`, type: 'text', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId,
    autocomplete: 'off', spellcheck: 'false', maxlength: '80', value: city || '', placeholder: uf ? 'Digite para buscar' : 'Escolha a UF primeiro', disabled: !uf,
  });
  const list = el('ul', { id: listId, class: 'uc-list', role: 'listbox', hidden: true, 'aria-label': 'Municípios' });
  const combo = el('div', { class: 'uc-combo' }, input, list);
  const ufF = fieldBox('UF', ufSel);
  const cityF = fieldBox('Município', combo, { hint: '' });
  let data = null;
  let chosen = cityIbge != null ? { code: Number(cityIbge), name: city, uf } : null;
  let shown = []; let active = -1;

  const emit = () => onChange?.(value());
  const value = () => ({ uf: ufSel.value || null, cityIbge: chosen?.code ?? null, city: chosen?.name || (input.value.trim() || null) });
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const choose = (m) => { chosen = m; input.value = m.name; close(); cityF.setError(null); emit(); };
  const setActive = (i) => {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    const li = list.children[i];
    if (li) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
  };
  function render() {
    const q = placeKey(input.value);
    const all = data?.byUf.get(ufSel.value) || [];
    const starts = []; const has = [];
    for (const m of all) { if (!q || m.key.startsWith(q)) starts.push(m); else if (m.key.includes(q)) has.push(m); }
    shown = [...starts, ...has].slice(0, MAX_SHOWN);
    list.replaceChildren(...shown.map((m, i) => el('li', { id: `${listId}-${i}`, role: 'option', class: 'uc-opt', 'aria-selected': 'false', text: m.name,
      onmousedown: (e) => { e.preventDefault(); choose(m); } })));
    if (!shown.length) list.append(el('li', { class: 'uc-none', role: 'presentation', text: data ? 'Nenhum município com esse nome nesta UF.' : 'Carregando a lista…' }));
    else if (starts.length + has.length > MAX_SHOWN) list.append(el('li', { class: 'uc-none', role: 'presentation', text: `Mostrando ${MAX_SHOWN} de ${starts.length + has.length}: continue digitando.` }));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    setActive(shown.length && q ? 0 : -1);
  }
  const ready = loadMunicipios().then((d) => { data = d; if (document.activeElement === input) render(); }).catch((err) => { cityF.setError(`Não foi possível carregar a lista de municípios (${err.message}). Tente abrir de novo.`); });

  ufSel.addEventListener('change', () => {
    chosen = null; input.value = ''; close(); cityF.setError(null); ufF.setError(null); cityF.setWarn(null);
    input.disabled = !ufSel.value; input.placeholder = ufSel.value ? 'Digite para buscar' : 'Escolha a UF primeiro';
    emit();
  });
  input.addEventListener('input', () => { chosen = null; cityF.setError(null); render(); });
  input.addEventListener('focus', () => { if (ufSel.value) render(); });
  input.addEventListener('blur', () => {
    close();
    // digitou o nome inteiro sem escolher na lista: vale se for exatamente um município da UF
    if (!chosen && input.value.trim() && data) {
      const k = placeKey(input.value);
      const m = (data.byUf.get(ufSel.value) || []).find((x) => x.key === k);
      if (m) choose(m);
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) render();
      if (!shown.length) return;
      setActive(e.key === 'ArrowDown' ? (active + 1) % shown.length : (active <= 0 ? shown.length - 1 : active - 1));
    } else if (e.key === 'Enter' && !list.hidden && active >= 0 && shown[active]) { e.preventDefault(); choose(shown[active]); }
    else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
  });

  /** Mensagem do que falta (null = ok). Município digitado que não está na lista da UF é recusado. */
  function validate() {
    const v = value();
    if (!v.uf) { if (input.value.trim()) { ufF.setError('Escolha a UF antes do município.'); return 'Escolha a UF antes do município.'; } return null; }
    if (input.value.trim() && !chosen) {
      const msg = `Escolha um município da lista de ${UFS[v.uf]} (${v.uf}).`;
      cityF.setError(msg); return msg;
    }
    return null;
  }
  return {
    ufField: ufF.box, cityField: cityF.box, ufSelect: ufSel, cityInput: input, ready, value, validate,
    setUfError: ufF.setError, setCityError: cityF.setError, setCityWarn: cityF.setWarn, setUfWarn: ufF.setWarn,
  };
}
