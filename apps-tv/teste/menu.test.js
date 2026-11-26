// O menu do app de TV: a senha (a mesma em todos os aparelhos, conferida pelo hash) e a margem da tela (de 0 a 8%).
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../comum/js/nucleo.js');
const S = require('../comum/js/sha256.js');

test('a senha do menu abre só com a certa', () => {
  assert.equal(N.senhaMenuOk('828510', S), true);
  for (const p of ['', '1234', '828511', '0828510', 'abcdef', null]) assert.equal(N.senhaMenuOk(p, S), false, String(p));
});

test('a margem: de 0 a 8%, padrão 0, e a janela do layout no meio', () => {
  assert.equal(N.limparMargem(undefined), 0);
  assert.equal(N.limparMargem(50), 0);
  assert.equal(N.limparMargem('3'), 3);
  assert.equal(N.janelaMargem(0), null);
  assert.deepEqual(N.janelaMargem(3), { offsetX: 3, offsetY: 3, scaleX: 94, scaleY: 94 });
  assert.deepEqual(N.retanguloNaTela({ x: 0, y: 0, w: 70, h: 100 }, N.janelaMargem(5)), { x: 5, y: 5, w: 63, h: 90 });
});
