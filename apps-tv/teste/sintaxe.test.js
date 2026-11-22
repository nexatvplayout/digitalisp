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
const arquivos = fs.readdirSync(path.join(PASTA, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join(PASTA, 'js', f));

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

test('index.html carrega todos os scripts de js/', () => {
  const html = fs.readFileSync(path.join(PASTA, 'index.html'), 'utf8');
  for (const f of arquivos) assert.ok(html.includes('js/' + path.basename(f)), path.basename(f) + ' fora do index.html');
});
