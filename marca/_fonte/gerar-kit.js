// Gera o kit do logo DIGITAL ISP: SVGs vetoriais, PNGs em alta, ícones e favicon.
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Projetos/radar-de-leads/node_modules/playwright-core');

const OUT = process.argv[2];
const DIRS = ['svg', 'png', 'icones', 'favicon'];
for (const d of DIRS) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const C = {
  navy: '#0A2150',
  navyClaro: '#16336F',
  azul: '#0D80FF',
  ciano: '#14C4CC',
  branco: '#FFFFFF',
  preto: '#000000',
};

// ---------- Letras (cap height 240, desenhadas em curvas) ----------
const L = {
  D: { w: 100, d: 'M0,0 H72 Q100,0 100,28 V212 Q100,240 72,240 H0 Z M40,34 V206 H52 Q60,206 60,198 V42 Q60,34 52,34 Z' },
  I: { w: 40, d: 'M0,0 H40 V240 H0 Z' },
  G: { w: 100, d: 'M28,0 H72 Q100,0 100,28 V84 H60 V42 Q60,34 52,34 H48 Q40,34 40,42 V198 Q40,206 48,206 H52 Q60,206 60,198 V150 H52 V116 H100 V240 H68 L64,226 Q56,240 38,240 H28 Q0,240 0,212 V28 Q0,0 28,0 Z' },
  T: { w: 104, d: 'M0,0 H104 V34 H72 V240 H32 V34 H0 Z' },
  A: { w: 116, d: 'M22,0 H94 L116,240 H78 L74,198 H42 L38,240 H0 Z M45,166 H71 L62,52 H54 Z' },
  L: { w: 86, d: 'M0,0 H40 V206 H86 V240 H0 Z' },
  S: { w: 100, d: 'M28,0 H72 Q100,0 100,28 V84 H60 V42 Q60,34 52,34 H48 Q40,34 40,42 V80 Q40,88 46,94 L90,134 Q100,144 100,158 V212 Q100,240 72,240 H28 Q0,240 0,212 V156 H40 V198 Q40,206 48,206 H52 Q60,206 60,198 V164 Q60,156 54,150 L10,108 Q0,98 0,84 V28 Q0,0 28,0 Z' },
  P: { w: 100, d: 'M0,0 H72 Q100,0 100,28 V114 Q100,142 72,142 H40 V240 H0 Z M40,34 V108 H52 Q60,108 60,100 V42 Q60,34 52,34 Z' },
};
const GAP = 32, ESPACO = 100;
const AJUSTE = { 'TA': -12, 'AL': -6 }; // kerning
function palavra(texto) {
  let x = 0, partes = [], prev = null;
  for (const ch of texto) {
    if (ch === ' ') { x += ESPACO - GAP; prev = null; continue; }
    if (prev) x += GAP + (AJUSTE[prev + ch] || 0);
    partes.push(`<path transform="translate(${x} 0)" d="${L[ch].d}"/>`);
    x += L[ch].w; prev = ch;
  }
  return { svg: partes.join(''), w: x, h: 240 };
}
const WM = palavra('DIGITAL ISP'); // ~1064 x 240

// ---------- Símbolo (640 x 640) ----------
const TELAS = {
  azul: '57,150 443,62 443,405 57,550',
  ciano: '168,244 506,156 506,447 168,574',
  branca: '285,322 568,242 568,472 285,578',
};
const poli = (pts, fill, sw) => `<polygon points="${pts}" fill="${fill}" stroke="${fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;

function icone({ fundo = C.navy, telas = [C.azul, C.ciano, C.branco], raio = 120 } = {}) {
  return `<rect width="640" height="640" rx="${raio}" fill="${fundo}"/>`
    + poli(TELAS.azul, telas[0], 16)
    + poli(TELAS.ciano, fundo, 50) + poli(TELAS.ciano, telas[1], 16)
    + poli(TELAS.branca, fundo, 50) + poli(TELAS.branca, telas[2], 16);
}
// Monocromático: quadrado na cor, telas vazadas (transparentes) com filetes entre elas.
let mid = 0;
function iconeMono(cor) {
  const id = 'm' + (mid++);
  return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="640">`
    + `<rect width="640" height="640" rx="120" fill="#fff"/>`
    + poli(TELAS.azul, '#000', 16)
    + poli(TELAS.ciano, '#fff', 50) + poli(TELAS.ciano, '#000', 16)
    + poli(TELAS.branca, '#fff', 50) + poli(TELAS.branca, '#000', 16)
    + `</mask></defs><rect width="640" height="640" rx="120" fill="${cor}" mask="url(#${id})"/>`;
}

// ---------- Composições ----------
const svgDoc = (vb, corpo, titulo) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${titulo}"><title>${titulo}</title>${corpo}</svg>\n`;

function vertical(simbolo, corTexto) {
  const wmX = 0, icX = (WM.w - 640) / 2;
  const corpo = `<g transform="translate(${icX} 0)">${simbolo}</g>`
    + `<g transform="translate(${wmX} 720)" fill="${corTexto}">${WM.svg}</g>`;
  const m = 40;
  return svgDoc(`${-m} ${-m} ${WM.w + 2 * m} ${960 + 2 * m}`, corpo, 'DIGITAL ISP');
}
function horizontal(simbolo, corTexto) {
  const ic = 340, s = ic / 640, gap = 64;
  const wy = (ic - 240) / 2;
  const corpo = `<g transform="scale(${s})">${simbolo}</g>`
    + `<g transform="translate(${ic + gap} ${wy})" fill="${corTexto}">${WM.svg}</g>`;
  const m = 30, w = ic + gap + WM.w;
  return svgDoc(`${-m} ${-m} ${w + 2 * m} ${ic + 2 * m}`, corpo, 'DIGITAL ISP');
}
const soIcone = (simbolo) => svgDoc('0 0 640 640', simbolo, 'DIGITAL ISP');
const soNome = (cor) => svgDoc(`0 0 ${WM.w} 240`, `<g fill="${cor}">${WM.svg}</g>`, 'DIGITAL ISP');

const claroIc = icone();
const escuroIc = icone({ fundo: C.navyClaro });

const SVGS = {
  'logo-vertical': vertical(claroIc, C.navy),
  'logo-vertical-fundo-escuro': vertical(escuroIc, C.branco),
  'logo-horizontal': horizontal(claroIc, C.navy),
  'logo-horizontal-fundo-escuro': horizontal(escuroIc, C.branco),
  'logo-vertical-preto': vertical(iconeMono(C.preto), C.preto),
  'logo-vertical-branco': vertical(iconeMono(C.branco), C.branco),
  'logo-horizontal-preto': horizontal(iconeMono(C.preto), C.preto),
  'logo-horizontal-branco': horizontal(iconeMono(C.branco), C.branco),
  'icone': soIcone(claroIc),
  'icone-preto': soIcone(iconeMono(C.preto)),
  'icone-branco': soIcone(iconeMono(C.branco)),
  'nome-azul-marinho': soNome(C.navy),
  'nome-branco': soNome(C.branco),
};
for (const [n, s] of Object.entries(SVGS)) fs.writeFileSync(path.join(OUT, 'svg', n + '.svg'), s);
fs.writeFileSync(path.join(OUT, 'favicon', 'favicon.svg'), SVGS['icone']);

// Ícone "full-bleed" (quadrado sem cantos) para lojas de app / Android, que arredondam sozinhas.
const iconeQuadrado = soIcone(icone({ raio: 0 }));

// ---------- Render PNG ----------
function vbSize(svg) { const m = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number); return { w: m[2], h: m[3] }; }

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage();
  async function png(svg, largura, arquivo, fundo = null) {
    const { w, h } = vbSize(svg);
    const altura = Math.round(largura * h / w);
    await page.setViewportSize({ width: largura, height: altura });
    const bg = fundo ? `background:${fundo};` : 'background:transparent;';
    await page.setContent(`<html><body style="margin:0;${bg}"><div style="width:${largura}px;height:${altura}px">${svg.replace('<svg ', `<svg width="${largura}" height="${altura}" style="display:block" `)}</div></body></html>`);
    await page.screenshot({ path: arquivo, omitBackground: !fundo, clip: { x: 0, y: 0, width: largura, height: altura } });
    return fs.readFileSync(arquivo);
  }
  const P = (...a) => path.join(OUT, ...a);

  // Logos em alta (transparente) + versões com fundo
  for (const n of Object.keys(SVGS)) {
    if (n.startsWith('icone')) continue;
    await png(SVGS[n], 4000, P('png', `${n}-4000px.png`));
    await png(SVGS[n], 1200, P('png', `${n}-1200px.png`));
  }
  await png(SVGS['logo-vertical'], 4000, P('png', 'logo-vertical-fundo-branco-4000px.png'), '#FFFFFF');
  await png(SVGS['logo-horizontal'], 4000, P('png', 'logo-horizontal-fundo-branco-4000px.png'), '#FFFFFF');
  await png(SVGS['logo-vertical-fundo-escuro'], 4000, P('png', 'logo-vertical-fundo-azul-4000px.png'), '#061637');
  await png(SVGS['logo-horizontal-fundo-escuro'], 4000, P('png', 'logo-horizontal-fundo-azul-4000px.png'), '#061637');

  // Ícones
  for (const s of [2048, 1024, 512, 256, 192, 128, 64]) await png(SVGS['icone'], s, P('icones', `icone-${s}.png`));
  for (const s of [1024, 512]) {
    await png(SVGS['icone-preto'], s, P('icones', `icone-preto-${s}.png`));
    await png(SVGS['icone-branco'], s, P('icones', `icone-branco-${s}.png`));
  }
  await png(iconeQuadrado, 1024, P('icones', 'icone-app-store-1024.png'));
  await png(iconeQuadrado, 512, P('icones', 'icone-android-512.png'));

  // Favicon e afins
  const fav = {};
  for (const s of [16, 32, 48, 64, 128, 256]) fav[s] = await png(SVGS['icone'], s, P('favicon', `favicon-${s}.png`));
  await png(iconeQuadrado, 180, P('favicon', 'apple-touch-icon.png'));
  await png(SVGS['icone'], 192, P('favicon', 'android-chrome-192.png'));
  await png(SVGS['icone'], 512, P('favicon', 'android-chrome-512.png'));
  for (const s of [64, 128]) fs.unlinkSync(P('favicon', `favicon-${s}.png`));
  // favicon.ico com 16, 32, 48 e 256 (PNG dentro do ICO)
  const sizes = [16, 32, 48, 256];
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = 6 + 16 * sizes.length; const ents = [], datas = [];
  for (const s of sizes) {
    const d = fav[s]; const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(d.length, 8); e.writeUInt32LE(off, 12);
    off += d.length; ents.push(e); datas.push(d);
  }
  fs.writeFileSync(P('favicon', 'favicon.ico'), Buffer.concat([head, ...ents, ...datas]));
  fs.unlinkSync(P('favicon', 'favicon-256.png'));
  fs.writeFileSync(P('favicon', 'site.webmanifest'), JSON.stringify({
    name: 'DIGITAL ISP', short_name: 'DIGITAL ISP',
    icons: [{ src: 'android-chrome-192.png', sizes: '192x192', type: 'image/png' }, { src: 'android-chrome-512.png', sizes: '512x512', type: 'image/png' }],
    theme_color: C.navy, background_color: '#FFFFFF', display: 'standalone',
  }, null, 2));
  fs.writeFileSync(P('favicon', 'COMO-USAR.html'),
`<!-- Copie a pasta favicon para a raiz do site e cole no <head>: -->
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="${C.navy}">
`);

  // Folha de apresentação
  const cell = (svg, bg, label, h = 260, cor = '#4A5878') => `<div style="background:${bg};border-radius:20px;height:${h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;box-sizing:border-box">
    <div style="height:${h - 90}px;display:flex;align-items:center">${svg.replace('<svg ', `<svg style="height:100%;max-width:100%" `)}</div>
    <span style="font:500 15px Segoe UI,sans-serif;color:${cor}">${label}</span></div>`;
  const folha = `<html><body style="margin:0;background:#EEF1F6;font-family:Segoe UI,sans-serif">
  <div style="width:1800px;padding:64px;box-sizing:border-box;display:flex;flex-direction:column;gap:28px">
    <div style="font:700 44px Segoe UI;color:${C.navy}">DIGITAL ISP — kit de logo</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px">
      ${cell(SVGS['logo-vertical'], '#fff', 'Vertical', 520)}
      ${cell(SVGS['logo-vertical-fundo-escuro'], '#061637', 'Vertical, fundo escuro', 520, '#9FB3D9')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px">
      ${cell(SVGS['logo-horizontal'], '#fff', 'Horizontal', 240)}
      ${cell(SVGS['logo-horizontal-fundo-escuro'], '#061637', 'Horizontal, fundo escuro', 240, '#9FB3D9')}
      ${cell(SVGS['logo-horizontal-preto'], '#fff', 'Uma cor — preto', 240)}
      ${cell(SVGS['logo-horizontal-branco'], '#1F2937', 'Uma cor — branco', 240, '#C9D2E3')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:28px">
      ${cell(SVGS['icone'], '#fff', 'Ícone', 280)}
      ${cell(iconeQuadrado, '#fff', 'Ícone loja de apps', 280)}
      ${cell(SVGS['icone-preto'], '#fff', 'Ícone preto', 280)}
      ${cell(SVGS['icone-branco'], '#1F2937', 'Ícone branco', 280, '#C9D2E3')}
      <div style="background:#fff;border-radius:20px;height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px">
        <div style="display:flex;align-items:flex-end;gap:20px">
          <img src="data:image/png;base64,${fav[48].toString('base64')}" width="48" height="48">
          <img src="data:image/png;base64,${fav[32].toString('base64')}" width="32" height="32">
          <img src="data:image/png;base64,${fav[16].toString('base64')}" width="16" height="16">
        </div>
        <span style="font:500 15px Segoe UI;color:#4A5878">Favicon 48 · 32 · 16</span></div>
    </div>
    <div style="display:flex;gap:28px;align-items:center;font:500 16px Segoe UI;color:#4A5878">
      ${[[C.navy,'Azul-marinho'],[C.azul,'Azul'],[C.ciano,'Ciano'],[C.navyClaro,'Marinho (fundo escuro)']].map(([c,n])=>`<span style="display:flex;align-items:center;gap:10px"><span style="width:36px;height:36px;border-radius:8px;background:${c};display:inline-block"></span>${n} ${c}</span>`).join('')}
    </div>
  </div></body></html>`;
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.setContent(folha);
  await page.screenshot({ path: P('apresentacao-kit.png'), fullPage: true });

  await browser.close();
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
