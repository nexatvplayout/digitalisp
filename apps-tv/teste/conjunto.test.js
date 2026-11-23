'use strict';
/* Conjunto de telas (signage.wall): leitura, a janela do videowall e a troca sincronizada. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const N = require('../comum/js/nucleo.js');

const COMUM = path.join(__dirname, '..', '..', 'public', 'shared', 'tvcorp-wall.js');

test('signage.wall: lido e limpo; grade, posição ou campo errado → sem conjunto', () => {
  const c = N.lerConjunto({ id: 7, name: 'Parede da vitrine', mode: 'wall', cols: 2, rows: 2, pos: 4, col: 9, row: 9, orientation: 'land', bezel: { x: 1, y: 1.8 }, epoch: 1795400000000 });
  assert.deepEqual([c.modo, c.col, c.row, c.sync, c.moldura.y, c.nome], ['wall', 1, 1, true, 1.8, 'Parede da vitrine']);
  assert.equal(N.lerConjunto({ mode: 'menu', cols: 2, rows: 1, pos: 1 }).sync, false);
  assert.equal(N.lerConjunto({ mode: 'menu', cols: 2, rows: 1, pos: 1, sync: true }).sync, true);
  assert.equal(N.lerConjunto({ cols: 4, rows: 4, pos: 1 }), null);
  assert.equal(N.lerConjunto({ cols: 2, rows: 1, pos: 3 }), null);
  assert.equal(N.lerConjunto(null), null);
  const prog = N.lerConfig({ rev: 'r', device: { name: 'Vitrine 2' }, signage: { tz: 'America/Sao_Paulo', blocks: [], wall: { mode: 'menu', cols: 3, rows: 1, pos: 2, name: 'Cardápio' } } });
  assert.equal(prog.conjunto.pos, 2);
  assert.equal(prog.nome, 'Vitrine 2');
});

test('videowall: 2×1 sem moldura, a TV da direita tem o quadro de 200 % deslocado −100 %', () => {
  const j = N.janelaConjunto(N.lerConjunto({ mode: 'wall', cols: 2, rows: 1, pos: 2 }));
  assert.deepEqual([j.scaleX, j.scaleY, j.offsetX, j.offsetY], [200, 100, -100, -0]);
  // uma zona em metade do conjunto (a direita inteira) ocupa a tela toda desta TV
  assert.deepEqual(N.retanguloNaTela({ x: 50, y: 0, w: 50, h: 100 }, j), { x: 0, y: 0, w: 100, h: 100 });
  // com a moldura, a TV de baixo à direita de um 2×2 começa depois da borda
  const k = N.janelaConjunto(N.lerConjunto({ mode: 'wall', cols: 2, rows: 2, pos: 4, bezel: { x: 2, y: 4 } }));
  assert.deepEqual([k.scaleX, k.scaleY, k.offsetX, k.offsetY], [202, 204, -102, -104]);
});

test('troca sincronizada: o mesmo relógio dá o mesmo item, e o que falta para o próximo', () => {
  const d = [5000, 10000, 5000];
  assert.deepEqual(N.posicaoSincronizada(d, 1000, 1000), { index: 0, offset: 0, remaining: 5000 });
  assert.deepEqual(N.posicaoSincronizada(d, 1000, 1000 + 7000), { index: 1, offset: 2000, remaining: 8000 });
  assert.deepEqual(N.posicaoSincronizada(d, 1000, 1000 + 20000 + 16000), { index: 2, offset: 1000, remaining: 4000 });
  assert.deepEqual(N.posicaoSincronizada(d, 50000, 1000), { index: 1, offset: 6000, remaining: 4000 }); // antes do epoch: conta para trás
  assert.equal(N.posicaoSincronizada([], 0, 1), null);
  assert.equal(N.posicaoSincronizada([0, 0], 0, 1), null);
});

test('as contas batem com public/shared/tvcorp-wall.js (o painel e o servidor)', { skip: !fs.existsSync(COMUM) && 'tvcorp-wall.js não está neste checkout' }, async () => {
  const W = await import(pathToFileURL(COMUM).href);
  for (const g of W.WALL_GRIDS) {
    for (let pos = 1; pos <= g.cols * g.rows; pos++) {
      const bezel = { x: (pos % 3) * 1.5, y: (pos % 2) * 2.2 };
      const c = N.lerConjunto({ mode: 'wall', cols: g.cols, rows: g.rows, pos, bezel });
      const cel = W.cellOf(pos, g.cols);
      assert.deepEqual(N.janelaConjunto(c), W.wallWindow({ cols: g.cols, rows: g.rows, col: cel.col, row: cel.row, bezel }), `${g.key} pos ${pos}`);
    }
  }
  const d = [3000, 7000, 12000, 500];
  for (let t = -50000; t < 80000; t += 1237) assert.deepEqual(N.posicaoSincronizada(d, 12345, t), W.syncPosition(d, 12345, t));
});
