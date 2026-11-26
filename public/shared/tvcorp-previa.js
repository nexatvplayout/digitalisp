// TV Corporativa · a prévia "Como aparece na TV" (docs/TV-CORPORATIVA.md §4 e §6): o desenho do layout por zonas e dos
// itens que o app NEXA Telas foi programado para mostrar (slides de modelo, aniversariantes, indicador, notícias, cotações,
// contador, dias sem acidente, relógio mundial, cardápio). É um desenho, não o vídeo de verdade.
// Sem estilo pelo script (vale também para o link da unidade, com a CSP estrita): a posição das zonas sai de atributos do
// SVG (x, y, width, height) e as cores de classes de public/shared/tvcorp-previa.css. Sem dependências além do QR code.
//
//   layoutPreview({ orientation: 'land' | 'port', zones: [{ id, kind, x, y, w, h }], background },
//                 { items: { <zona>: item }, theme: { color, mode }, ticker: ['…'], selected: 'zona', labels: true, brand: 'Empresa' })
//   slidePreview('comunicado', { title, text, qr, … }, { theme, image })
//   itemPreview({ kind: 'image' | 'slide' | 'birthdays' | 'kpi' | 'news' | 'quotes' | 'post' | 'menu' | 'countdown' | 'safety' | 'worldclock' | 'text', … })
// Os campos dos itens são os do contrato que o app lê (pacote D): image{url,caption}; slide{template,fields}; post{category,
// title,body,qr,image}; birthdays{title,people[{name,day,month,sector}]}; kpi{name,value,target,unit,band,direction};
// news{source,items[{title,source,at}]}; quotes{items[{label,value,change,prefix,decimals}],at,source}; menu{title,day,
// items[{name,price}|"texto"]}; countdown{title,target,text}; safety{since,record,goal}; worldclock{clocks[{label,tz}]}; text{title,text}.
import { qrSvg } from './telas-previa.js';
import { shapeCommands, edgeCommands, toPathD } from './tvcorp-formas.js';
import { TVC_ART, TVC_PALETTES, TVC_SIZE_FIELDS } from './tvcorp-tipos.js';

const NS = 'http://www.w3.org/2000/svg';
const h = (tag, cls, ...kids) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const k of kids.flat()) if (k != null && k !== false && k !== '') n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
/** append sem os vazios (um null sairia escrito "null" na tela). */
const add = (n, ...kids) => { for (const k of kids.flat()) if (k != null && k !== false) n.append(k); };
const s = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
/**
 * O desenho do tempo (cond do servidor: clear, partly, cloudy, fog, rain, storm, unknown): sol, sol entre nuvens, nuvem,
 * neblina, chuva e tempestade, em SVG (as cores por atributo). night: lua no lugar do sol.
 */
const WX_CONDS = ['clear', 'partly', 'cloudy', 'fog', 'rain', 'storm'];
// de noite (18h às 5h59) o clima usa a foto noturna do mesmo tempo, como o servidor manda para a TV
const wxNoite = () => { const h = new Date().getHours(); return h >= 18 || h < 6 ? ' tvc-wx-noite' : ''; };
export function weatherIcon(cond = 'partly', cls = 'tvc-wx-ico') {
  const sun = (cx, cy, r) => s('g', {}, s('circle', { cx, cy, r, fill: '#fbbf24' }), ...Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return s('line', { x1: cx + Math.cos(a) * (r + 3), y1: cy + Math.sin(a) * (r + 3), x2: cx + Math.cos(a) * (r + 8), y2: cy + Math.sin(a) * (r + 8), stroke: '#fbbf24', 'stroke-width': 3, 'stroke-linecap': 'round' }); }));
  const cloud = (fill = '#e2e8f0', dy = 0) => s('path', { d: `M18 ${46 + dy} a12 12 0 0 1 2-24 a16 16 0 0 1 30-4 a11 11 0 0 1 10 21 z`, fill, transform: `translate(0 ${-dy})` });
  const kids = {
    clear: [sun(32, 32, 13)],
    partly: [sun(24, 22, 10), cloud('#e2e8f0', -4)],
    cloudy: [s('path', { d: 'M26 34 a10 10 0 0 1 2-20 a13 13 0 0 1 24-3 a9 9 0 0 1 8 17 z', fill: '#94a3b8' }), cloud('#e2e8f0')],
    fog: [cloud('#cbd5e1', 6), ...[46, 53, 60].map((y) => s('line', { x1: 12, y1: y, x2: 54, y2: y, stroke: '#cbd5e1', 'stroke-width': 3, 'stroke-linecap': 'round' }))],
    rain: [cloud('#cbd5e1', 8), ...[18, 30, 42].map((x) => s('line', { x1: x, y1: 46, x2: x - 4, y2: 58, stroke: '#38bdf8', 'stroke-width': 3, 'stroke-linecap': 'round' }))],
    storm: [cloud('#94a3b8', 8), s('path', { d: 'M34 42 L26 54 L32 54 L28 63 L40 49 L34 49 L38 42 Z', fill: '#facc15' }), s('line', { x1: 18, y1: 46, x2: 15, y2: 55, stroke: '#38bdf8', 'stroke-width': 3, 'stroke-linecap': 'round' })],
  };
  return s('svg', { class: cls, viewBox: '0 0 64 64', 'aria-hidden': 'true' }, ...(kids[cond] || kids.partly));
}
/** As cores do tema (as mesmas chaves de THEME_COLORS em telas-tipos.js); hex desconhecido = azul. */
const THEME_KEYS = { '#1d4ed8': 'azul', '#15803d': 'verde', '#0f766e': 'petroleo', '#9f1239': 'vinho', '#6d28d9': 'roxo', '#c2410c': 'laranja', '#334155': 'grafite' };
export const themeClass = (theme) => `th-${THEME_KEYS[String(theme?.color || '').toLowerCase()] || 'azul'}${theme?.mode === 'light' ? ' th-light' : ''}`;
/** As cores próprias do slide (fields.palette, DIGITAL ISP): vencem a cor do tema da empresa. */
const PALETTE_KEYS = new Set(TVC_PALETTES.map((x) => x.key));
const slideTheme = (theme, palette) => (PALETTE_KEYS.has(palette) ? `th-${palette}${theme?.mode === 'light' ? ' th-light' : ''}` : themeClass(theme));
/** "nome | preço" -> [nome, preço] (as linhas da vitrine de preços e do horário). */
const rowsOf = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8).map((x) => { const i = x.lastIndexOf('|'); return i < 0 ? [x, ''] : [x.slice(0, i).trim(), x.slice(i + 1).trim()]; });
const ZONE_NAMES = { video: 'Vídeo do canal', playlist: 'Playlist', ticker: 'Texto rolante', clock: 'Relógio', weather: 'Clima', qr: 'QR code', logo: 'Logomarca', text: 'Texto', news: 'Notícias', quotes: 'Cotações', countdown: 'Contador', safety: 'Dias sem acidente', worldclock: 'Relógio mundial', queue: 'Senha', widget: 'Gadget' };
const pad2 = (n) => String(n).padStart(2, '0');
const nowClock = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const brDate = (iso) => String(iso || '').split('-').reverse().join('/');
/** Dias inteiros de hoje até a data (YYYY-MM-DD); passada = 0. */
export function daysUntil(iso, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const d0 = new Date(now); const today = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime();
  return Math.max(0, Math.round((t - today) / 86400000));
}
/** Dias desde a data (dias sem acidente). */
export function daysSince(iso, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const d0 = new Date(now); const today = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime();
  return Math.max(0, Math.round((today - t) / 86400000));
}

/** A barra de meta do indicador: um SVG com a largura pelo atributo (nada de estilo). */
function goalBar(value, target, band) {
  const v = Number(value); const t = Number(target);
  const pct = Number.isFinite(v) && Number.isFinite(t) && t > 0 ? Math.max(0, Math.min(100, (v / t) * 100)) : 0;
  return s('svg', { class: `tvc-bar b-${band || 'none'}`, viewBox: '0 0 100 6', preserveAspectRatio: 'none', role: 'img', 'aria-label': `${Math.round(pct)}% da meta` },
    s('rect', { class: 'tvc-bar-bg', x: 0, y: 0, width: 100, height: 6, rx: 3 }), s('rect', { class: 'tvc-bar-fg', x: 0, y: 0, width: pct.toFixed(1), height: 6, rx: 3 }));
}
const numText = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—');

/* ------------------------------------------------------------------ slides de modelo */
/**
 * Um slide desenhado pelo modelo. fields: os campos do modelo do catálogo comum (public/shared/tvcorp-tipos.js: title, text,
 * name, sector, place, area, target, date, until, value, unit, qr, variant, art; lines e caption dos itens prontos). opts.image: endereço da imagem escolhida (blob: ou do próprio servidor); opts.theme: { color, mode }.
 */
export function slidePreview(template, fields = {}, opts = {}) {
  const f = fields || {};
  // as linhas: as prontas (lines/items do servidor) ou, no cardápio e nos aniversariantes, uma por linha do texto
  const rawLines = Array.isArray(f.lines) ? f.lines : Array.isArray(f.items) ? f.items : ['cardapio', 'aniversariantes'].includes(template) ? String(f.text || '').split('\n') : String(f.lines || '').split('\n');
  const lines = rawLines.map((x) => String(typeof x === 'object' ? x?.name || '' : x).trim()).filter(Boolean).slice(0, 8);
  // a arte de fundo da biblioteca (public/tvcorp/arte/), por classe: só as chaves conhecidas viram classe
  const known = TVC_ART[f.art];
  const art = /^[a-z0-9-]{1,30}$/.test(String(f.art || '')) ? ` tvc-art tvc-art-${f.art}${known ? ` tvc-art-${known.tone === 'light' ? 'light' : 'dark'}${known.photo ? ' tvc-photo' : ''}` : ''}` : '';
  const theme = f.variant === 'light' || f.variant === 'dark' ? { ...(opts.theme || {}), mode: f.variant } : opts.theme;
  // o tamanho de cada elemento (QR, preço, foto, título): tvc-qr-l, tvc-price-xl…; vazio = médio
  const sizes = TVC_SIZE_FIELDS.filter((k) => ['s', 'l', 'xl'].includes(f[k])).map((k) => ` tvc-${k.replace('Size', '')}-${f[k]}`).join('');
  const n = h('div', `tvc-sl tvc-sl-${template || 'comunicado'} ${slideTheme(theme, f.palette)}${art}${f.orient === 'port' ? ' tvc-port' : ''}${sizes}`);
  n.setAttribute('role', 'img'); n.setAttribute('aria-label', `Prévia do slide: ${f.title || f.caption || template || ''}`);
  const caption = f.caption || (template === 'imagem-com-legenda' ? f.title : '');
  const img = opts.image ? Object.assign(h('img', 'tvc-sl-img'), { alt: '', src: opts.image }) : null;
  const qr = f.qr ? qrSvg(f.qr, 'tvc-sl-qrc') : null;
  const title = h('div', 'tvc-sl-t', f.title || '');
  switch (template) {
    case 'boas-vindas': case 'reconhecimento':
      add(n, h('div', 'tvc-sl-side', img || h('div', 'tvc-sl-ini', String(f.name || '?').split(/\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase())),
        h('div', 'tvc-sl-body', title, h('div', 'tvc-sl-name', f.name || 'Nome'), f.sector ? h('div', 'tvc-sl-x', f.sector) : null, f.text ? h('div', 'tvc-sl-x', f.text) : null));
      break;
    case 'aniversariantes': case 'cardapio':
      add(n, h('div', 'tvc-sl-body', title, lines.length ? h('ul', 'tvc-sl-list', lines.map((x) => h('li', '', x))) : h('div', 'tvc-sl-x dim', 'Sem linhas ainda')));
      break;
    case 'evento': {
      const day = String(f.target || f.date || '').slice(0, 10); const d = daysUntil(day);
      add(n, h('div', 'tvc-sl-body', title, f.place ? h('div', 'tvc-sl-x', f.place) : null, f.text ? h('div', 'tvc-sl-x', f.text) : null),
        h('div', 'tvc-sl-count', d == null ? h('span', 'tvc-sl-x', 'Escolha a data') : [h('b', '', String(d)), h('span', '', d === 1 ? 'dia' : 'dias'), h('small', '', `${brDate(day)}${String(f.target || '').length > 10 ? ` · ${String(f.target).slice(11, 16)}` : ''}`)]), qr);
      break;
    }
    case 'indicador': {
      const band = (() => { const v = Number(f.value); const t = Number(f.target); if (!Number.isFinite(v) || !Number.isFinite(t) || !t) return 'none'; const r = v / t; return r >= 1 ? 'ok' : r >= 0.8 ? 'warn' : 'bad'; })();
      add(n, h('div', 'tvc-sl-body', title, h('div', `tvc-sl-big b-${band}`, `${numText(f.value)}${f.unit ? ` ${f.unit}` : ''}`),
        h('div', 'tvc-sl-x', `Meta: ${numText(f.target)}${f.unit ? ` ${f.unit}` : ''}`), goalBar(f.value, f.target, band)));
      break;
    }
    case 'imagem-com-legenda':
      add(n, img || h('div', 'tvc-sl-noimg', 'Escolha a imagem'), caption ? h('div', 'tvc-sl-cap', caption) : null);
      break;
    case 'oferta': case 'combo': {
      const price = h('div', 'tvc-sl-price', f.oldPrice ? h('span', 'tvc-sl-old', 'De ', h('del', '', f.oldPrice), ' por') : null, h('b', String(f.price || '').length > 10 ? 'tvc-sl-long' : '', f.price || 'R$ 0,00'), f.unit ? h('small', '', f.unit) : null);
      const list = template === 'combo' ? rowsOf(f.text).map(([a, b]) => (b ? `${a} ${b}` : a)) : [];
      add(n, h('div', 'tvc-sl-body', f.tag ? h('div', 'tvc-sl-tag', f.tag) : null, title,
        list.length ? h('ul', 'tvc-sl-list', list.map((x) => h('li', '', x))) : f.text ? h('div', 'tvc-sl-x', f.text) : null,
        f.until ? h('div', 'tvc-sl-x tvc-sl-small', `Válido até ${brDate(f.until)} ou enquanto durar o estoque.`) : null), price, qr);
      break;
    }
    case 'precos': case 'horario': {
      const rows = rowsOf(f.text);
      add(n, h('div', 'tvc-sl-body', title, rows.length ? h('ul', 'tvc-sl-rows', rows.map(([a, b]) => h('li', '', h('span', '', a), b ? h('b', '', b) : null))) : h('div', 'tvc-sl-x dim', 'Sem linhas ainda'),
        f.note ? h('div', 'tvc-sl-x tvc-sl-small', f.note) : null), qr);
      break;
    }
    case 'redes':
      add(n, h('div', 'tvc-sl-body', title, h('div', 'tvc-sl-handle', f.handle || '@perfil'), f.text ? h('div', 'tvc-sl-x', f.text) : null, f.site ? h('div', 'tvc-sl-x tvc-sl-small', f.site) : null), qr);
      break;
    case 'seguranca':
      add(n, h('div', 'tvc-sl-body', h('div', 'tvc-sl-tag', 'SEGURANÇA'), title, f.text ? h('div', 'tvc-sl-x', f.text) : null, Array.isArray(f.lines) && lines.length ? h('ul', 'tvc-sl-list', lines.map((x) => h('li', '', x))) : null), qr);
      break;
    default: // comunicado, vaga, qr, data-comemorativa
      add(n, h('div', 'tvc-sl-body', template === 'vaga' ? h('div', 'tvc-sl-tag', 'VAGA INTERNA') : null, title, f.area ? h('div', 'tvc-sl-x', f.area) : null, f.text ? h('div', 'tvc-sl-x', f.text) : null,
        f.until ? h('div', 'tvc-sl-x', `Inscrições até ${brDate(f.until)}`) : f.date ? h('div', 'tvc-sl-x', brDate(f.date)) : null), qr);
  }
  fitSlide(n);
  return n;
}

/* o slide com texto demais para o quadro (tabela de preços longa, quadro baixo da zona): diminui o conteúdo em degraus
   (classes tvc-fit-1 a tvc-fit-6) até caber, em vez de cortar em cima e embaixo. Refaz quando o quadro muda de tamanho. */
const FIT_STEPS = 6;
function fitSlide(n) {
  if (typeof ResizeObserver !== 'function') return;
  let busy = false;
  const fit = () => {
    if (busy || !n.isConnected || !n.clientHeight) return;
    busy = true;
    for (let i = 1; i <= FIT_STEPS; i++) n.classList.remove(`tvc-fit-${i}`);
    for (let i = 1; i <= FIT_STEPS && n.scrollHeight > n.clientHeight + 2; i++) {
      if (i > 1) n.classList.remove(`tvc-fit-${i - 1}`);
      n.classList.add(`tvc-fit-${i}`);
    }
    busy = false;
  };
  const ro = new ResizeObserver(() => fit());
  ro.observe(n);
  // as fotos e as fontes chegam depois: confere de novo quando carregam
  n.querySelectorAll?.('img').forEach((im) => im.addEventListener('load', fit, { once: true }));
}

/* ------------------------------------------------------------------ itens da playlist */
/** Um item como o app desenha (o formato do contrato §4.1, itens com os dados já prontos). */
export function itemPreview(it = {}, opts = {}) {
  const th = themeClass(opts.theme);
  const box = (cls, ...kids) => h('div', `tvc-it ${cls} ${th}`, ...kids);
  switch (it.kind) {
    case 'video': {
      // o vídeo próprio: na prévia, a miniatura com o tempo (a TV toca o arquivo)
      const img = it.poster ? h('img', 'tvc-it-img') : null; if (img) { img.alt = it.title || ''; img.src = it.poster; }
      const fill = it.poster ? h('img', 'tvc-it-fill') : null; if (fill) { fill.alt = ''; fill.src = it.poster; }
      const s = Number(it.seconds) || 0;
      return box('tvc-it-image tvc-it-video', fill, img || h('div', 'tvc-it-vph', 'Vídeo'), h('span', 'tvc-it-vbadge', it.processing ? 'Preparando…' : `▶ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`));
    }
    case 'image': {
      if (!it.url) return box('tvc-it-empty', 'Imagem');
      // a imagem inteira (como a TV: fit contain), com a mesma foto desfocada atrás: no quadro quase quadrado nada fica cortado
      const fill = h('img', 'tvc-it-fill'); fill.alt = ''; fill.src = it.url;
      const img = h('img', 'tvc-it-img'); img.alt = it.caption || it.title || ''; img.src = it.url;
      return box('tvc-it-image', fill, img, it.caption ? h('div', 'tvc-sl-cap', it.caption) : null);
    }
    case 'slide': return slidePreview(it.template, it.fields, { theme: opts.theme, image: it.image || null });
    case 'post': return slidePreview(it.category === 'vaga' ? 'vaga' : it.category === 'seguranca' ? 'seguranca' : 'comunicado', { title: it.title, text: it.body ?? it.text, qr: it.qr }, { theme: opts.theme, image: typeof it.image === 'string' ? it.image : it.image?.url || null });
    case 'text': return box('tvc-it-text', it.title ? h('div', 'tvc-it-t', it.title) : null, h('div', 'tvc-it-x', it.text || ''));
    case 'birthdays': {
      // festivo: a arte de confete, as pessoas lado a lado com a foto (só com a autorização) ou as iniciais num círculo
      // dourado; quanto menos gente, maior cada uma (n1, n3, n6, n8)
      const ppl = (it.people || []).slice(0, 8);
      const size = ppl.length <= 1 ? 'n1' : ppl.length <= 3 ? 'n3' : ppl.length <= 6 ? 'n6' : 'n8';
      return box(`tvc-it-bday ${size}`, h('div', 'tvc-it-t', it.title || 'Aniversariantes'),
        ppl.length ? h('ul', 'tvc-bday-people', ppl.map((p) => {
          const src = typeof p.photo === 'string' ? p.photo : p.photo?.url || '';
          let av;
          if (src) { av = h('img', 'tvc-av'); av.src = src; av.alt = ''; } else av = h('span', 'tvc-av tvc-av-ini', p.initials || String(p.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase());
          return h('li', '', av, h('b', '', p.name), h('span', '', `${pad2(p.day)}/${pad2(p.month)}${p.sector ? ` · ${p.sector}` : ''}`));
        })) : h('div', 'tvc-it-x', 'Ninguém faz aniversário nestes dias'),
        ppl.length ? h('div', 'tvc-bday-wish', 'Parabéns! Muitas felicidades!') : null);
    }
    case 'kpi': return box(`tvc-it-kpi b-${it.band || 'none'}`, h('div', 'tvc-it-t', it.name || 'Indicador'), h('div', 'tvc-it-big', `${numText(it.value)}${it.unit ? ` ${it.unit}` : ''}`),
      it.target != null ? h('div', 'tvc-it-x', `Meta: ${numText(it.target)}${it.unit ? ` ${it.unit}` : ''}`) : null, it.target != null ? goalBar(it.value, it.target, it.band) : null);
    case 'news': {
      // DIGITAL ISP: uma notícia sozinha: a foto em tela cheia e a faixa com o nome da fonte, a manchete e a hora
      if (it.single) {
        const x = (it.items || [])[0] || {};
        const src = typeof it.image === 'string' ? it.image : it.image?.url || null;
        const img = src ? h('img', 'tvc-news-img') : null; if (img) { img.alt = ''; img.src = src; }
        const hora = x.at ? new Date(x.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        return box(`tvc-it-newsone${src ? '' : ' tvc-news-semfoto'}`, img,
          h('div', 'tvc-news-band', h('div', 'tvc-news-kicker', it.title || 'Notícias'), h('div', 'tvc-news-head', x.title || 'Sem manchete ainda'),
            h('div', 'tvc-news-src', [x.source || it.source, hora].filter(Boolean).join(' · '))));
      }
      const items = (it.items || []).slice(0, 4);
      return box('tvc-it-news', h('div', 'tvc-it-t', it.title || 'Notícias'),
        items.length ? h('ul', 'tvc-it-list', items.map((x) => h('li', '', x.title, h('small', '', [x.source, x.at ? new Date(x.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''].filter(Boolean).join(' · '))))) : h('div', 'tvc-it-x', 'Sem manchetes ainda'),
        it.source || it.credit ? h('div', 'tvc-it-credit', it.credit || `Fonte: ${it.source}`) : null);
    }
    case 'quotes': {
      const items = (it.items || []).slice(0, 6);
      return box('tvc-it-quotes', h('div', 'tvc-it-t', it.title || 'Cotações'),
        items.length ? h('ul', 'tvc-it-list', items.map((x) => {
          const dec = Number.isInteger(x.decimals) ? x.decimals : 2;
          const val = Number.isFinite(Number(x.value)) ? Number(x.value).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—';
          return h('li', '', h('b', '', x.label || x.pair), ` ${x.prefix ?? 'R$'} ${val}`, x.change != null ? h('span', Number(x.change) >= 0 ? 'up' : 'down', ` ${Number(x.change) >= 0 ? '▲' : '▼'} ${numText(Math.abs(x.change))}%`) : null);
        })) : h('div', 'tvc-it-x', 'Sem cotações ainda'),
        h('div', 'tvc-it-credit', [it.source ? `Fonte: ${it.source}` : '', 'valores de referência', it.at ? new Date(it.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''].filter(Boolean).join(' · ')));
    }
    case 'menu': {
      const list = (it.items || it.lines || []).slice(0, 8).map((x) => (typeof x === 'string' ? x : `${x.name || ''}${x.price != null && x.price !== '' ? ` · R$ ${numText(x.price)}` : ''}`)).filter(Boolean);
      return box('tvc-it-menu', h('div', 'tvc-it-t', it.title || `Cardápio${it.day ? ` · ${it.day}` : ' de hoje'}`), list.length ? h('ul', 'tvc-it-list', list.map((x) => h('li', '', x))) : h('div', 'tvc-it-x', 'Sem cardápio para hoje'));
    }
    case 'countdown': {
      // quanto falta para começar (target) e, depois, para terminar (until); dias, horas, minutos e segundos. A tela chama
      // tickCountdowns(nó) a cada segundo; aqui já sai com o valor de agora
      const toMs = (v) => { if (typeof v === 'number') return v; const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(v ?? '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : null; };
      const at = toMs(it.target ?? it.date); const until = toMs(it.until);
      const label = h('div', 'tvc-cd-lbl', '');
      const units = [['dias', 'dia'], ['horas', 'hora'], ['min', 'min'], ['seg', 'seg']].map(([pl, sg]) => { const b = h('b', '', '00'); const sp = h('span', '', pl); return { u: h('div', 'tvc-cd-u', b, sp), b, sp, pl, sg }; });
      const node = box('tvc-it-count tvc-tick', h('div', 'tvc-it-t', it.title || 'Contagem regressiva'), label, h('div', 'tvc-cd', units.map((x) => x.u)), it.text ? h('div', 'tvc-it-x', it.text) : null);
      node._tvcTick = (now = Date.now()) => {
        if (at == null) { label.textContent = 'Escolha a data'; return; }
        const phase = now < at ? 'start' : until != null && now < until ? 'end' : 'done';
        label.textContent = phase === 'start' ? 'Começa em' : phase === 'end' ? 'Termina em' : until != null ? 'Encerrado' : 'É hoje!';
        const ms = Math.max(0, phase === 'start' ? at - now : phase === 'end' ? until - now : 0);
        const sec = Math.floor(ms / 1000);
        [Math.floor(sec / 86400), Math.floor(sec / 3600) % 24, Math.floor(sec / 60) % 60, sec % 60].forEach((v, i) => {
          units[i].b.textContent = i ? pad2(v) : String(v); units[i].sp.textContent = v === 1 ? units[i].sg : units[i].pl;
        });
      };
      if (at != null) node.setAttribute('data-tvc-at', String(at));
      if (until != null) node.setAttribute('data-tvc-until', String(until));
      node._tvcTick();
      return node;
    }
    case 'safety': {
      const d = it.days ?? daysSince(it.since);
      return box('tvc-it-safety', h('div', 'tvc-it-t', it.title || 'Dias sem acidente'), h('div', 'tvc-it-big', d == null ? '—' : String(d)),
        h('div', 'tvc-it-x', [it.record != null ? `Recorde: ${it.record}` : '', it.goal != null ? `Meta: ${it.goal}` : ''].filter(Boolean).join(' · ')));
    }
    case 'worldclock': {
      const clocks = (it.clocks || []).slice(0, 6);
      return box('tvc-it-world', h('div', 'tvc-it-t', it.title || 'Relógio mundial'), h('ul', 'tvc-it-list', clocks.map(({ tz, label }) => {
        let t = '—'; try { t = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz }); } catch { /* fuso desconhecido */ }
        return h('li', '', h('b', '', label || tz), ` ${t}`);
      })));
    }
    /* ---------------------------------------------------------------- DIGITAL ISP: os gadgets novos */
    case 'weather': {
      const t = (v) => (Number.isFinite(Number(v)) ? `${Math.round(Number(v))}°` : '—');
      const days = (it.days || []).slice(0, 4);
      return box(`tvc-it-wx tvc-wx-${WX_CONDS.includes(it.cond) ? it.cond : 'partly'}${wxNoite()}`, h('div', 'tvc-it-t', it.title || [it.city, it.uf].filter(Boolean).join(' · ') || 'Clima'),
        h('div', 'tvc-wx-now', weatherIcon(it.cond || 'partly'), h('b', '', it.tempC != null ? t(it.tempC) : `${t(it.min)} / ${t(it.max)}`), h('span', '', it.text || '')),
        days.length ? h('ul', 'tvc-wx-days', days.map((d) => h('li', '', weatherIcon(d.cond || 'partly', 'tvc-wx-ico-s'), h('b', '', String(d.weekday || brDate(d.date).slice(0, 5))), h('span', '', `${t(d.min)} / ${t(d.max)}`), d.text ? h('small', '', d.text) : null))) : null,
        it.source ? h('div', 'tvc-it-credit', `Fonte: ${it.source}`) : null);
    }
    case 'clock': {
      // digital (hora grande) ou analógico (ponteiros num SVG); anda pelo tickCountdowns, no fuso do gadget
      const tz = it.tz || undefined;
      const partsAt = (now) => { const d = new Date(now); let hh = d.getHours(); let mm = d.getMinutes(); let ss = d.getSeconds();
        try { const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d); const g = (k) => Number((p.find((x) => x.type === k) || {}).value); hh = g('hour') % 24; mm = g('minute'); ss = g('second'); } catch { /* fuso desconhecido: o do aparelho */ }
        return { hh, mm, ss }; };
      const dateOf = (now) => { try { return new Date(now).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }); } catch { return new Date(now).toLocaleDateString('pt-BR'); } };
      const label = it.label ? h('div', 'tvc-it-t', it.label) : null;
      const dateEl = it.date !== false ? h('div', 'tvc-clk-date', '') : null;
      let node; let paint;
      if (it.face === 'analog') {
        const hand = (cls, len, w) => s('line', { class: cls, x1: 50, y1: 50, x2: 50, y2: 50 - len, 'stroke-width': w, 'stroke-linecap': 'round' });
        const hH = hand('tvc-clk-h', 24, 4.5); const hM = hand('tvc-clk-m', 34, 3); const hS = it.showSeconds !== false ? hand('tvc-clk-s', 38, 1.2) : null;
        const svg = s('svg', { class: 'tvc-clk-face', viewBox: '0 0 100 100', role: 'img', 'aria-label': 'Relógio' }, s('circle', { class: 'tvc-clk-bg', cx: 50, cy: 50, r: 47 }));
        for (let i = 0; i < 12; i++) svg.append(s('line', { class: 'tvc-clk-tick', x1: 50, y1: 6, x2: 50, y2: i % 3 ? 10 : 13, 'stroke-width': i % 3 ? 1.5 : 3, transform: `rotate(${i * 30} 50 50)` }));
        svg.append(hH, hM); if (hS) svg.append(hS); svg.append(s('circle', { class: 'tvc-clk-dot', cx: 50, cy: 50, r: 3 }));
        node = box('tvc-it-clock analog tvc-tick', label, svg, dateEl);
        paint = (now) => { const { hh, mm, ss } = partsAt(now);
          hH.setAttribute('transform', `rotate(${((hh % 12) + mm / 60) * 30} 50 50)`); hM.setAttribute('transform', `rotate(${(mm + ss / 60) * 6} 50 50)`); if (hS) hS.setAttribute('transform', `rotate(${ss * 6} 50 50)`); };
      } else {
        const big = h('div', 'tvc-clk-time', '');
        node = box('tvc-it-clock digital tvc-tick', label, big, dateEl);
        paint = (now) => { const { hh, mm, ss } = partsAt(now); big.textContent = `${pad2(hh)}:${pad2(mm)}${it.showSeconds !== false ? `:${pad2(ss)}` : ''}`; };
      }
      node._tvcTick = (now = Date.now()) => { paint(now); if (dateEl) dateEl.textContent = dateOf(now); };
      node._tvcTick();
      return node;
    }
    case 'agenda': {
      const today = it.today || '';
      const list = (it.events || []).slice(0, 6);
      return box('tvc-it-agenda', h('div', 'tvc-it-t', it.title || 'Agenda'),
        list.length ? h('ul', 'tvc-ag-list', list.map((e) => h('li', '', h('span', 'tvc-ag-when', h('b', '', e.date === today ? 'Hoje' : brDate(e.date).slice(0, 5)), e.time ? h('small', '', `${e.time}${e.end ? `–${e.end}` : ''}`) : null),
          h('span', 'tvc-ag-what', h('b', '', e.title), e.place ? h('small', '', e.place) : null)))) : h('div', 'tvc-it-x', 'Nenhum compromisso pela frente'));
    }
    case 'reviews': {
      const list = (it.items || []).slice(0, 3);
      const qr = it.qr ? qrSvg(it.qr, 'tvc-sl-qrc') : null;
      return box('tvc-it-reviews', h('div', 'tvc-it-t', it.title || 'O que dizem os clientes'),
        h('div', 'tvc-rv-row', h('ul', 'tvc-rv-list', list.map((r) => h('li', '', h('span', 'tvc-rv-stars', '★'.repeat(Math.max(1, Math.min(5, Number(r.stars) || 5)))), h('q', '', r.text), h('small', '', r.name || 'Cliente')))), qr));
    }
    case 'dashboard': {
      const list = (it.items || []).slice(0, 6);
      return box(`tvc-it-dash n${list.length}`, h('div', 'tvc-it-t', it.title || 'Indicadores'),
        h('ul', 'tvc-dash-list', list.map((k) => h('li', '', h('span', '', k.name || ''), h('b', `b-${k.band || 'none'}`, `${numText(k.value)}${k.unit ? ` ${k.unit}` : ''}`),
          k.target != null ? h('small', '', `Meta: ${numText(k.target)}${k.unit ? ` ${k.unit}` : ''}`) : null, k.target != null ? goalBar(k.value, k.target, k.band) : null))));
    }
    case 'directions': {
      const qr = it.qr ? qrSvg(it.qr, 'tvc-sl-qrc') : null;
      return box('tvc-it-dir', h('div', 'tvc-dir-row', h('div', 'tvc-dir-body', h('div', 'tvc-it-t', it.title || 'Como chegar'), h('div', 'tvc-dir-addr', it.address || ''),
        it.reference ? h('div', 'tvc-it-x', it.reference) : null, it.hours ? h('div', 'tvc-it-x', it.hours) : null, it.phone ? h('div', 'tvc-it-x', it.phone) : null), qr),
        qr ? h('div', 'tvc-it-credit', 'Aponte a câmera para abrir o mapa') : null);
    }
    case 'web': {
      // a tela abre o endereço (o app da TV num quadro, o Android numa WebView); a prévia mostra só o endereço
      // embeddable false: o site recusa ser aberto dentro de outro (as TVs Samsung/LG mostram este aviso; o Android abre direto)
      const n = box(`tvc-it-web${it.embeddable === false ? ' blocked' : ''}`, h('div', 'tvc-it-t', 'Página da internet'), h('div', 'tvc-it-x', String(it.url || '').replace(/^https:\/\//, '')),
        it.embeddable === false ? h('div', 'tvc-it-x tvc-web-warn', 'Este site não deixa ser aberto dentro de outro: nas TVs Samsung e LG aparece este aviso no lugar da página.') : null,
        h('div', 'tvc-it-credit', it.refreshMin ? `Recarrega a cada ${it.refreshMin} min` : 'Aberta na tela como está no site'));
      if (it.embeddable === false) n.setAttribute('data-embeddable', 'false');
      if (it.url) n.setAttribute('data-url', String(it.url));
      return n;
    }
    default: return box('tvc-it-empty', it.title || 'Item');
  }
}

/**
 * Atualiza o que anda sozinho dentro do nó (os contadores e os relógios, classe tvc-tick): os apps das telas e o painel
 * chamam a cada segundo. tickWidgets é o mesmo, com o nome geral.
 */
export function tickCountdowns(root, now = Date.now()) {
  if (!root) return;
  if (typeof root._tvcTick === 'function') root._tvcTick(now);
  const list = typeof root.querySelectorAll === 'function' ? root.querySelectorAll('.tvc-tick') : [];
  for (let i = 0; i < list.length; i++) if (typeof list[i]._tvcTick === 'function') list[i]._tvcTick(now);
}

export const tickWidgets = tickCountdowns;

/* ------------------------------------------------------------------ zonas */
function zoneContent(zone, opts) {
  const it = opts.items?.[zone.id];
  const th = themeClass(opts.theme);
  switch (zone.kind) {
    case 'video': return h('div', 'tvc-z-video', h('span', 'tvc-live', 'AO VIVO'), h('span', 'tvc-z-vt', opts.channel || 'Vídeo do canal'));
    case 'playlist': return it ? itemPreview(it, opts) : h('div', `tvc-z-empty ${th}`, 'Playlist');
    case 'ticker': {
      // os avisos (texto ou { text, … }); a etiqueta à esquerda só quando a faixa tem uma (tickerStyle.label: public/shared/faixa.js)
      const t = (opts.ticker || []).map((x) => (typeof x === 'string' ? x : x?.text)).filter(Boolean);
      const s = opts.tickerStyle || null;
      const sep = s ? ({ ponto: '•', barra: '|', traco: '—', estrela: '★', nada: '' }[s.sep] ?? '•') : '·';
      return h('div', `tvc-z-ticker ${th}${s?.bold === false ? ' tvc-tk-leve' : ''}${s?.italic ? ' tvc-tk-it' : ''}`, s?.label ? h('b', '', s.label) : null, h('span', '', t.length ? t.join(sep ? `  ${sep}  ` : '   ') : 'Texto rolante'));
    }
    case 'clock': return h('div', `tvc-z-clock ${th}`, h('b', '', opts.clock || nowClock()), h('span', '', opts.date || new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })));
    case 'weather': {
      // o clima de verdade (opts.weather: o mesmo bloco que a TV recebe) ou o exemplo
      const w = opts.weather || null;
      const temp = w?.now?.temp ?? w?.today?.max ?? null;
      const cond = w?.now?.cond || w?.today?.cond || 'partly';
      return h('div', `tvc-z-weather ${th} tvc-wx-${WX_CONDS.includes(cond) ? cond : 'partly'}${wxNoite()}`, weatherIcon(cond), h('b', '', temp != null ? `${Math.round(temp)}°` : '27°'),
        h('span', '', w ? (w.now?.text || w.today?.text || w.place?.city || 'Clima') : opts.city || 'Clima da unidade'));
    }
    // o texto fixo da zona (boas-vindas, horário, Wi-Fi): o título e a frase que o cliente escreveu
    case 'text': return zone.title || zone.text ? h('div', `tvc-it tvc-it-text ${th}`, zone.title ? h('div', 'tvc-it-t', zone.title) : null, zone.text ? h('div', 'tvc-it-x', zone.text) : null) : h('div', `tvc-z-empty ${th}`, 'Texto');
    case 'qr': return h('div', `tvc-z-qr ${th}`, opts.qr ? qrSvg(opts.qr, 'tvc-z-qrc') : h('div', 'tvc-z-qrph'), h('span', '', opts.qrLabel || 'Aponte a câmera'));
    case 'logo': return h('div', `tvc-z-logo ${th}`, opts.logo ? Object.assign(h('img', ''), { alt: 'Logomarca', src: opts.logo }) : h('span', '', opts.brand || 'Logomarca'));
    // DIGITAL ISP: a entrada HDMI da TV (só o app Samsung mostra a imagem; aqui, o lugar dela)
    case 'hdmi': return h('div', 'tvc-z-video tvc-z-hdmi', h('span', 'tvc-live tvc-hdmi', 'HDMI'), h('span', 'tvc-z-vt', opts.hdmi || (zone.input ? `Entrada HDMI ${zone.input}` : 'Entrada HDMI da TV')));
    case 'queue': return h('div', `tvc-z-queue ${th}`, h('span', '', 'SENHA'), h('b', '', 'A 042'), h('span', '', 'Guichê 2'));
    default: return it ? itemPreview(it, opts) : h('div', `tvc-z-empty ${th}`, ZONE_NAMES[zone.kind] || zone.kind);
  }
}
/** O tamanho do quadro (16:9 deitado ou 9:16 em pé) nas unidades do SVG; as zonas vêm em % e viram unidades. */
export const frameOf = (orientation) => (orientation === 'port' ? { w: 90, h: 160 } : { w: 160, h: 90 });

/**
 * O layout por zonas: um SVG com cada zona no lugar (x, y, largura e altura pelos atributos) e, dentro, o que ela mostra.
 * opts.selected destaca uma zona; opts.labels põe o nome dela no canto; opts.onZone(id) torna as zonas clicáveis.
 */
let CLIP_SEQ = 0;
export function layoutPreview(layout = {}, opts = {}) {
  // DIGITAL ISP: opts.wall { cols, rows, bezel, orientation } desenha o videowall inteiro (o layout no tamanho do conjunto)
  const fr = opts.wall ? wallFrame(opts.wall) : frameOf(layout.orientation);
  const wrap = h('div', `tvc-previa ${opts.wall ? 'wall' : layout.orientation === 'port' ? 'port' : 'land'}`);
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `Prévia do layout${layout.name ? ` ${layout.name}` : ''}: ${(layout.zones || []).map((z) => ZONE_NAMES[z.kind] || z.kind).join(', ')}`);
  const svg = s('svg', { class: 'tvc-svg', viewBox: `0 0 ${fr.w} ${fr.h}`, preserveAspectRatio: 'xMidYMid meet' });
  svg.append(s('rect', { class: `tvc-bg ${themeClass(opts.theme)}`, x: 0, y: 0, width: fr.w, height: fr.h }));
  // a cor de fundo própria do layout (azul, verde...): por atributo; os fundos padrão (escuro, claro, preto) seguem o tema
  if (/^#[0-9a-f]{6}$/i.test(layout.background || '') && !['#0b1220', '#eef2f7', '#000000'].includes(layout.background.toLowerCase())) svg.append(s('rect', { x: 0, y: 0, width: fr.w, height: fr.h, fill: layout.background }));
  // a camada de baixo primeiro, a de cima (overlay) por último: ela fica sobre a imagem
  // em cada camada, os retângulos e depois os formatos (a zona recortada entra na vizinha)
  const zs = layout.zones || []; const lay = (ov) => [...zs.filter((z) => Boolean(z.overlay) === ov && !z.shape), ...zs.filter((z) => Boolean(z.overlay) === ov && z.shape)];
  const ordered = [...lay(false), ...lay(true)];
  const defs = s('defs', {}); svg.append(defs);
  for (const zone of ordered) {
    const x = (zone.x / 100) * fr.w; const y = (zone.y / 100) * fr.h; const w = (zone.w / 100) * fr.w; const hh = (zone.h / 100) * fr.h;
    const g = s('g', { class: `tvc-zone k-${zone.kind}${zone.overlay ? ' ov' : ''}${opts.selected === zone.id ? ' sel' : ''}`, 'data-zone': zone.id });
    const fo = s('foreignObject', { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: hh.toFixed(2) });
    // o formato: um clipPath em coordenadas do quadro, ligado ao foreignObject por atributo (sem estilo pelo script)
    const cut = zone.shape ? shapeCommands(zone.shape, w, hh, x, y) : null;
    if (cut) { const id = `tvcclip${++CLIP_SEQ}`; const cp = s('clipPath', { id }); cp.append(s('path', { d: toPathD(cut) })); defs.append(cp); fo.setAttribute('clip-path', `url(#${id})`); }
    fo.append(h('div', zone.overlay ? `tvc-z tvc-ov tvc-op-${Math.round(Math.max(0, Math.min(100, zone.opacity ?? 60)) / 20) * 20}` : 'tvc-z', zoneContent(zone, opts)));
    g.append(fo, cut ? s('path', { class: 'tvc-zb', d: toPathD(cut) }) : s('rect', { class: 'tvc-zb', x: (x + 0.3).toFixed(2), y: (y + 0.3).toFixed(2), width: Math.max(0, w - 0.6).toFixed(2), height: Math.max(0, hh - 0.6).toFixed(2), rx: 0.8 }));
    // o filete: largura em % da altura da tela
    if (cut && zone.edge) g.append(s('path', { class: 'tvc-edge', d: toPathD(edgeCommands(zone.shape, w, hh, x, y)), stroke: zone.edge.color, 'stroke-width': ((Number(zone.edge.width) || 1) / 100 * fr.h).toFixed(2) }));
    if (opts.labels) {
      const t = s('text', { class: 'tvc-zl', x: (x + 1.5).toFixed(2), y: (y + 4.2).toFixed(2) });
      t.textContent = `${zone.id} · ${ZONE_NAMES[zone.kind] || zone.kind}`;
      g.append(t);
    }
    if (opts.onZone) { g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.addEventListener('click', () => opts.onZone(zone.id)); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onZone(zone.id); } }); }
    svg.append(g);
  }
  if (opts.wall) wallMarks(svg, opts.wall);
  wrap.append(svg);
  return wrap;
}
/** O quadro do videowall: cada TV no tamanho do quadro de uma tela, mais a moldura entre elas. */
export function wallFrame({ cols = 1, rows = 1, bezel = {}, orientation = 'land' }) {
  const one = frameOf(orientation); const bx = (Number(bezel.x) || 0) / 100; const by = (Number(bezel.y) || 0) / 100;
  return { w: one.w * (cols + (cols - 1) * bx), h: one.h * (rows + (rows - 1) * by), one, bx, by };
}
// as molduras (a parte do conteúdo que fica escondida atrás das bordas) e o número de cada posição
function wallMarks(svg, wall) {
  const fr = wallFrame(wall); const { one } = fr; const bw = Math.max(0.6, fr.bx * one.w); const bh = Math.max(0.6, fr.by * one.h);
  for (let c = 1; c < wall.cols; c++) svg.append(s('rect', { class: 'tvc-bezel', x: (c * one.w * (1 + fr.bx) - bw).toFixed(2), y: 0, width: bw.toFixed(2), height: fr.h.toFixed(2) }));
  for (let r = 1; r < wall.rows; r++) svg.append(s('rect', { class: 'tvc-bezel', x: 0, y: (r * one.h * (1 + fr.by) - bh).toFixed(2), width: fr.w.toFixed(2), height: bh.toFixed(2) }));
  if (wall.numbers === false) return;
  for (let r = 0; r < wall.rows; r++) for (let c = 0; c < wall.cols; c++) {
    const t = s('text', { class: 'tvc-wall-n', x: (c * one.w * (1 + fr.bx) + one.w / 2).toFixed(2), y: (r * one.h * (1 + fr.by) + one.h / 2).toFixed(2) });
    t.textContent = String(r * wall.cols + c + 1); svg.append(t);
  }
}
/** A prévia com a legenda embaixo. */
export const layoutFigure = (layout, opts = {}, caption = '') => h('figure', 'tvc-fig', layoutPreview(layout, opts), caption ? h('figcaption', '', caption) : null);
