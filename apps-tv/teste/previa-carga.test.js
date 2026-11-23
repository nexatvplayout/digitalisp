'use strict';
/*
 * A prévia gerada (comum/js/previa.js) carrega num motor sem as funções novas: as TVs são Chromium 53 (LG webOS 4) e
 * 69 (Samsung Tizen 5.5). Na 1.0.5/1.0.6 o módulo usava Object.fromEntries (Chromium 73) ao carregar: TelasPrevia
 * ficava indefinido e a Samsung desenhava os slides só com o texto, sem a foto de fundo.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');
const { gerar, SAIDA_JS } = require('../scripts/previa.js');

let pronto = true;
try { gerar({ seNecessario: true }); } catch (e) { pronto = false; }

test('previa.js carrega sem fromEntries, flat, flatMap, Object.values/entries, padStart/padEnd, trimStart/End', { skip: !pronto && 'esbuild-wasm não instalado' }, () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(`
    delete Object.fromEntries; delete Object.values; delete Object.entries;
    delete Array.prototype.flat; delete Array.prototype.flatMap; delete Array.prototype.at;
    delete String.prototype.padStart; delete String.prototype.padEnd;
    delete String.prototype.trimStart; delete String.prototype.trimEnd; delete String.prototype.replaceAll;
    delete String.prototype.matchAll; delete Promise.allSettled; delete Object.hasOwn;
  `, ctx);
  vm.runInContext(fs.readFileSync(SAIDA_JS, 'utf8') + '\nthis.TelasPrevia = TelasPrevia;', ctx, { filename: 'previa.js' });
  assert.equal(typeof ctx.TelasPrevia.itemPreview, 'function');
  assert.equal(typeof ctx.TelasPrevia.slidePreview, 'function');
  assert.deepEqual(vm.runInContext('Object.fromEntries([["a", 1]])', ctx), { a: 1 });
  assert.equal(vm.runInContext('[[1], [2, [3]]].flatMap(function (x) { return x; }).length', ctx), 3);
  assert.equal(vm.runInContext('" x ".trimStart() + "|" + "7".padEnd(3, "0")', ctx), 'x |700');
});
