'use strict';
/*
 * O player roda em TVs de 2018 (webOS 4 = Chromium 53, Tizen 4 = Chromium 56). Este teste barra a sintaxe que elas não
 * entendem e confere que cada arquivo ao menos compila. Também barra texto do app ou do sistema na tela (white-label).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PASTA = path.join(__dirname, '..', 'comum');
// previa.js é gerado (esbuild a partir de public/shared/tvcorp-previa.js): fica fora da lista escrita à mão e tem
// a conferência própria abaixo
const GERADO = 'previa.js';
const arquivos = fs.readdirSync(path.join(PASTA, 'js')).filter((f) => f.endsWith('.js') && f !== GERADO).map((f) => path.join(PASTA, 'js', f));

function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

test('sem sintaxe nova demais para as TVs', () => {
  const proibido = [
    [/\basync\s+(function|\(|[a-zA-Z_$][\w$]*\s*=>)/, 'async'],
    [/\bawait\s/, 'await'],
    [/\?\./, 'encadeamento opcional ?.'],
    [/\?\?/, '??'],
    [/\{\s*\.\.\.[a-zA-Z_$]/, 'espalhar objeto {...}'],
    [/\.padStart\(|\.padEnd\(/, 'padStart/padEnd (Chromium 57)'],
    [/Object\.(values|entries)\(/, 'Object.values/entries (Chromium 54)'],
    [/\bclass\s+\w+/, 'class (evitado: o código usa funções)']
  ];
  for (const f of arquivos) {
    const src = semComentarios(fs.readFileSync(f, 'utf8'));
    for (const [re, nome] of proibido) assert.ok(!re.test(src), `${path.basename(f)} usa ${nome}`);
  }
});

test('cada arquivo compila', () => {
  for (const f of arquivos) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }), path.basename(f));
});

test('nenhum nome do app ou do sistema na tela (white-label)', () => {
  const html = fs.readFileSync(path.join(PASTA, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const textos = [html].concat(arquivos.map((f) => semComentarios(fs.readFileSync(f, 'utf8'))));
  for (const t of textos) {
    assert.ok(!/DIGITAL ISP|Digital ISP|NEXA/.test(t.replace(/digitalisp\.com\.br|br\.com\.digitalisp/g, '')), 'nome da marca no player');
  }
  // o único título é o nome neutro
  assert.match(html, /<title>Telas<\/title>/);
});

test('index.html carrega todos os scripts de js/ (e a prévia gerada)', () => {
  const html = fs.readFileSync(path.join(PASTA, 'index.html'), 'utf8');
  for (const f of arquivos) assert.ok(html.includes('js/' + path.basename(f)), path.basename(f) + ' fora do index.html');
  assert.ok(html.includes('js/' + GERADO) && html.includes('previa.css'));
});

test('a prévia gerada para as TVs: sem sintaxe nova, sem cqw/min()/gap/inset no CSS, e compila', () => {
  require('../scripts/previa.js').gerar({ seNecessario: true });
  const js = fs.readFileSync(path.join(PASTA, 'js', GERADO), 'utf8');
  for (const [re, nome] of [[/\?\.[a-zA-Z_$[(]/, '?.'], [/\?\?/, '??'], [/async\s/, 'async'], [/await\s/, 'await'], [/\{\s*\.\.\.[a-zA-Z_$]/, '{...}'], [/import\s*[{(*]|export\s/, 'import/export']]) {
    assert.ok(!re.test(js), 'previa.js usa ' + nome);
  }
  assert.doesNotThrow(() => new vm.Script(js));
  const css = fs.readFileSync(path.join(PASTA, 'previa.css'), 'utf8');
  assert.ok(!/\d(cqw|cqh)/.test(css), 'cqw/cqh');
  assert.ok(!/min\(|inset:|gap:|:has\(|container-type|aspect-ratio/.test(css), 'propriedade que as TVs não têm');
  assert.ok(/var\(--cqw\)/.test(css));
  // o mesmo código do painel: as funções que o app usa existem
  const ctx = { document: { createElement() {}, createDocumentFragment() {} }, Element: function () {}, Document: function () {}, DocumentFragment: function () {}, Node: function () {} };
  ctx.self = ctx;
  vm.runInNewContext(js + ';self.P = TelasPrevia;', ctx);
  for (const f of ['itemPreview', 'slidePreview', 'themeClass', 'qrSvg']) assert.equal(typeof ctx.P[f], 'function', f);
  assert.ok(Array.isArray(ctx.P.MINS) && ctx.P.MINS.length > 0);
});
