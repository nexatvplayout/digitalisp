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
/** As cores do tema (as mesmas chaves de THEME_COLORS em telas-tipos.js); hex desconhecido = azul. */
const THEME_KEYS = { '#1d4ed8': 'azul', '#15803d': 'verde', '#0f766e': 'petroleo', '#9f1239': 'vinho', '#6d28d9': 'roxo', '#c2410c': 'laranja', '#334155': 'grafite' };
export const themeClass = (theme) => `th-${THEME_KEYS[String(theme?.color || '').toLowerCase()] || 'azul'}${theme?.mode === 'light' ? ' th-light' : ''}`;
const ZONE_NAMES = { video: 'Vídeo do canal', playlist: 'Playlist', ticker: 'Texto rolante', clock: 'Relógio', weather: 'Clima', qr: 'QR code', logo: 'Logomarca', text: 'Texto', news: 'Notícias', quotes: 'Cotações', countdown: 'Contador', safety: 'Dias sem acidente', worldclock: 'Relógio mundial', queue: 'Senha' };
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
  const art = /^[a-z0-9-]{1,30}$/.test(String(f.art || '')) ? ` tvc-art tvc-art-${f.art}` : '';
  const theme = f.variant === 'light' || f.variant === 'dark' ? { ...(opts.theme || {}), mode: f.variant } : opts.theme;
  const n = h('div', `tvc-sl tvc-sl-${template || 'comunicado'} ${themeClass(theme)}${art}`);
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
    case 'seguranca':
      add(n, h('div', 'tvc-sl-body', h('div', 'tvc-sl-tag', 'SEGURANÇA'), title, f.text ? h('div', 'tvc-sl-x', f.text) : null, Array.isArray(f.lines) && lines.length ? h('ul', 'tvc-sl-list', lines.map((x) => h('li', '', x))) : null), qr);
      break;
    default: // comunicado, vaga, qr, data-comemorativa
      add(n, h('div', 'tvc-sl-body', template === 'vaga' ? h('div', 'tvc-sl-tag', 'VAGA INTERNA') : null, title, f.area ? h('div', 'tvc-sl-x', f.area) : null, f.text ? h('div', 'tvc-sl-x', f.text) : null,
        f.until ? h('div', 'tvc-sl-x', `Inscrições até ${brDate(f.until)}`) : f.date ? h('div', 'tvc-sl-x', brDate(f.date)) : null), qr);
  }
  return n;
}

/* ------------------------------------------------------------------ itens da playlist */
/** Um item como o app desenha (o formato do contrato §4.1, itens com os dados já prontos). */
export function itemPreview(it = {}, opts = {}) {
  const th = themeClass(opts.theme);
  const box = (cls, ...kids) => h('div', `tvc-it ${cls} ${th}`, ...kids);
  switch (it.kind) {
    case 'image': {
      if (!it.url) return box('tvc-it-empty', 'Imagem');
      const img = h('img', 'tvc-it-img'); img.alt = it.caption || it.title || ''; img.src = it.url;
      return box('tvc-it-image', img, it.caption ? h('div', 'tvc-sl-cap', it.caption) : null);
    }
    case 'slide': return slidePreview(it.template, it.fields, { theme: opts.theme, image: it.image || null });
    case 'post': return slidePreview(it.category === 'vaga' ? 'vaga' : it.category === 'seguranca' ? 'seguranca' : 'comunicado', { title: it.title, text: it.body ?? it.text, qr: it.qr }, { theme: opts.theme, image: typeof it.image === 'string' ? it.image : it.image?.url || null });
    case 'text': return box('tvc-it-text', it.title ? h('div', 'tvc-it-t', it.title) : null, h('div', 'tvc-it-x', it.text || ''));
    case 'birthdays': {
      const ppl = (it.people || []).slice(0, 8);
      return box('tvc-it-bday', h('div', 'tvc-it-t', it.title || 'Aniversariantes'),
        ppl.length ? h('ul', 'tvc-it-list tvc-it-people', ppl.map((p) => {
          // a foto (só com a autorização) ou as iniciais num círculo, como na TV
          let av;
          if (p.photo) { av = h('img', 'tvc-av'); av.src = p.photo; av.alt = ''; } else av = h('span', 'tvc-av tvc-av-ini', String(p.name || '').split(/s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase());
          return h('li', '', av, h('span', '', h('b', '', p.name), ` · ${pad2(p.day)}/${pad2(p.month)}${p.sector ? ` · ${p.sector}` : ''}`));
        })) : h('div', 'tvc-it-x', 'Ninguém faz aniversário nestes dias'));
    }
    case 'kpi': return box(`tvc-it-kpi b-${it.band || 'none'}`, h('div', 'tvc-it-t', it.name || 'Indicador'), h('div', 'tvc-it-big', `${numText(it.value)}${it.unit ? ` ${it.unit}` : ''}`),
      it.target != null ? h('div', 'tvc-it-x', `Meta: ${numText(it.target)}${it.unit ? ` ${it.unit}` : ''}`) : null, it.target != null ? goalBar(it.value, it.target, it.band) : null);
    case 'news': {
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
      const tg = typeof it.target === 'number' ? (() => { const x = new Date(it.target); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; })() : String(it.target ?? it.date ?? '').slice(0, 10);
      const d = daysUntil(tg);
      return box('tvc-it-count', h('div', 'tvc-it-t', it.title || 'Contagem regressiva'), h('div', 'tvc-it-big', d == null ? '—' : String(d)), h('div', 'tvc-it-x', `${d === 1 ? 'dia' : 'dias'}${it.text ? ` · ${it.text}` : ''}`));
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
    default: return box('tvc-it-empty', it.title || 'Item');
  }
}

/* ------------------------------------------------------------------ zonas */
function zoneContent(zone, opts) {
  const it = opts.items?.[zone.id];
  const th = themeClass(opts.theme);
  switch (zone.kind) {
    case 'video': return h('div', 'tvc-z-video', h('span', 'tvc-live', 'AO VIVO'), h('span', 'tvc-z-vt', opts.channel || 'Vídeo do canal'));
    case 'playlist': return it ? itemPreview(it, opts) : h('div', `tvc-z-empty ${th}`, 'Playlist');
    case 'ticker': {
      const t = (opts.ticker || []).filter(Boolean);
      return h('div', `tvc-z-ticker ${th}`, h('b', '', 'AVISOS'), h('span', '', t.length ? t.join('  ·  ') : 'Texto rolante'));
    }
    case 'clock': return h('div', `tvc-z-clock ${th}`, h('b', '', opts.clock || nowClock()), h('span', '', opts.date || new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })));
    case 'weather': return h('div', `tvc-z-weather ${th}`, h('b', '', '27°'), h('span', '', opts.city || 'Clima da unidade'));
    case 'qr': return h('div', `tvc-z-qr ${th}`, opts.qr ? qrSvg(opts.qr, 'tvc-z-qrc') : h('div', 'tvc-z-qrph'), h('span', '', opts.qrLabel || 'Aponte a câmera'));
    case 'logo': return h('div', `tvc-z-logo ${th}`, opts.logo ? Object.assign(h('img', ''), { alt: 'Logomarca', src: opts.logo }) : h('span', '', opts.brand || 'Logomarca'));
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
export function layoutPreview(layout = {}, opts = {}) {
  const fr = frameOf(layout.orientation);
  const wrap = h('div', `tvc-previa ${layout.orientation === 'port' ? 'port' : 'land'}`);
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `Prévia do layout${layout.name ? ` ${layout.name}` : ''}: ${(layout.zones || []).map((z) => ZONE_NAMES[z.kind] || z.kind).join(', ')}`);
  const svg = s('svg', { class: 'tvc-svg', viewBox: `0 0 ${fr.w} ${fr.h}`, preserveAspectRatio: 'xMidYMid meet' });
  svg.append(s('rect', { class: `tvc-bg ${themeClass(opts.theme)}`, x: 0, y: 0, width: fr.w, height: fr.h }));
  for (const zone of layout.zones || []) {
    const x = (zone.x / 100) * fr.w; const y = (zone.y / 100) * fr.h; const w = (zone.w / 100) * fr.w; const hh = (zone.h / 100) * fr.h;
    const g = s('g', { class: `tvc-zone k-${zone.kind}${opts.selected === zone.id ? ' sel' : ''}`, 'data-zone': zone.id });
    const fo = s('foreignObject', { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: hh.toFixed(2) });
    fo.append(h('div', 'tvc-z', zoneContent(zone, opts)));
    g.append(fo, s('rect', { class: 'tvc-zb', x: (x + 0.3).toFixed(2), y: (y + 0.3).toFixed(2), width: Math.max(0, w - 0.6).toFixed(2), height: Math.max(0, hh - 0.6).toFixed(2), rx: 0.8 }));
    if (opts.labels) {
      const t = s('text', { class: 'tvc-zl', x: (x + 1.5).toFixed(2), y: (y + 4.2).toFixed(2) });
      t.textContent = `${zone.id} · ${ZONE_NAMES[zone.kind] || zone.kind}`;
      g.append(t);
    }
    if (opts.onZone) { g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.addEventListener('click', () => opts.onZone(zone.id)); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onZone(zone.id); } }); }
    svg.append(g);
  }
  wrap.append(svg);
  return wrap;
}
/** A prévia com a legenda embaixo. */
export const layoutFigure = (layout, opts = {}, caption = '') => h('figure', 'tvc-fig', layoutPreview(layout, opts), caption ? h('figcaption', '', caption) : null);
