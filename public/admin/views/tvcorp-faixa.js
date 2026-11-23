// TV Corporativa · o editor da barra inferior (texto rolante): os avisos com cor, negrito e itálico próprios, e o estilo da
// faixa (cor do texto e do fundo, negrito, itálico, tamanho, fonte, velocidade, separador e a etiqueta à esquerda), com a
// prévia rolando como na TV. Guarda em PUT /api/tvcorp/rede/defaults { config: { tickerItems, tickerSpeed, tickerStyle } }.
// O formato fica em public/shared/faixa.js; os apps antigos recebem só o texto (sem a marca de estilo).
import { el, guard, toast, tapi, put, f, opt, label, note, btn, btns } from './tvcorp-base.js';
import { LIMITS as TL, splitAviso, markAviso } from '../../shared/telas-tipos.js';
import { TICKER_FONTS, TICKER_SEPS, TICKER_STYLE_DEFAULT, TICKER_SIZE, cleanTickerStyle, parseAvisoStyle, markAvisoStyle, sepText, fontCss } from '../../shared/faixa.js';
import { themeOf } from './tvcorp-midias.js';

/** As cores à mão: a cor da marca (tema do painel) e as básicas de faixa. */
const swatches = () => [...new Set([themeOf()?.color, '#ffffff', '#000000', '#0b1e3a', '#1d4ed8', '#15803d', '#d92d20', '#f5a623', '#ffd400'].filter(Boolean).map((c) => String(c).toLowerCase()))];

/** Um campo de cor com as cores rápidas embaixo. */
function corField(value, onChange, aria) {
  const inp = el('input', { type: 'color', value, 'aria-label': aria, oninput: (e) => onChange(e.target.value) });
  const set = (c) => { inp.value = c; onChange(c); };
  return el('div', { class: 'fx-cor' }, inp, ...swatches().map((c) => el('button', { type: 'button', class: 'fx-sw', title: c, 'aria-label': `${aria}: ${c}`, onclick: () => set(c) }, sv('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, sv('circle', { cx: 10, cy: 10, r: 9, fill: c, stroke: '#ffffff', 'stroke-opacity': 0.4 })))));
}

const NS = 'http://www.w3.org/2000/svg';
/** Um elemento SVG com atributos (as cores e as letras vão como atributos do SVG, não como estilo). */
function sv(tag, attrs = {}, ...kids) { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, String(v)); for (const k of kids.flat()) if (k != null) n.append(k); return n; }

/** A prévia rolando: a faixa em SVG (1280 × 72), com os avisos no estilo e na velocidade escolhidos. */
export function faixaPreview(items, style, speed) {
  const s = cleanTickerStyle(style || {}) || { ...TICKER_STYLE_DEFAULT };
  const W = 1280; const H = 72; const fs = Math.round((H * s.size) / 100);
  const sep = sepText(s.sep);
  const list = items.filter((a) => a.text);
  const spans = (dy) => { const out = []; (list.length ? list : [{ text: 'Escreva um aviso para ver aqui' }]).forEach((a, i) => {
    if (i) out.push(sv('tspan', {}, sep ? `   ${sep}   ` : '     '));
    out.push(sv('tspan', { fill: a.color || null, 'font-weight': a.bold ? 800 : null, 'font-style': a.italic ? 'italic' : null }, a.text));
  }); return out; };
  const labelW = s.label ? Math.round(s.label.length * fs * 0.62 + 32) : 0;
  const txt = (x) => sv('text', { x, y: H / 2, 'dominant-baseline': 'central', 'font-size': fs, 'font-family': fontCss(s.font), 'font-weight': s.bold ? 800 : 400, 'font-style': s.italic ? 'italic' : 'normal', fill: s.color, 'xml:space': 'preserve' }, spans());
  const t1 = txt(0); const run = sv('g', {}, t1);
  const clip = `fx${Math.random().toString(36).slice(2, 8)}`;
  const svg = sv('svg', { class: 'fx-bar', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Prévia da faixa de avisos', preserveAspectRatio: 'xMinYMid meet' },
    sv('defs', {}, sv('clipPath', { id: clip }, sv('rect', { x: labelW, y: 0, width: W - labelW, height: H }))),
    sv('rect', { x: 0, y: 0, width: W, height: H, fill: s.bg }),
    sv('g', { 'clip-path': `url(#${clip})` }, run),
    s.label ? sv('rect', { x: 0, y: 0, width: labelW, height: H, fill: s.labelBg }) : null,
    s.label ? sv('text', { x: labelW / 2, y: H / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Math.round(fs * 0.9), 'font-weight': 800, 'font-family': fontCss(s.font), fill: s.labelColor }, s.label) : null);
  // depois de desenhado: mede o texto, põe a segunda cópia colada e liga a rolagem na velocidade (dp/s na TV de 1920)
  (globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 0)))(() => {
    const w = Math.max(1, t1.getComputedTextLength?.() || 0) + fs * 3; // o texto e o respiro antes da próxima volta
    run.append(txt(w));
    const pxs = Math.max(8, Number(speed || 60) * (W / 1920) * 1.5);
    run.append(sv('animateTransform', { attributeName: 'transform', type: 'translate', from: `${labelW} 0`, to: `${labelW - w} 0`, dur: `${(w / pxs).toFixed(2)}s`, repeatCount: 'indefinite' }));
  });
  return svg;
}

/**
 * O cartão da barra inferior. cfg: a configuração guardada da empresa. onSaved(): depois de salvar.
 */
export function faixaCard(cfg, onSaved) {
  const st = { ...TICKER_STYLE_DEFAULT, ...(cleanTickerStyle(cfg.tickerStyle || {}) || {}) };
  if (!cfg.tickerStyle) st.label = '';
  let speed = Number(cfg.tickerSpeed) || 60;
  // os avisos: a classificação ("[institucional]") fica guardada como estava; o estilo vira os botões da linha
  const rows = (cfg.tickerItems || []).map((x) => { const a = splitAviso(x); return { cls: a.class, ...parseAvisoStyle(a.text) }; });
  const list = el('div', { class: 'fx-rows' });
  const pv = el('div', { class: 'fx-pv' });
  const paintPv = () => put(pv, faixaPreview(rows, st, speed));
  function paintRows() {
    put(list, ...rows.map((r, i) => {
      const txt = el('input', { type: 'text', maxlength: String(TL.tickerItem), value: r.text || '', placeholder: 'Escreva o aviso', 'aria-label': `Aviso ${i + 1}`, oninput: (e) => { r.text = e.target.value; paintPv(); } });
      const tog = (k, lbl, title) => el('button', { type: 'button', class: `btn small fx-tg${r[k] ? ' on' : ''}`, title, 'aria-pressed': String(Boolean(r[k])), text: lbl, onclick: (e) => { r[k] = !r[k]; e.currentTarget.classList.toggle('on', r[k]); e.currentTarget.setAttribute('aria-pressed', String(r[k])); paintPv(); } });
      const corOn = el('input', { type: 'checkbox', checked: Boolean(r.color), 'aria-label': `Cor própria do aviso ${i + 1}` });
      const cor = el('input', { type: 'color', value: r.color || st.color, 'aria-label': `Cor do aviso ${i + 1}`, oninput: (e) => { r.color = e.target.value; corOn.checked = true; paintPv(); } });
      corOn.addEventListener('change', () => { r.color = corOn.checked ? cor.value : undefined; paintPv(); });
      const b = tog('bold', 'B', 'Negrito'); b.classList.add('fx-b');
      const it = tog('italic', 'I', 'Itálico'); it.classList.add('fx-i');
      return el('div', { class: 'fx-row' }, txt, b, it, el('label', { class: 'fx-corlin', title: 'Cor própria deste aviso' }, corOn, cor),
        el('button', { type: 'button', class: 'btn small', 'aria-label': 'Subir', disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; paintRows(); paintPv(); } }, '↑'),
        el('button', { type: 'button', class: 'btn small', 'aria-label': 'Descer', disabled: i === rows.length - 1, onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; paintRows(); paintPv(); } }, '↓'),
        btn('Tirar', () => { rows.splice(i, 1); paintRows(); paintPv(); }, 'small danger'));
    }), btns(btn('+ Aviso', () => { if (rows.length >= TL.tickerItems) { toast(`No máximo ${TL.tickerItems} avisos.`, true); return; } rows.push({ cls: 'utilidade', text: '' }); paintRows(); paintPv(); list.querySelector('.fx-row:last-of-type input')?.focus(); }, 'small')));
  }
  /* o estilo da faixa */
  const chk = (k, txt) => el('label', { class: 'pf-check' }, el('input', { type: 'checkbox', checked: Boolean(st[k]), onchange: (e) => { st[k] = e.target.checked; paintPv(); } }), el('span', { text: txt }));
  const rng = (min, max, val, on, unit) => { const out = el('span', { class: 'dim small', text: `${val}${unit}` }); return el('div', { class: 'fx-rng' }, el('input', { type: 'range', min: String(min), max: String(max), value: String(val), oninput: (e) => { on(Number(e.target.value)); out.textContent = `${e.target.value}${unit}`; paintPv(); } }), out); };
  const font = el('select', { onchange: (e) => { st.font = e.target.value; paintPv(); } }, ...TICKER_FONTS.map((x) => opt(x.key, x.label, st.font === x.key)));
  const sep = el('select', { onchange: (e) => { st.sep = e.target.value; paintPv(); } }, ...TICKER_SEPS.map((x) => opt(x.key, x.label, st.sep === x.key)));
  const etq = el('input', { type: 'text', maxlength: '20', value: st.label, placeholder: 'Ex.: AVISOS (vazio = sem etiqueta)', oninput: (e) => { st.label = e.target.value; paintPv(); } });
  const save = guard(async () => {
    const items = rows.map((r) => ({ ...r, text: String(r.text || '').trim() })).filter((r) => r.text).map((r) => markAviso(markAvisoStyle(r), r.cls));
    if (items.length > TL.tickerItems) throw new Error(`No máximo ${TL.tickerItems} avisos.`);
    await tapi('/api/tvcorp/rede/defaults', { method: 'PUT', body: { config: { tickerItems: items, tickerSpeed: speed, tickerStyle: { ...st, label: st.label.trim() } } } });
    toast('Texto rolante salvo. As telas trocam em até 1 minuto.');
    await onSaved?.();
  });
  paintRows(); paintPv();
  return el('div', { class: 'card tc-sec' },
    el('h3', { text: 'Barra inferior (texto rolante)' }),
    note('Vale em toda zona "Texto rolante" dos layouts. Os avisos escritos aqui são da empresa toda; cada unidade e cada grupo podem ter os seus (aba Unidades e grupos e o link da unidade).'),
    label('Como fica na TV'), pv,
    label(`Avisos (até ${TL.tickerItems}, ${TL.tickerItem} letras cada)`),
    note('B deixa o aviso em negrito, I em itálico; marque a cor para o aviso ter uma cor só dele (por exemplo, vermelho numa promoção).'),
    list,
    label('Estilo da faixa'),
    el('div', { class: 'pf-grid two fx-estilo' },
      f('Cor do texto', corField(st.color, (c) => { st.color = c; paintPv(); }, 'Cor do texto')),
      f('Cor do fundo', corField(st.bg, (c) => { st.bg = c; paintPv(); }, 'Cor do fundo')),
      f('Letra', el('div', { class: 'pf-checks row' }, chk('bold', 'Negrito'), chk('italic', 'Itálico'))),
      f('Fonte', font),
      f('Tamanho da letra (da altura da faixa)', rng(TICKER_SIZE.min, TICKER_SIZE.max, st.size, (v) => { st.size = v; }, '%')),
      f('Velocidade', rng(TL.tickerSpeedMin, TL.tickerSpeedMax, speed, (v) => { speed = v; }, ''), 'Mais baixo = mais devagar. O padrão é 60.'),
      f('Separador entre os avisos', sep),
      f('Etiqueta à esquerda', etq),
      f('Cor da etiqueta', corField(st.labelColor, (c) => { st.labelColor = c; paintPv(); }, 'Cor da letra da etiqueta')),
      f('Fundo da etiqueta', corField(st.labelBg, (c) => { st.labelBg = c; paintPv(); }, 'Cor do fundo da etiqueta'))),
    note('Notícias e cotações vão às telas como itens de playlist (aba Playlists) ou numa zona própria do layout. As TVs mostram o estilo novo a partir da próxima versão do aplicativo; as de antes continuam mostrando os avisos, sem o estilo.'),
    btns(btn('Salvar o texto rolante', save, 'primary')));
}
