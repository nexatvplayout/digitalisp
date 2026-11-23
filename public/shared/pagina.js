// DIGITAL ISP · o construtor de páginas (aba Mídias, "Nova página"): telas, avisos e comunicados com fundo de cor, degradê ou
// foto e blocos de texto formatados (cor, negrito, itálico, sublinhado, fonte, tamanho, alinhamento, espaço entre linhas,
// caixa ou marca-texto atrás), ícone, etiqueta, imagem da biblioteca, logomarca e QR code.
//
// A página é desenhada num <canvas> do tamanho da TV (1920×1080 deitada ou 1080×1920 em pé) e vai ao servidor como um JPEG
// comum (POST /api/tvcorp/media/image): as TVs (Tizen, webOS, Android) mostram a página como qualquer imagem, sem mudar nada.
// O desenho fica guardado em fields.page da mídia (PATCH /api/tvcorp/media/:id { page }), para abrir e editar de novo.
// O servidor usa cleanPage para conferir o que guarda; o painel usa o resto. Cada linha do texto aceita a marca de estilo da
// faixa de avisos no começo ("{c=#ff3b30;b;i} texto", public/shared/faixa.js): a cor, o negrito e o itálico só daquela linha.
import { parseAvisoStyle } from './faixa.js';
import { encodeQr } from './qr.js';

export const PAGE_SIZE = Object.freeze({ land: Object.freeze([1920, 1080]), port: Object.freeze([1080, 1920]) });
export const PAGE_LIMITS = Object.freeze({ blocks: 24, text: 800, qr: 600, sizeMin: 12, sizeMax: 400 });

export const PAGE_FONTS = Object.freeze([
  { key: 'sans', label: 'Padrão (sem serifa)', css: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  { key: 'moderna', label: 'Moderna', css: '"Segoe UI", system-ui, Roboto, Arial, sans-serif' },
  { key: 'larga', label: 'Larga (Verdana)', css: 'Verdana, Tahoma, Geneva, sans-serif' },
  { key: 'arredondada', label: 'Arredondada', css: '"Trebuchet MS", "Segoe UI", Arial, sans-serif' },
  { key: 'condensada', label: 'Condensada', css: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif' },
  { key: 'impacto', label: 'Impacto (grossa)', css: 'Impact, "Arial Black", "Franklin Gothic Medium", sans-serif' },
  { key: 'serif', label: 'Com serifa (Georgia)', css: 'Georgia, "Times New Roman", serif' },
  { key: 'classica', label: 'Clássica (Times)', css: '"Times New Roman", Times, serif' },
  { key: 'elegante', label: 'Elegante', css: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif' },
  { key: 'manuscrita', label: 'Manuscrita', css: '"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive' },
  { key: 'divertida', label: 'Divertida', css: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive' },
  { key: 'mono', label: 'Máquina de escrever', css: '"Courier New", Consolas, monospace' },
]);
const FONT = new Map(PAGE_FONTS.map((f) => [f.key, f.css]));
const EMOJI_CSS = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

export const PAGE_BLOCKS = Object.freeze([
  { type: 'title', label: 'Título' }, { type: 'text', label: 'Parágrafo' }, { type: 'notice', label: 'Aviso (caixa)' },
  { type: 'label', label: 'Etiqueta' }, { type: 'icon', label: 'Ícone' }, { type: 'image', label: 'Imagem' },
  { type: 'logo', label: 'Logomarca' }, { type: 'qr', label: 'QR code' },
]);
const TYPES = new Set(PAGE_BLOCKS.map((b) => b.type));
export const TEXT_TYPES = new Set(['title', 'text', 'notice', 'label']);
export const PAGE_ICONS = Object.freeze(['⚠️', '📢', 'ℹ️', '✅', '❌', '🔔', '📅', '⏰', '🎉', '🎂', '🚧', '🔧', '💧', '⚡', '🚭', '♿', '🅿️', '🛗',
  '📞', '✉️', '❤️', '⭐', '🏆', '🍽️', '🧹', '🔒', '🚪', '🛒', '💲', '🌧️', '☀️', '🎄', '👋', '👏', '📍', '🔥']);
export const PAGE_ALIGNS = Object.freeze(['left', 'center', 'right']);
export const PAGE_BOXES = Object.freeze([{ key: 'none', label: 'Sem fundo' }, { key: 'box', label: 'Caixa atrás do bloco' }, { key: 'highlight', label: 'Marca-texto em cada linha' }]);
export const PAGE_BG = Object.freeze([{ key: 'solid', label: 'Cor sólida' }, { key: 'gradient', label: 'Degradê' }, { key: 'photo', label: 'Foto' }]);

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v, d) => (HEX.test(String(v ?? '')) ? String(v).toLowerCase() : d);
const num = (v, min, max, d, step = 1) => { const n = Number(v); if (v === '' || v == null || !Number.isFinite(n)) return d; return Math.min(max, Math.max(min, Math.round(n / step) * step)); };
const str = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').slice(0, max);
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const round1 = (n) => Math.round(n * 10) / 10;

/** Os valores de partida de cada bloco (o tamanho da letra em pixels da tela de 1920×1080 ou 1080×1920). */
export function newBlock(type, orient = 'land') {
  const port = orient === 'port';
  const base = { type, x: 8, y: 10, w: 84, text: '', font: 'sans', size: 56, color: '#ffffff', bold: false, italic: false, underline: false, align: 'center', lh: 1.25, shadow: false, box: 'none', boxColor: '#000000', boxAlpha: 60, radius: 24, pad: 32 };
  if (type === 'title') return { ...base, text: 'Título da página', size: port ? 110 : 120, bold: true, lh: 1.1 };
  if (type === 'text') return { ...base, y: 40, text: 'Escreva aqui o texto do aviso.\nCada linha nova começa embaixo.', size: port ? 56 : 52, lh: 1.35 };
  if (type === 'notice') return { ...base, x: 12, y: 62, w: 76, text: 'Aviso importante', size: port ? 64 : 58, bold: true, color: '#111111', box: 'box', boxColor: '#fde047', boxAlpha: 100, radius: 28, pad: 40 };
  if (type === 'label') return { ...base, x: 35, y: 4, w: 30, text: 'IMPORTANTE', size: 44, bold: true, box: 'box', boxColor: '#dc2626', boxAlpha: 100, radius: 60, pad: 20 };
  if (type === 'icon') return { ...base, x: 40, y: 4, w: 20, text: '⚠️', size: 180 };
  if (type === 'image') return { ...base, x: 30, y: 30, w: 40, media: null, radius: 16 };
  if (type === 'logo') return { ...base, x: port ? 30 : 78, y: port ? 86 : 82, w: port ? 40 : 18, radius: 0 };
  if (type === 'qr') return { ...base, x: port ? 34 : 82, y: port ? 70 : 62, w: port ? 32 : 14, qr: 'https://exemplo.com.br', color: '#000000', boxColor: '#ffffff', radius: 16 };
  return base;
}

/** Um bloco limpo (o que vier errado volta ao padrão do tipo); tipo desconhecido: null. */
function cleanBlock(b, orient) {
  if (!b || typeof b !== 'object' || !TYPES.has(b.type)) return null;
  const d = newBlock(b.type, orient);
  const out = {
    type: b.type, x: round1(num(b.x, -50, 100, d.x, 0.1)), y: round1(num(b.y, -50, 100, d.y, 0.1)), w: round1(num(b.w, 2, 100, d.w, 0.1)),
    text: str(b.text ?? d.text, PAGE_LIMITS.text), font: FONT.has(b.font) ? b.font : d.font, size: num(b.size, PAGE_LIMITS.sizeMin, PAGE_LIMITS.sizeMax, d.size),
    color: hex(b.color, d.color), bold: b.bold === undefined ? d.bold : Boolean(b.bold), italic: Boolean(b.italic), underline: Boolean(b.underline),
    align: PAGE_ALIGNS.includes(b.align) ? b.align : d.align, lh: num(b.lh, 0.8, 3, d.lh, 0.05), shadow: Boolean(b.shadow),
    box: PAGE_BOXES.some((x) => x.key === b.box) ? b.box : d.box, boxColor: hex(b.boxColor, d.boxColor), boxAlpha: num(b.boxAlpha, 0, 100, d.boxAlpha),
    radius: num(b.radius, 0, 200, d.radius), pad: num(b.pad, 0, 160, d.pad),
  };
  out.lh = Math.round(out.lh * 100) / 100;
  if (b.type === 'icon') out.text = str(b.text, 16) || d.text;
  if (b.type === 'image') out.media = idOf(b.media);
  if (b.type === 'qr') out.qr = str(b.qr, PAGE_LIMITS.qr).replace(/\n/g, ' ').trim() || d.qr;
  return out;
}

/**
 * A página limpa, pronta para guardar: { v: 1, orient, bg: { type, color, color2, angle, media, art, veil, veilColor }, blocks }.
 * O que não for objeto: null (o servidor responde 400). Arte: só o nome (o painel confere com o catálogo).
 */
export function cleanPage(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const orient = v.orient === 'port' ? 'port' : 'land';
  const g = v.bg && typeof v.bg === 'object' ? v.bg : {};
  const bg = {
    type: PAGE_BG.some((x) => x.key === g.type) ? g.type : 'solid', color: hex(g.color, '#0b1e3a'), color2: hex(g.color2, '#1d4ed8'),
    angle: num(g.angle, 0, 359, 135), media: idOf(g.media), art: /^[a-z0-9-]{1,40}$/.test(String(g.art || '')) ? String(g.art) : null,
    veil: num(g.veil, 0, 90, 35), veilColor: hex(g.veilColor, '#000000'),
  };
  const blocks = (Array.isArray(v.blocks) ? v.blocks : []).slice(0, PAGE_LIMITS.blocks).map((b) => cleanBlock(b, orient)).filter(Boolean);
  return { v: 1, orient, bg, blocks };
}

/** As imagens que a página usa, com a chave do mapa de imagens do desenho: m:<id> (biblioteca), a:<arte>, logo. */
export function pageAssets(p) {
  const out = new Set();
  if (p?.bg?.type === 'photo') { if (p.bg.media) out.add(`m:${p.bg.media}`); else if (p.bg.art) out.add(`a:${p.bg.art}`); }
  for (const b of p?.blocks || []) { if (b.type === 'image' && b.media) out.add(`m:${b.media}`); if (b.type === 'logo') out.add('logo'); }
  return [...out];
}

/* ------------------------------------------------------------------ o desenho */
const rgba = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${Math.max(0, Math.min(1, a))})`;
export const fontOf = (f) => `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${Math.round(f.size)}px ${FONT.get(f.font) || FONT.get('sans')}`;
function rr(ctx, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.arcTo(x + w, y, x + w, y + k, k); ctx.lineTo(x + w, y + h - k); ctx.arcTo(x + w, y + h, x + w - k, y + h, k);
  ctx.lineTo(x + k, y + h); ctx.arcTo(x, y + h, x, y + h - k, k); ctx.lineTo(x, y + k); ctx.arcTo(x, y, x + k, y, k); ctx.closePath();
}
function cover(ctx, img, W, H) {
  const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.max(W / iw, H / ih); const w = iw * s; const h = ih * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

/** As linhas do bloco de texto, quebradas na largura: [{ text, fmt }]. A marca "{c=…;b;i}" no começo da linha vale só nela. */
export function wrapText(ctx, b, maxW) {
  const out = [];
  for (const raw of String(b.text || '').split('\n')) {
    const st = parseAvisoStyle(raw);
    const fmt = { ...b, color: st.color || b.color, bold: b.bold || Boolean(st.bold), italic: b.italic || Boolean(st.italic) };
    ctx.font = fontOf(fmt);
    let cur = '';
    for (const w of st.text.split(/ +/)) {
      const t = cur ? `${cur} ${w}` : w;
      if (!cur || ctx.measureText(t).width <= maxW) cur = t;
      else { out.push({ text: cur, fmt }); cur = w; }
    }
    out.push({ text: cur, fmt });
  }
  return out;
}

function drawText(ctx, b, x0, y0, bw) {
  const pad = b.box === 'box' ? b.pad : 0;
  const lines = wrapText(ctx, b, Math.max(10, bw - 2 * pad));
  const lh = b.size * b.lh;
  const h = lines.length * lh + 2 * pad;
  if (b.box === 'box' && b.boxAlpha > 0) { ctx.fillStyle = rgba(b.boxColor, b.boxAlpha / 100); rr(ctx, x0, y0, bw, h, b.radius); ctx.fill(); }
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  lines.forEach((ln, i) => {
    ctx.font = fontOf(ln.fmt);
    const lw = ctx.measureText(ln.text).width;
    const tx = b.align === 'left' ? x0 + pad : b.align === 'right' ? x0 + bw - pad - lw : x0 + (bw - lw) / 2;
    const top = y0 + pad + i * lh;
    const base = top + lh / 2 + b.size * 0.35;
    if (b.box === 'highlight' && b.boxAlpha > 0 && ln.text) {
      const hh = b.size * 1.18; ctx.fillStyle = rgba(b.boxColor, b.boxAlpha / 100);
      rr(ctx, tx - b.size * 0.18, top + (lh - hh) / 2, lw + b.size * 0.36, hh, Math.min(b.radius, hh / 2)); ctx.fill();
    }
    ctx.save();
    if (b.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = b.size * 0.14; ctx.shadowOffsetY = b.size * 0.05; }
    ctx.fillStyle = ln.fmt.color;
    ctx.fillText(ln.text, tx, base);
    if (b.underline && ln.text) ctx.fillRect(tx, base + b.size * 0.1, lw, Math.max(2, b.size * 0.06));
    ctx.restore();
  });
  return h;
}

function drawPicture(ctx, img, b, x0, y0, bw, edit) {
  const iw = img?.naturalWidth || img?.width; const ih = img?.naturalHeight || img?.height;
  if (!iw || !ih) {
    const h = bw * 0.56;
    if (edit) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; rr(ctx, x0, y0, bw, h, 12); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.font = `${Math.max(18, Math.round(bw / 12))}px ${FONT.get('sans')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.type === 'logo' ? 'Logomarca (envie em Configurações)' : 'Escolha a imagem', x0 + bw / 2, y0 + h / 2); }
    return h;
  }
  const h = bw * (ih / iw);
  ctx.save(); rr(ctx, x0, y0, bw, h, b.radius); ctx.clip(); ctx.drawImage(img, x0, y0, bw, h); ctx.restore();
  return h;
}

function drawQr(ctx, b, x0, y0, bw) {
  let q; try { q = encodeQr(b.qr || 'https://exemplo.com.br', { ecl: 'M' }); } catch { q = null; }
  ctx.fillStyle = b.boxColor; rr(ctx, x0, y0, bw, bw, b.radius); ctx.fill();
  if (!q) return bw;
  const quiet = 2; const cell = bw / (q.size + quiet * 2);
  ctx.fillStyle = b.color;
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) ctx.fillRect(x0 + (x + quiet) * cell, y0 + (y + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
  return bw;
}

/**
 * Desenha a página no contexto 2D (do tamanho de PAGE_SIZE[orient]). imgs: Map da chave (pageAssets) para a imagem carregada.
 * sel: o índice do bloco escolhido (a moldura tracejada e o canto de largura, só no editor; -1 = nada, como vai para a TV).
 * Devolve onde ficou cada bloco: [{ x, y, w, h }] em pixels da página.
 */
export function drawPage(ctx, page, { imgs = new Map(), sel = -1, edit = false } = {}) {
  const p = page; const [W, H] = PAGE_SIZE[p.orient] || PAGE_SIZE.land; const g = p.bg;
  ctx.save();
  ctx.fillStyle = g.color; ctx.fillRect(0, 0, W, H);
  if (g.type === 'gradient') {
    const a = (g.angle * Math.PI) / 180; const r = (Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a))) / 2;
    const dx = Math.sin(a) * r; const dy = -Math.cos(a) * r;
    const gr = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    gr.addColorStop(0, g.color); gr.addColorStop(1, g.color2);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  } else if (g.type === 'photo') {
    const img = imgs.get(g.media ? `m:${g.media}` : `a:${g.art}`);
    if (img) cover(ctx, img, W, H);
    if (g.veil > 0) { ctx.fillStyle = rgba(g.veilColor, g.veil / 100); ctx.fillRect(0, 0, W, H); }
  }
  const rects = p.blocks.map((b) => {
    const x0 = (b.x / 100) * W; const y0 = (b.y / 100) * H; const bw = (b.w / 100) * W;
    let h;
    if (TEXT_TYPES.has(b.type)) h = drawText(ctx, b, x0, y0, bw);
    else if (b.type === 'icon') {
      const lh = b.size * 1.2;
      ctx.font = `${Math.round(b.size)}px ${EMOJI_CSS}`; ctx.textBaseline = 'middle'; ctx.fillStyle = b.color;
      ctx.textAlign = b.align; ctx.fillText(b.text, b.align === 'left' ? x0 : b.align === 'right' ? x0 + bw : x0 + bw / 2, y0 + lh / 2);
      h = lh;
    } else if (b.type === 'image') h = drawPicture(ctx, imgs.get(`m:${b.media}`), b, x0, y0, bw, edit);
    else if (b.type === 'logo') h = drawPicture(ctx, imgs.get('logo'), b, x0, y0, bw, edit);
    else h = drawQr(ctx, b, x0, y0, bw);
    return { x: x0, y: y0, w: bw, h };
  });
  const r = rects[sel];
  if (r) {
    const t = Math.max(3, W / 480);
    ctx.lineWidth = t; ctx.setLineDash?.([t * 4, t * 3]); ctx.strokeStyle = '#38bdf8'; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash?.([]); ctx.fillStyle = '#38bdf8'; ctx.fillRect(r.x + r.w - t * 6, r.y + r.h - t * 6, t * 12, t * 12);
  }
  ctx.restore();
  return rects;
}

/* ------------------------------------------------------------------ os modelos de partida */
const B = (type, orient, o) => ({ ...newBlock(type, orient), ...o });
const P = (orient, bg, blocks) => cleanPage({ orient, bg, blocks: blocks.map(([t, o]) => B(t, orient, o)) });
export const PAGE_PRESETS = Object.freeze([
  { key: 'branco-land', label: 'Em branco (deitada)', page: () => P('land', { type: 'solid', color: '#0b1e3a' }, [['title', {}]]) },
  { key: 'branco-port', label: 'Em branco (em pé)', page: () => P('port', { type: 'solid', color: '#0b1e3a' }, [['title', {}]]) },
  { key: 'aviso', label: 'Aviso importante', page: () => P('land', { type: 'gradient', color: '#7f1d1d', color2: '#dc2626', angle: 135 }, [
    ['icon', { x: 40, y: 6, w: 20, size: 170 }], ['title', { y: 30, text: 'Aviso importante', size: 130, shadow: true }],
    ['text', { y: 50, x: 10, w: 80, text: 'Amanhã, das 8h às 12h, não haverá água no prédio\npara a limpeza da caixa d\'água.', size: 58 }],
    ['notice', { x: 25, y: 76, w: 50, text: 'Obrigado pela compreensão', boxColor: '#ffffff', color: '#7f1d1d', size: 50, pad: 28 }]]) },
  { key: 'comunicado', label: 'Comunicado', page: () => P('land', { type: 'solid', color: '#0f172a' }, [
    ['label', { x: 8, y: 9, w: 26, text: 'COMUNICADO', boxColor: '#2563eb', size: 40, align: 'center' }],
    ['title', { x: 8, y: 22, w: 84, text: 'Novo horário de atendimento', align: 'left', size: 110 }],
    ['text', { x: 8, y: 46, w: 70, align: 'left', text: 'A partir de segunda-feira, o atendimento passa a ser\nde segunda a sexta, das 8h às 18h.\n{c=#fde047;b} Aos sábados, das 8h às 12h.', size: 56, lh: 1.45 }],
    ['logo', {}]]) },
  { key: 'sindico', label: 'Aviso do síndico (em pé)', page: () => P('port', { type: 'solid', color: '#eef2f7' }, [
    ['label', { x: 20, y: 5, w: 60, text: 'AVISO DO SÍNDICO', boxColor: '#1d4ed8', size: 50 }],
    ['icon', { x: 35, y: 12, w: 30, text: '📢', size: 200 }],
    ['title', { x: 4, w: 92, y: 27, text: 'Assembleia geral', color: '#0f172a', size: 100 }],
    ['text', { y: 36, text: 'Quinta-feira, às 19h30,\nno salão de festas.\n\nPauta: prestação de contas\ne eleição do síndico.', color: '#1e293b', size: 64, lh: 1.4 }],
    ['notice', { x: 10, y: 66, w: 80, text: 'Sua presença é importante!', boxColor: '#fde047', size: 60 }],
    ['qr', { x: 36, y: 79, w: 28 }]]) },
  { key: 'manutencao', label: 'Elevador em manutenção (em pé)', page: () => P('port', { type: 'gradient', color: '#facc15', color2: '#f59e0b', angle: 180 }, [
    ['icon', { x: 30, y: 8, w: 40, text: '🚧', size: 260 }],
    ['title', { y: 28, text: 'Elevador em manutenção', color: '#111111', size: 120 }],
    ['text', { y: 50, text: 'Hoje, das 9h às 11h.\nUse o elevador de serviço.', color: '#111111', size: 70, lh: 1.4 }],
    ['notice', { x: 10, y: 72, w: 80, text: 'Desculpe o transtorno', boxColor: '#111111', color: '#facc15', size: 64 }]]) },
  { key: 'boas-vindas', label: 'Boas-vindas', page: () => P('land', { type: 'gradient', color: '#4c1d95', color2: '#0ea5e9', angle: 120 }, [
    ['icon', { x: 42, y: 10, w: 16, text: '👋', size: 160 }], ['title', { y: 34, text: 'Seja bem-vindo!', size: 150, font: 'arredondada', shadow: true }],
    ['text', { y: 58, x: 15, w: 70, text: 'Que bom ter você aqui. Fique à vontade!', size: 62, italic: true }], ['logo', { x: 41, y: 76, w: 18 }]]) },
  { key: 'evento', label: 'Evento com QR', page: () => P('land', { type: 'gradient', color: '#0f766e', color2: '#14b8a6', angle: 90 }, [
    ['label', { x: 6, y: 10, w: 24, text: 'EVENTO', boxColor: '#f97316', size: 42 }],
    ['title', { x: 6, y: 22, w: 64, align: 'left', text: 'Festa de fim de ano', size: 120, font: 'impacto' }],
    ['text', { x: 6, y: 52, w: 60, align: 'left', text: '📅 Sexta, 19/12, às 19h\n📍 Área de lazer\nTraga um prato para compartilhar.', size: 56, lh: 1.5 }],
    ['qr', { x: 74, y: 28, w: 20 }], ['text', { x: 70, y: 66, w: 28, text: 'Confirme pelo QR', size: 40, bold: true }]]) },
  { key: 'promo', label: 'Promoção', page: () => P('land', { type: 'solid', color: '#111827' }, [
    ['label', { x: 6, y: 10, w: 22, text: 'OFERTA', boxColor: '#dc2626', size: 46 }],
    ['title', { x: 6, y: 24, w: 55, align: 'left', text: 'Plano 500 mega', size: 120 }],
    ['text', { x: 6, y: 50, w: 55, align: 'left', text: 'Instalação grátis e Wi-Fi incluso.', size: 54 }],
    ['notice', { x: 6, y: 66, w: 40, align: 'center', text: 'R$ 99,90 por mês', boxColor: '#22c55e', color: '#ffffff', size: 70, pad: 30 }],
    ['image', { x: 64, y: 18, w: 30 }]]) },
]);
export const PAGE_PRESET = Object.freeze(Object.fromEntries(PAGE_PRESETS.map((p) => [p.key, p])));
