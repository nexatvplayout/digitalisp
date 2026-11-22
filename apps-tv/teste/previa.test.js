'use strict';
/* A conversão do CSS da prévia do painel para as TVs (sem container queries, min(), gap no flex, inset nem :has()). */
const test = require('node:test');
const assert = require('node:assert');
const { converterCss } = require('../scripts/previa.js');

test('cqw/cqh viram variáveis da zona; min() vira --mI com os dois lados', () => {
  const r = converterCss('.a { font-size: 4.5cqw; padding: 2cqh 3cqw; } .b { font-size: min(7cqh, 4.5cqw); }');
  assert.match(r.css, /\.a \{ font-size: calc\(4\.5 \* var\(--cqw\)\); padding: calc\(2 \* var\(--cqh\)\) calc\(3 \* var\(--cqw\)\); \}/);
  assert.match(r.css, /\.b \{ font-size: var\(--m0\); \}/);
  assert.deepEqual(r.mins, [[7, 'h', 4.5, 'w']]);
});

test('gap do flex vira margem entre os filhos (coluna: em cima; linha: à esquerda), mais forte que margin: 0', () => {
  const r = converterCss('.col { display: flex; flex-direction: column; gap: 2cqw; } .lin, .lin2 { display: flex; gap: 1em; } .g { display: grid; gap: 3px; }');
  assert.match(r.css, /\.col > \* \+ \* \{ margin-top: calc\(2 \* var\(--cqw\)\) !important; \}/);
  assert.match(r.css, /\.lin > \* \+ \*, \.lin2 > \* \+ \* \{ margin-left: 1em !important; \}/);
  assert.match(r.css, /\.g \{ display: block; \}/);
  assert.match(r.css, /\.g > \* \+ \* \{ margin-top: 3px !important; \}/);
  assert.ok(!/gap:/.test(r.css));
});

test('container: o próprio padding usa a medida de fora (--cqwp) e o seletor vai para CONTEINERES', () => {
  const r = converterCss('.sl { container-type: inline-size; padding: 3cqw 6cqw; gap: 4cqw; } .t { font-size: 6cqw; }');
  assert.match(r.css, /\.sl \{ padding: calc\(3 \* var\(--cqwp\)\) calc\(6 \* var\(--cqwp\)\); \}/);
  assert.match(r.css, /\.sl > \* \+ \* \{ margin-left: calc\(4 \* var\(--cqwp\)\) !important; \}/);
  assert.match(r.css, /\.t \{ font-size: calc\(6 \* var\(--cqw\)\); \}/);
  assert.deepEqual(r.conteineres, ['.sl']);
  assert.ok(!/container-type/.test(r.css));
});

test('inset, place-items, inline-grid, aspect-ratio, :has() e a arte de fundo', () => {
  const r = converterCss('.x { inset: 0; aspect-ratio: 16 / 9; } .y { display: inline-grid; place-items: center; } :has(> .z) { container-type: inline-size; } .w { background-image: url(/tvcorp/arte/ondas.svg); }');
  assert.match(r.css, /\.x \{ top: 0; right: 0; bottom: 0; left: 0; \}/);
  assert.match(r.css, /\.y \{ display: inline-flex; align-items: center; justify-content: center; \}/);
  assert.ok(!/:has/.test(r.css));
  assert.match(r.css, /url\(arte\/ondas\.svg\)/);
});
