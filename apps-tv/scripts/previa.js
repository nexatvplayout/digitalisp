#!/usr/bin/env node
/*
 * Traz o desenho da prévia do painel (public/shared/tvcorp-previa.js e .css) para o app de TV, sem cópia à mão:
 *
 *   comum/js/previa.js   o mesmo código, empacotado pelo esbuild para o Chromium 53 (webOS 4) e com os polyfills que
 *                        ele usa e essas TVs não têm (Object.fromEntries, flat/flatMap, append, Object.entries/values, padStart/padEnd). Global TelasPrevia.
 *   comum/previa.css     o mesmo CSS, com as unidades de container trocadas: as TVs de 2018–2020 não têm cqw/cqh,
 *                        min(), gap no flex, inset nem :has(). Cada `Ncqw` vira calc(N * var(--cqw)) e `min(Acqh, Bcqw)`
 *                        vira var(--mI); o app mede cada zona e põe --cqw, --cqh e as --mI nela (TelasPrevia.MINS).
 *   comum/arte/          as artes de fundo da biblioteca (public/tvcorp/arte: .svg e as fotos .jpg), com o url() do CSS apontando para cá.
 *
 * Os três são gerados (fora do git): rode `node apps-tv/scripts/previa.js` (o empacotamento e o servidor falso rodam
 * sozinhos). Precisa do esbuild-wasm (`cd apps-tv; npm install`).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const APPS = path.join(__dirname, '..');
const REPO = path.join(APPS, '..');
const FONTE_JS = path.join(REPO, 'public', 'shared', 'tvcorp-previa.js');
const FONTE_QR = path.join(REPO, 'public', 'shared', 'telas-previa.js');
const FONTE_FAIXA = path.join(REPO, 'public', 'shared', 'faixa.js');
const FONTE_FORMAS = path.join(REPO, 'public', 'shared', 'tvcorp-formas.js');
const FONTE_CSS = path.join(REPO, 'public', 'shared', 'tvcorp-previa.css');
const FONTE_ARTE = path.join(REPO, 'public', 'tvcorp', 'arte');
const COMUM = path.join(APPS, 'comum');
const SAIDA_JS = path.join(COMUM, 'js', 'previa.js');
const SAIDA_CSS = path.join(COMUM, 'previa.css');
const SAIDA_ARTE = path.join(COMUM, 'arte');

// ------------------------------------------------------------------ CSS sem unidades de container

/** Separa o CSS em regras simples { seletor, declarações } (o arquivo não tem @media nem aninhamento). */
function regras(css) {
  const limpo = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(limpo))) out.push({ sel: m[1].trim(), decls: m[2].split(';').map((d) => d.trim()).filter(Boolean) });
  return out;
}

/**
 * Converte o CSS da prévia para as TVs. Devolve { css, mins } (mins: [[n, 'w'|'h', n, 'w'|'h'], …] na ordem das --mI).
 */
function converterCss(css) {
  const mins = [];
  const conteineres = [];
  const unidade = (v) => v
    .replace(/min\(\s*([\d.]+)cq([wh])\s*,\s*([\d.]+)cq([wh])\s*\)/g, (_, a, ua, b, ub) => { mins.push([Number(a), ua, Number(b), ub]); return `var(--m${mins.length - 1})`; })
    .replace(/(\d*\.?\d+)cq([wh])/g, (_, n, u) => `calc(${n} * var(--cq${u}))`)
    .replace(/url\(\s*\/tvcorp\/arte\//g, 'url(arte/');
  const saida = [];
  for (const r of regras(css)) {
    if (/:has\(/.test(r.sel)) continue; // seletor que as TVs não entendem (e que aqui não faz falta: a zona mede)
    const props = {};
    for (const d of r.decls) { const i = d.indexOf(':'); if (i > 0) props[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
    const coluna = props['flex-direction'] === 'column' || props.display === 'grid';
    // elemento que é ele mesmo um container (inline-size): as medidas DELE (padding, espaço entre filhos) são do
    // container de fora (--cqwp); o --cqw de dentro é a largura do conteúdo dele, medida pelo app (TelasPrevia.CONTEINERES)
    const conteiner = props['container-type'] === 'inline-size';
    if (conteiner) conteineres.push(r.sel);
    const un = (v) => { const x = unidade(v); return conteiner ? x.replace(/var\(--cqw\)/g, 'var(--cqwp)') : x; };
    const decls = [];
    let gap = null;
    for (const d of r.decls) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const k = d.slice(0, i).trim();
      const v = d.slice(i + 1).trim();
      if (k === 'container-type' || k === 'aspect-ratio') continue;
      if (k === 'gap') { gap = un(v); continue; }
      if (k === 'inset') { const x = un(v); decls.push(`top: ${x}`, `right: ${x}`, `bottom: ${x}`, `left: ${x}`); continue; }
      if (k === 'place-items') { decls.push(`align-items: ${v}`, `justify-content: ${v}`); continue; }
      if (k === 'display' && v === 'inline-grid') { decls.push('display: inline-flex'); continue; }
      if (k === 'display' && v === 'grid') { decls.push('display: block'); continue; }
      decls.push(`${k}: ${un(v)}`);
    }
    if (decls.length) saida.push(`${r.sel} { ${decls.join('; ')}; }`);
    // gap do flex (Chromium 84+): vira margem entre os filhos
    if (gap) {
      const lado = coluna ? 'margin-top' : 'margin-left';
      // !important: o gap do original não é anulado pelo `margin: 0` do filho (ex.: .tvc-sl-list)
      saida.push(`${r.sel.split(',').map((s) => `${s.trim()} > * + *`).join(', ')} { ${lado}: ${gap} !important; }`);
    }
  }
  return { css: saida.join('\n') + '\n', mins, conteineres };
}

// ------------------------------------------------------------------ JS para o Chromium 53

const POLYFILLS = `/* gerado por apps-tv/scripts/previa.js a partir de public/shared/tvcorp-previa.js; não edite à mão */
(function () {
  if (!Array.prototype.flat) Object.defineProperty(Array.prototype, 'flat', { configurable: true, writable: true, value: function (d) {
    d = d === undefined ? 1 : Math.floor(d); var out = [];
    (function f(a, n) { for (var i = 0; i < a.length; i++) { if (Array.isArray(a[i]) && n > 0) f(a[i], n - 1); else out.push(a[i]); } })(this, d);
    return out; } });
  // Object.fromEntries é do Chromium 73 (a Samsung 2020, Tizen 5.5, é Chromium 69): sem ele o módulo todo não carrega
  if (!Object.fromEntries) Object.fromEntries = function (it) { var o = {}; Array.prototype.slice.call(Array.from ? Array.from(it) : it).forEach(function (kv) { o[kv[0]] = kv[1]; }); return o; };
  if (!Object.values) Object.values = function (o) { return Object.keys(o).map(function (k) { return o[k]; }); };
  if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, 'flatMap', { configurable: true, writable: true, value: function (fn, t) {
    var out = []; for (var i = 0; i < this.length; i++) { var r = fn.call(t, this[i], i, this); if (Array.isArray(r)) out.push.apply(out, r); else out.push(r); } return out; } });
  if (!String.prototype.padEnd) String.prototype.padEnd = function (n, c) {
    var s = String(this); c = c === undefined ? ' ' : String(c); while (s.length < n) s = s + c; return s.slice(0, Math.max(n, String(this).length)); };
  if (!String.prototype.trimStart) String.prototype.trimStart = function () { return String(this).replace(/^\\s+/, ''); };
  if (!String.prototype.trimEnd) String.prototype.trimEnd = function () { return String(this).replace(/\\s+$/, ''); };
  // Intl formatToParts é do Chromium 57 (as LG webOS 4 são 53): o relógio do gadget pede hora, minuto e segundo num fuso
  if (typeof Intl !== 'undefined' && Intl.DateTimeFormat && !Intl.DateTimeFormat.prototype.formatToParts) {
    Intl.DateTimeFormat.prototype.formatToParts = function (d) {
      var ro = this.resolvedOptions(), tipos = ['hour', 'minute', 'second'].filter(function (k) { return ro[k]; });
      if (ro.year || ro.month || ro.day || ro.weekday) throw new Error('formatToParts: só hora');
      var out = [], k = 0;
      (this.format(d).match(/\\d+|\\D+/g) || []).forEach(function (t) { out.push(/^\\d/.test(t) ? { type: tipos[k++] || 'literal', value: t } : { type: 'literal', value: t }); });
      return out;
    };
  }
  if (!Object.entries) Object.entries = function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }); };
  if (!String.prototype.padStart) String.prototype.padStart = function (n, c) {
    var s = String(this); c = c === undefined ? ' ' : String(c); while (s.length < n) s = c + s; return s.slice(-Math.max(n, String(this).length)); };
  if (typeof Element === 'undefined') return; // fora do navegador (o teste da carga, em node)
  [Element.prototype, Document.prototype, DocumentFragment.prototype].forEach(function (p) {
    if (p.append) return;
    Object.defineProperty(p, 'append', { configurable: true, writable: true, value: function () {
      var frag = document.createDocumentFragment();
      for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; frag.appendChild(a instanceof Node ? a : document.createTextNode(String(a))); }
      this.appendChild(frag); } });
  });
})();
`;

function esbuild() {
  try { return require(path.join(APPS, 'node_modules', 'esbuild-wasm')); } catch (e) {
    throw new Error('esbuild-wasm não instalado: rode "npm install" dentro de apps-tv');
  }
}

function gerarJs(mins, conteineres) {
  const eb = esbuild();
  const entrada = [
    `export * from ${JSON.stringify(FONTE_JS.replace(/\\/g, '/'))};`,
    `export { qrSvg } from ${JSON.stringify(FONTE_QR.replace(/\\/g, '/'))};`,
    // o estilo da faixa de avisos (o mesmo código do servidor e do painel), quando existir no checkout
    fs.existsSync(FONTE_FAIXA) ? `export { cleanTickerStyle, sepText, fontCss } from ${JSON.stringify(FONTE_FAIXA.replace(/\\/g, '/'))};` : '',
    // os formatos especiais de zona (recorte e filete), quando existir no checkout
    fs.existsSync(FONTE_FORMAS) ? `export { shapePolygon, edgeCommands, toPathD } from ${JSON.stringify(FONTE_FORMAS.replace(/\\/g, '/'))};` : ''
  ].join('\n');
  const r = eb.buildSync({
    stdin: { contents: entrada, resolveDir: path.dirname(FONTE_JS), loader: 'js', sourcefile: 'previa-entrada.js' },
    bundle: true, format: 'iife', globalName: 'TelasPrevia', target: 'chrome53', write: false,
    legalComments: 'none', charset: 'utf8', minifySyntax: true, logLevel: 'silent'
  });
  const codigo = r.outputFiles[0].text;
  // as artes que vão no pacote (arte/): o app não baixa o artFile delas
  const artes = fs.existsSync(FONTE_ARTE) ? fs.readdirSync(FONTE_ARTE).filter((f) => /\.(svg|jpe?g|png|webp)$/i.test(f)).map((f) => f.replace(/\.[^.]+$/, '')) : [];
  return POLYFILLS + codigo + `TelasPrevia.ARTES = ${JSON.stringify(artes)};
TelasPrevia.MINS = ${JSON.stringify(mins)};\nTelasPrevia.CONTEINERES = ${JSON.stringify(conteineres.join(', '))};\n`;
}

/** Gera os três; `seNecessario`: só se faltar algum ou a fonte for mais nova. Devolve true se gerou. */
function gerar(op) {
  op = op || {};
  const fontes = [FONTE_JS, FONTE_QR, FONTE_CSS, FONTE_FAIXA, FONTE_FORMAS, path.join(REPO, 'public', 'shared', 'tvcorp-tipos.js'), __filename].filter((f) => fs.existsSync(f));
  if (op.seNecessario && fs.existsSync(SAIDA_JS) && fs.existsSync(SAIDA_CSS)) {
    const t = Math.min(fs.statSync(SAIDA_JS).mtimeMs, fs.statSync(SAIDA_CSS).mtimeMs);
    if (fontes.every((f) => fs.statSync(f).mtimeMs <= t)) return false;
  }
  const { css, mins, conteineres } = converterCss(fs.readFileSync(FONTE_CSS, 'utf8'));
  const js = gerarJs(mins, conteineres);
  // escreve num temporário e renomeia: dois testes gerando ao mesmo tempo não leem um arquivo pela metade
  const gravar = (alvo, txt) => { const tmp = `${alvo}.${process.pid}.tmp`; fs.writeFileSync(tmp, txt); fs.renameSync(tmp, alvo); };
  gravar(SAIDA_CSS, '/* gerado por apps-tv/scripts/previa.js a partir de public/shared/tvcorp-previa.css; não edite à mão */\n' + css);
  gravar(SAIDA_JS, js);
  fs.mkdirSync(SAIDA_ARTE, { recursive: true });
  // só o que mudou (tamanho diferente ou falta): não reescreve o arquivo que outro processo pode estar copiando
  const igual = (a, b) => { try { const x = fs.statSync(a), y = fs.statSync(b); return x.size === y.size && x.mtimeMs <= y.mtimeMs; } catch (e) { return false; } };
  if (fs.existsSync(FONTE_ARTE)) for (const f of fs.readdirSync(FONTE_ARTE)) {
    const de = path.join(FONTE_ARTE, f), para = path.join(SAIDA_ARTE, f);
    if (!/\.(svg|jpe?g|png|webp)$/i.test(f) || igual(de, para)) continue;
    // por um temporário e renomeia; outro processo copiando o mesmo arquivo (os testes em paralelo, na 1ª geração) pode
    // segurar o destino: se ele já ficou igual, tudo bem
    const tmp = `${para}.${process.pid}.tmp`;
    try { fs.copyFileSync(de, tmp); fs.renameSync(tmp, para); } catch (e) {
      try { fs.unlinkSync(tmp); } catch (e2) { /* nada */ }
      if (!igual(de, para)) throw e;
    }
  }
  return true;
}

if (require.main === module) {
  try { gerar(); console.log('prévia gerada: ' + path.relative(REPO, SAIDA_JS) + ', ' + path.relative(REPO, SAIDA_CSS)); } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { gerar, converterCss, SAIDA_JS, SAIDA_CSS };
