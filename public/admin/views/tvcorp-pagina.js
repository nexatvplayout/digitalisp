// TV Corporativa · o construtor de páginas (aba Mídias, "Nova página"): telas, avisos e comunicados com fundo de cor, degradê
// ou foto e blocos (título, parágrafo, aviso com caixa, etiqueta, ícone, imagem, logomarca e QR code), cada um com cor,
// negrito, itálico, sublinhado, fonte, tamanho, alinhamento, espaço entre linhas, sombra e caixa ou marca-texto atrás.
// A prévia é o próprio desenho no tamanho da TV (1920×1080 ou 1080×1920, public/shared/pagina.js); arrastar o bloco na
// prévia muda o lugar e o canto muda a largura. Salvar grava o JPEG como imagem da biblioteca (POST /api/tvcorp/media/image,
// ou PUT /media/:id/image ao editar) e o desenho em fields.page (PATCH /media/:id { page }), para editar de novo.
import { el, guard, toast, tapi, tupload, tblob, put, f, opt, label, note, btn, dialog, D, T, listOf } from './tvcorp-base.js';
import { LIMITS, ARTS } from './tvcorp-catalogo.js';
import {
  PAGE_SIZE, PAGE_FONTS, PAGE_BLOCKS, PAGE_ICONS, PAGE_BOXES, PAGE_BG, PAGE_PRESETS, PAGE_PRESET, TEXT_TYPES, PAGE_LIMITS,
  cleanPage, newBlock, drawPage, pageAssets,
} from '../../shared/pagina.js';

const TYPE_LABEL = Object.fromEntries(PAGE_BLOCKS.map((b) => [b.type, b.label]));
const ALIGN = [['left', 'Esquerda', '⯇'], ['center', 'Centro', '≡'], ['right', 'Direita', '⯈']];
const ANGLES = [[90, 'Da esquerda para a direita'], [180, 'De cima para baixo'], [135, 'Na diagonal ↘'], [45, 'Na diagonal ↗'], [270, 'Da direita para a esquerda'], [0, 'De baixo para cima']];
const LH = [0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2, 2.5];
const blockName = (b) => `${TYPE_LABEL[b.type] || b.type}${TEXT_TYPES.has(b.type) && b.text ? `: ${b.text.replace(/\{[^{}]*\}\s?/g, '').split('\n')[0].slice(0, 28)}` : b.type === 'icon' ? ` ${b.text}` : ''}`;

/** O desenho da mídia (fields.page) ou null se a imagem não veio do construtor. */
export const pageOf = (m) => (m?.kind === 'image' && m.fields?.page ? cleanPage(m.fields.page) : null);

/** As imagens da página (biblioteca, arte do catálogo e logomarca), carregadas uma vez; redraw() quando cada uma chega. */
function assetLoader(redraw) {
  const imgs = new Map(); const asked = new Set();
  const load = (key, url) => {
    if (!url) return;
    const img = document.createElement('img');
    img.onload = () => { imgs.set(key, img); redraw(); };
    img.src = url;
  };
  return {
    imgs,
    need(page) {
      for (const key of pageAssets(page)) {
        if (asked.has(key)) continue;
        asked.add(key);
        if (key === 'logo') tblob('/api/tvcorp/settings/logo').then((u) => load(key, u), () => {});
        else if (key.startsWith('m:')) tblob(`/api/tvcorp/media/${Number(key.slice(2))}/file`).then((u) => load(key, u), () => {});
        else { const a = ARTS.find((x) => x.key === key.slice(2)); if (a) load(key, `/tvcorp/arte/${a.key}.${a.photo ? 'jpg' : 'svg'}`); }
      }
    },
  };
}

/** O JPEG da página, sem a moldura do editor. */
function toJpeg(page, imgs) {
  const [W, H] = PAGE_SIZE[page.orient];
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext?.('2d');
  if (!ctx || !cv.toBlob) return Promise.reject(new Error('Este navegador não consegue desenhar a página. Use o Chrome, o Edge ou o Firefox.'));
  drawPage(ctx, page, { imgs });
  return new Promise((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error('Não deu para gerar a imagem da página.'))), 'image/jpeg', 0.92));
}

/**
 * O construtor. m: a mídia que já existe (imagem com fields.page) ou null. images: as imagens da biblioteca. onSaved(): depois
 * de gravar. preset: a chave do modelo de partida (PAGE_PRESETS) quando é nova.
 */
export function pageBuilder(m, images, onSaved, { preset = 'aviso' } = {}) {
  const st = { page: pageOf(m) || (PAGE_PRESET[preset] || PAGE_PRESETS[0]).page(), sel: 0, rects: [] };
  const firstText = () => Math.max(0, st.page.blocks.findIndex((b) => TEXT_TYPES.has(b.type)));
  st.sel = firstText(); // abre no primeiro texto: os botões de formatação já aparecem
  const pics = images.filter((i) => i.id !== m?.id && !i.fields?.page);
  const qrs = []; // os QR codes do menu QR Codes (o link curto conta as leituras)
  const cv = el('canvas', { class: 'tc-pg-cv', width: '1920', height: '1080', 'aria-label': 'Prévia da página no tamanho da TV' });
  const ctx = cv.getContext?.('2d');
  const assets = assetLoader(() => redraw());
  function redraw() {
    const [W, H] = PAGE_SIZE[st.page.orient];
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    cv.classList.toggle('port', st.page.orient === 'port');
    assets.need(st.page);
    if (ctx) st.rects = drawPage(ctx, st.page, { imgs: assets.imgs, sel: st.sel, edit: true });
    sizeTxt.textContent = `${W}×${H} · ${st.page.orient === 'port' ? 'em pé' : 'deitada'}`;
  }
  const sizeTxt = el('span', { class: 'dim small' });

  /* ---- o formato, o modelo e o fundo */
  const orient = el('select', { 'aria-label': 'Formato da tela', onchange: () => { st.page.orient = orient.value; redraw(); } },
    opt('land', 'Deitada · 1920×1080', st.page.orient === 'land'), opt('port', 'Em pé · 1080×1920', st.page.orient === 'port'));
  const start = el('select', { 'aria-label': 'Começar de um modelo', onchange: () => {
    const p = PAGE_PRESET[start.value]; start.value = '';
    if (!p || (st.page.blocks.length && !confirm(`Trocar a página pelo modelo "${p.label}"? O que está aqui some.`))) return;
    st.page = p.page(); st.sel = firstText(); orient.value = st.page.orient; paintBg(); paintList(); paintProps(); redraw();
  } }, opt('', 'Começar de um modelo…', true), ...PAGE_PRESETS.map((p) => opt(p.key, p.label)));

  const bgBox = el('div', { class: 'pf-grid' });
  const color = (value, aria, on) => el('input', { type: 'color', value, 'aria-label': aria, oninput: (e) => { on(e.target.value); redraw(); } });
  const range = (value, min, max, aria, on, step = 1) => el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': aria, oninput: (e) => { on(Number(e.target.value)); redraw(); } });
  function paintBg() {
    const g = st.page.bg;
    const type = el('select', { 'aria-label': 'Tipo de fundo', onchange: () => { g.type = type.value; if (g.type === 'photo' && !g.media && !g.art) g.art = ARTS.find((a) => a.photo)?.key || null; paintBg(); redraw(); } },
      ...PAGE_BG.map((b) => opt(b.key, b.label, g.type === b.key)));
    const rows = [f('Fundo', type)];
    if (g.type !== 'photo') rows.push(el('div', { class: 'pf-grid two' }, f(g.type === 'gradient' ? 'Cor do começo' : 'Cor', color(g.color, 'Cor do fundo', (v) => { g.color = v; })),
      g.type === 'gradient' ? f('Cor do fim', color(g.color2, 'Cor do fim do degradê', (v) => { g.color2 = v; })) : null));
    if (g.type === 'gradient') rows.push(f('Direção', el('select', { 'aria-label': 'Direção do degradê', onchange: (e) => { g.angle = Number(e.target.value); redraw(); } }, ...ANGLES.map(([a, t]) => opt(a, t, g.angle === a)))));
    if (g.type === 'photo') {
      const cur = g.media ? `m${g.media}` : g.art ? `a${g.art}` : '';
      const src = el('select', { 'aria-label': 'Foto do fundo', onchange: () => { const v = src.value; g.media = v.startsWith('m') ? Number(v.slice(1)) : null; g.art = v.startsWith('a') ? v.slice(1) : null; redraw(); } },
        opt('', 'Escolha a foto', !cur),
        pics.length ? el('optgroup', { label: 'Da biblioteca' }, ...pics.map((i) => opt(`m${i.id}`, i.title, cur === `m${i.id}`))) : null,
        el('optgroup', { label: 'Do catálogo' }, ...ARTS.map((a) => opt(`a${a.key}`, a.label, cur === `a${a.key}`))));
      rows.push(f('Foto', src, 'A foto cobre a tela inteira (as sobras saem). Para usar uma foto sua, envie primeiro na biblioteca.'),
        el('div', { class: 'pf-grid two' }, f('Véu sobre a foto', range(g.veil, 0, 90, 'Véu sobre a foto', (v) => { g.veil = v; }), 'Escurece a foto para o texto aparecer.'), f('Cor do véu', color(g.veilColor, 'Cor do véu', (v) => { g.veilColor = v; }))));
    }
    put(bgBox, ...rows);
  }

  /* ---- os blocos */
  const listBox = el('div', { class: 'tc-pg-list' });
  const propsBox = el('div', { class: 'pf-grid tc-pg-props' });
  const select = (i) => { st.sel = i; paintList(); paintProps(); redraw(); };
  function paintList() {
    const bl = st.page.blocks;
    put(listBox, bl.length ? bl.map((b, i) => el('button', { type: 'button', class: `tc-pg-item${i === st.sel ? ' on' : ''}`, 'aria-pressed': String(i === st.sel), onclick: () => select(i) }, blockName(b)))
      : note('A página está sem blocos. Use os botões acima para pôr título, texto, aviso…'));
  }
  const move = (d) => { const bl = st.page.blocks; const i = st.sel; const j = i + d; if (!bl[i] || !bl[j]) return; [bl[i], bl[j]] = [bl[j], bl[i]]; select(j); };
  const tools = el('div', { class: 'pf-btns left' },
    btn('Para a frente', () => move(1), 'small'), btn('Para trás', () => move(-1), 'small'),
    btn('Duplicar', () => { const b = st.page.blocks[st.sel]; if (!b || st.page.blocks.length >= PAGE_LIMITS.blocks) return; st.page.blocks.push({ ...b, y: Math.min(95, b.y + 4) }); select(st.page.blocks.length - 1); }, 'small'),
    btn('Remover', () => { if (!st.page.blocks[st.sel]) return; st.page.blocks.splice(st.sel, 1); select(Math.min(st.sel, st.page.blocks.length - 1)); }, 'small danger'));
  const adders = el('div', { class: 'pf-btns left tc-pg-add' }, ...PAGE_BLOCKS.map((b) => btn(`+ ${b.label}`, () => {
    if (st.page.blocks.length >= PAGE_LIMITS.blocks) { toast(`No máximo ${PAGE_LIMITS.blocks} blocos por página.`, true); return; }
    const nb = newBlock(b.type, st.page.orient);
    if (b.type === 'image' && pics[0]) nb.media = pics[0].id;
    if (b.type === 'qr' && qrs[0]) nb.qr = qrs[0].link;
    st.page.blocks.push(nb); select(st.page.blocks.length - 1);
  }, 'small')));

  function paintProps() {
    const b = st.page.blocks[st.sel];
    if (!b) { put(propsBox, note('Escolha um bloco na lista ou clique nele na prévia.')); return; }
    const set = (k, v) => { b[k] = v; redraw(); };
    const numIn = (k, min, max, aria, step = 1) => el('input', { type: 'number', min: String(min), max: String(max), step: String(step), value: String(b[k]), 'aria-label': aria, class: 'tc-num-in', onchange: (e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set(k, Math.min(max, Math.max(min, n))); } });
    const toggle = (k, text, aria, cls) => { const t = el('button', { type: 'button', class: `btn small tc-pg-tg ${cls}${b[k] ? ' on' : ''}`, 'aria-pressed': String(Boolean(b[k])), 'aria-label': aria, title: aria, onclick: () => { set(k, !b[k]); t.classList.toggle('on', b[k]); t.setAttribute('aria-pressed', String(b[k])); } }, text); return t; };
    const alignBar = el('div', { class: 'tc-pg-bar', role: 'group', 'aria-label': 'Alinhamento' }, ...ALIGN.map(([a, t, s]) => el('button', { type: 'button', class: `btn small tc-pg-tg${b.align === a ? ' on' : ''}`, 'aria-pressed': String(b.align === a), title: t, 'aria-label': `Alinhar à ${t.toLowerCase()}`, onclick: () => { set('align', a); paintProps(); } }, s)));
    const pos = el('div', { class: 'pf-grid three' }, f('Da esquerda (%)', numIn('x', -50, 100, 'Posição da esquerda em %', 0.5)), f('Do alto (%)', numIn('y', -50, 100, 'Posição do alto em %', 0.5)), f('Largura (%)', numIn('w', 2, 100, 'Largura em %', 0.5)));
    const rows = [el('b', { text: TYPE_LABEL[b.type] })];
    if (TEXT_TYPES.has(b.type)) {
      const txt = el('textarea', { rows: b.type === 'text' ? '5' : '2', maxlength: String(PAGE_LIMITS.text), 'aria-label': 'Texto do bloco', oninput: (e) => { b.text = e.target.value; redraw(); paintList(); } });
      txt.value = b.text;
      const font = el('select', { 'aria-label': 'Fonte', onchange: (e) => set('font', e.target.value) }, ...PAGE_FONTS.map((x) => opt(x.key, x.label, b.font === x.key)));
      const lh = el('select', { 'aria-label': 'Espaço entre linhas', onchange: (e) => set('lh', Number(e.target.value)) }, ...[...new Set([...LH, b.lh])].sort((a, c) => a - c).map((v) => opt(v, String(v).replace('.', ','), b.lh === v)));
      const box = el('select', { 'aria-label': 'Fundo do texto', onchange: (e) => {
        // o marca-texto começa amarelo e cheio (o preto do padrão some num fundo escuro)
        if (e.target.value === 'highlight' && b.box === 'none' && b.boxColor === '#000000') { b.boxColor = '#fde047'; b.boxAlpha = 100; if (b.color === '#ffffff') b.color = '#111111'; }
        set('box', e.target.value); paintProps();
      } }, ...PAGE_BOXES.map((x) => opt(x.key, x.label, b.box === x.key)));
      rows.push(f('Texto', txt, 'Enter começa uma linha nova. Para mudar só uma linha, comece com {c=#ff0000;b;i} (cor, negrito, itálico).'),
        el('div', { class: 'tc-pg-bar', role: 'toolbar', 'aria-label': 'Formatação' }, toggle('bold', 'N', 'Negrito', 'b'), toggle('italic', 'I', 'Itálico', 'i'), toggle('underline', 'S', 'Sublinhado', 'u'),
          el('span', { class: 'tc-pg-sep' }), alignBar, el('span', { class: 'tc-pg-sep' }), el('label', { class: 'tc-pg-color', title: 'Cor da letra' }, el('span', { text: 'Cor' }), color(b.color, 'Cor da letra', (v) => { b.color = v; })), toggle('shadow', 'Sombra', 'Sombra atrás da letra', 's')),
        el('div', { class: 'pf-grid three' }, f('Fonte', font), f('Tamanho (px)', numIn('size', PAGE_LIMITS.sizeMin, PAGE_LIMITS.sizeMax, 'Tamanho da letra em pixels')), f('Entre linhas', lh)),
        f('Atrás do texto', box));
      if (b.box !== 'none') rows.push(el('div', { class: 'pf-grid two' }, f('Cor da caixa', color(b.boxColor, 'Cor da caixa', (v) => { b.boxColor = v; })), f('Opacidade', range(b.boxAlpha, 0, 100, 'Opacidade da caixa', (v) => { b.boxAlpha = v; }))),
        el('div', { class: 'pf-grid two' }, f('Cantos arredondados', range(b.radius, 0, 120, 'Cantos arredondados', (v) => { b.radius = v; })), b.box === 'box' ? f('Margem interna', range(b.pad, 0, 120, 'Margem interna', (v) => { b.pad = v; })) : null));
    } else if (b.type === 'icon') {
      rows.push(el('div', { class: 'tc-pg-icons', role: 'group', 'aria-label': 'Ícones' }, ...PAGE_ICONS.map((ic) => el('button', { type: 'button', class: `tc-pg-ic${b.text === ic ? ' on' : ''}`, 'aria-label': `Ícone ${ic}`, onclick: () => { set('text', ic); paintProps(); paintList(); } }, ic))),
        el('div', { class: 'pf-grid two' }, f('Tamanho (px)', numIn('size', PAGE_LIMITS.sizeMin, PAGE_LIMITS.sizeMax, 'Tamanho do ícone')), f('Alinhamento', alignBar)));
    } else if (b.type === 'image') {
      rows.push(f('Imagem', el('select', { 'aria-label': 'Imagem da biblioteca', onchange: (e) => set('media', Number(e.target.value) || null) }, opt('', pics.length ? 'Escolha a imagem' : 'Nenhuma imagem na biblioteca ainda', !b.media), ...pics.map((i) => opt(i.id, i.title, b.media === i.id))), 'A altura segue a proporção da imagem.'),
        f('Cantos arredondados', range(b.radius, 0, 200, 'Cantos arredondados', (v) => { b.radius = v; })));
    } else if (b.type === 'logo') {
      rows.push(note(D()?.settings?.logo ? 'A logomarca da empresa (Configurações). A altura segue a proporção dela.' : 'A empresa ainda não tem logomarca: envie em Configurações.'));
    } else if (b.type === 'qr') {
      const link = el('input', { type: 'text', maxlength: String(PAGE_LIMITS.qr), value: b.qr, 'aria-label': 'Endereço do QR code', placeholder: 'https://…', oninput: (e) => set('qr', e.target.value.trim()) });
      const mine = qrs.filter((q) => q.ativo !== false || q.link === b.qr);
      rows.push(mine.length ? f('QR do menu QR Codes', el('select', { 'aria-label': 'QR do menu QR Codes', onchange: (e) => { if (!e.target.value) return; link.value = e.target.value; set('qr', e.target.value); } },
        opt('', 'Escolher um QR do menu QR Codes…', !mine.some((q) => q.link === b.qr)), ...mine.map((q) => opt(q.link, `${q.nome} (${q.codigo})`, q.link === b.qr))), 'O link curto conta as leituras e o destino muda lá, sem refazer a página.') : null,
      f('Endereço ou texto do QR', link),
      el('div', { class: 'pf-grid two' }, f('Cor dos quadradinhos', color(b.color, 'Cor do QR', (v) => { b.color = v; })), f('Cor do fundo do QR', color(b.boxColor, 'Fundo do QR', (v) => { b.boxColor = v; }))),
      note('Deixe o QR escuro sobre fundo claro e com pelo menos 12% de largura: assim a câmera do celular lê de longe.'));
    }
    rows.push(pos);
    put(propsBox, ...rows);
  }

  /* ---- arrastar na prévia: o bloco muda de lugar; o canto de baixo à direita muda a largura */
  let drag = null;
  const at = (e) => { const r = cv.getBoundingClientRect(); const [W, H] = PAGE_SIZE[st.page.orient]; return [((e.clientX - r.left) / (r.width || 1)) * W, ((e.clientY - r.top) / (r.height || 1)) * H, W, H]; };
  cv.addEventListener('pointerdown', (e) => {
    const [x, y, W] = at(e);
    const grip = W / 480 * 10;
    let i = -1;
    for (let k = st.rects.length - 1; k >= 0; k--) { const r = st.rects[k]; if (x >= r.x - grip && x <= r.x + r.w + grip && y >= r.y - grip && y <= r.y + r.h + grip) { i = k; break; } }
    if (i < 0) return;
    const r = st.rects[i]; const b = st.page.blocks[i];
    drag = { i, x, y, bx: b.x, by: b.y, bw: b.w, size: Math.abs(x - (r.x + r.w)) < grip * 1.5 && Math.abs(y - (r.y + r.h)) < grip * 1.5 };
    cv.setPointerCapture?.(e.pointerId);
    if (st.sel !== i) select(i);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y, W, H] = at(e); const b = st.page.blocks[drag.i];
    const dx = ((x - drag.x) / W) * 100; const dy = ((y - drag.y) / H) * 100;
    if (drag.size) b.w = Math.round(Math.min(100, Math.max(2, drag.bw + dx)) * 2) / 2;
    else { b.x = Math.round(Math.min(100, Math.max(-50, drag.bx + dx)) * 2) / 2; b.y = Math.round(Math.min(100, Math.max(-50, drag.by + dy)) * 2) / 2; }
    redraw();
  });
  const drop = () => { if (drag) { drag = null; paintProps(); } };
  cv.addEventListener('pointerup', drop); cv.addEventListener('pointercancel', drop);

  /* ---- nome, tempo e dono */
  const title = el('input', { type: 'text', maxlength: String(LIMITS.name), value: m?.title || '', placeholder: 'Nome na biblioteca (só no painel)' });
  const seconds = el('input', { type: 'number', min: String(LIMITS.secondsMin), max: String(LIMITS.secondsMax), value: String(m?.seconds ?? 12) });
  const office = el('select', {}, opt('', 'Empresa toda', m?.officeId == null), ...(D()?.offices || []).map((o) => opt(o.id, o.name, m?.officeId === o.id)));
  const stage = el('div', { class: 'tc-pg-stage' }, cv);

  paintBg(); paintList(); paintProps(); redraw();
  if (!T.demo) tapi('/api/qrcodes').then((r) => { qrs.push(...listOf(r, 'qrcodes')); if (st.page.blocks[st.sel]?.type === 'qr') paintProps(); }, () => {});

  const { dlg } = dialog(m ? `Página · ${m.title}` : 'Nova página', el('div', { class: 'tc-pg' },
    el('div', { class: 'tc-pg-side' },
      el('div', { class: 'pf-grid two' }, f('Formato', orient), f('Modelo', start)),
      label('Fundo'), bgBox,
      label('Blocos'), adders, listBox, tools,
      label('Bloco escolhido'), propsBox,
      label('Na biblioteca'), el('div', { class: 'pf-grid two' }, f('Segundos na tela', seconds), f('De quem é', office)), f('Nome', title)),
    el('div', { class: 'tc-pg-main' },
      el('div', { class: 'tc-live-bar' }, sizeTxt, btn('Tela cheia', () => { stage.requestFullscreen?.(); }, 'small')),
      stage,
      note('A prévia é a página no tamanho da TV. Arraste um bloco para mudar de lugar; puxe o quadradinho do canto para mudar a largura. Ao salvar, a página vira uma imagem da biblioteca: ponha numa playlist (inclusive a das zonas "Aviso do síndico" e "avisos" dos layouts de elevador) e todas as TVs mostram igual.'))), {
    wide: true,
    saveLabel: m ? 'Salvar página' : 'Criar página',
    save: async () => {
      const page = cleanPage(st.page);
      if (!page.blocks.length) throw new Error('Ponha pelo menos um bloco na página.');
      const missing = page.blocks.find((b) => b.type === 'image' && !b.media);
      if (missing) throw new Error('Escolha a imagem do bloco de imagem (ou remova o bloco).');
      if (page.bg.type === 'photo' && !page.bg.media && !page.bg.art) throw new Error('Escolha a foto do fundo.');
      const jpg = await toJpeg(page, assets.imgs);
      const name = title.value.trim() || [...page.blocks].sort((a, c) => (c.type === 'title') - (a.type === 'title')).find((b) => TEXT_TYPES.has(b.type) && b.text)?.text.replace(/\{[^{}]*\}\s?/g, '').split('\n')[0].slice(0, LIMITS.name) || 'Página';
      const q = `orientation=${page.orient}&title=${encodeURIComponent(name)}`;
      let id = m?.id;
      if (m) await tupload(`/api/tvcorp/media/${m.id}/image?${q}`, jpg, { method: 'PUT', type: 'image/jpeg' });
      else id = (await tupload(`/api/tvcorp/media/image?${q}&seconds=${Number(seconds.value) || 12}${office.value ? `&officeId=${office.value}` : ''}`, jpg, { type: 'image/jpeg' }))?.id;
      if (id) await tapi(`/api/tvcorp/media/${id}`, { method: 'PATCH', body: { title: name, seconds: Number(seconds.value) || 12, officeId: office.value ? Number(office.value) : null, page } });
      toast(m ? 'Página salva. As telas trocam em até 1 minuto.' : 'Página criada. Ponha-a numa playlist para ir às telas.');
      await onSaved?.();
    },
  });
  dlg.classList.add('tc-lay-dlg', 'tc-pg-dlg');
  return { dlg, st };
}
