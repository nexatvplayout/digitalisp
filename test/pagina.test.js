// O construtor de páginas (public/shared/pagina.js): o que o servidor guarda (cleanPage) e o desenho no canvas (drawPage),
// conferido num contexto 2D de mentira que anota as chamadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPage, drawPage, wrapText, pageAssets, newBlock, PAGE_PRESETS, PAGE_BLOCKS, PAGE_LIMITS, fontOf } from '../public/shared/pagina.js';

function fakeCtx() {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const ctx = {
    calls, font: '', fillStyle: '', strokeStyle: '', textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1, shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    measureText(t) { const px = Number(/(\d+)px/.exec(this.font)?.[1] || 10); return { width: String(t).length * px * 0.5 }; },
    createLinearGradient: (...a) => { calls.push(['gradient', ...a]); return { addColorStop: rec('stop') }; },
    fillText(t, x, y) { calls.push(['fillText', t, x, y, this.font, this.fillStyle]); },
  };
  for (const n of ['save', 'restore', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'arcTo', 'closePath', 'fill', 'clip', 'drawImage', 'setLineDash']) ctx[n] ??= rec(n);
  return ctx;
}

test('cleanPage: o que vier errado volta ao padrão; nada de fora do formato entra', () => {
  assert.equal(cleanPage(null), null); assert.equal(cleanPage('x'), null); assert.equal(cleanPage([]), null);
  const p = cleanPage({ orient: 'port', bg: { type: 'video', color: 'red', angle: 999, media: '7', art: '../x' }, blocks: [
    { type: 'title', text: 'Oi\u0007\r\nmundo', size: 9999, color: '#ABCDEF', font: 'comic', align: 'justify', lh: 7, bold: 'sim', box: 'x', x: 500 },
    { type: 'script', text: 'não' }, { type: 'qr', qr: '' }, { type: 'image', media: -3 }, { type: 'icon', text: '' },
  ] });
  assert.equal(p.orient, 'port');
  assert.deepEqual(p.bg, { type: 'solid', color: '#0b1e3a', color2: '#1d4ed8', angle: 359, media: 7, art: null, veil: 35, veilColor: '#000000' });
  assert.equal(p.blocks.length, 4, 'o tipo desconhecido sai');
  const t = p.blocks[0];
  assert.equal(t.text, 'Oi\nmundo'); assert.equal(t.size, PAGE_LIMITS.sizeMax); assert.equal(t.color, '#abcdef'); assert.equal(t.font, 'sans');
  assert.equal(t.align, 'center'); assert.equal(t.lh, 3); assert.equal(t.bold, true); assert.equal(t.box, 'none'); assert.equal(t.x, 100);
  assert.equal(p.blocks[1].qr, 'https://exemplo.com.br'); assert.equal(p.blocks[2].media, null); assert.equal(p.blocks[3].text, '⚠️');
  const many = cleanPage({ blocks: Array.from({ length: 60 }, () => ({ type: 'text', text: 'x'.repeat(5000) })) });
  assert.equal(many.blocks.length, PAGE_LIMITS.blocks); assert.equal(many.blocks[0].text.length, PAGE_LIMITS.text);
  assert.deepEqual(cleanPage(p), p, 'limpar de novo não muda nada');
  for (const b of PAGE_BLOCKS) assert.ok(cleanPage({ blocks: [newBlock(b.type)] }).blocks[0].type === b.type);
});

test('drawPage: fundo, quebra de linha, marca de estilo da linha, sublinhado, caixa e QR', () => {
  const ctx = fakeCtx();
  const page = cleanPage({ orient: 'land', bg: { type: 'gradient', color: '#000000', color2: '#ffffff', angle: 90 }, blocks: [
    { type: 'text', x: 10, y: 10, w: 20, size: 40, text: 'um dois três quatro cinco\n{c=#ff0000;b} linha vermelha', underline: true, box: 'box', boxColor: '#00ff00', boxAlpha: 50, pad: 10, align: 'left' },
    { type: 'qr', x: 80, y: 60, w: 10, qr: 'https://exemplo.com.br/a' },
  ] });
  const rects = drawPage(ctx, page, { sel: 0 });
  assert.equal(rects.length, 2);
  assert.deepEqual([rects[0].x, rects[0].y, rects[0].w], [192, 108, 384]);
  const g = ctx.calls.find((c) => c[0] === 'gradient'); assert.ok(g[1] < g[3] && Math.abs(g[2] - g[4]) < 1e-6, 'degradê da esquerda para a direita');
  const texts = ctx.calls.filter((c) => c[0] === 'fillText');
  assert.ok(texts.length >= 3, 'a primeira linha quebrou na largura');
  assert.ok(texts.every((t) => t[2] === 192 + 10), 'alinhado à esquerda, depois da margem');
  const red = texts.find((t) => t[1] === 'linha vermelha');
  assert.ok(red && red[5] === '#ff0000' && /bold/.test(red[4]), 'a marca {c=…;b} vale só na linha dela');
  assert.ok(!texts.find((t) => t[1].startsWith('um'))[4].includes('bold'));
  assert.ok(ctx.calls.some((c) => c[0] === 'fill'), 'a caixa atrás');
  assert.ok(ctx.calls.filter((c) => c[0] === 'fillRect').length > 50, 'os quadradinhos do QR');
  assert.ok(ctx.calls.some((c) => c[0] === 'strokeRect'), 'a moldura do bloco escolhido');
  assert.equal(rects[1].w, rects[1].h, 'o QR é quadrado');
  const out = fakeCtx(); drawPage(out, page, { sel: -1 });
  assert.ok(!out.calls.some((c) => c[0] === 'strokeRect'), 'sem moldura no que vai para a TV');
  assert.equal(fontOf({ italic: true, bold: true, size: 50, font: 'serif' }), 'italic bold 50px Georgia, "Times New Roman", serif');
  assert.equal(wrapText(fakeCtx(), { ...newBlock('text'), text: 'a\n\nb' }, 1000).length, 3, 'linha em branco fica');
});

test('modelos prontos: todos limpos, com blocos, e as imagens que usam', () => {
  assert.ok(PAGE_PRESETS.length >= 8);
  for (const p of PAGE_PRESETS) { const pg = p.page(); assert.deepEqual(cleanPage(pg), pg, p.key); assert.ok(pg.blocks.length, p.key); drawPage(fakeCtx(), pg); }
  assert.ok(PAGE_PRESETS.some((p) => p.page().orient === 'port') && PAGE_PRESETS.some((p) => p.page().orient === 'land'));
  assert.deepEqual(pageAssets(cleanPage({ bg: { type: 'photo', art: 'foto-natal' }, blocks: [{ type: 'logo' }, { type: 'image', media: 4 }] })), ['a:foto-natal', 'logo', 'm:4']);
});
