// DIGITAL ISP · conjunto de telas (cardápio por tela e videowall): as contas comuns de public/shared/tvcorp-wall.js e a
// validação do servidor (cleanWall / wallFor). O contrato é só aditivo: signage.wall aparece só nas telas de um conjunto.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const W = await import('../public/shared/tvcorp-wall.js');
const K = await import('../server/tvcorp-core.js');

test('as grades vão de 2 a 9 TVs e incluem 1×N, N×1, 2×2, 2×3 e 3×3', () => {
  const keys = W.WALL_GRIDS.map((g) => g.key);
  for (const k of ['2x1', '3x1', '1x2', '1x3', '2x2', '2x3', '3x2', '3x3']) assert.ok(keys.includes(k), k);
  for (const g of W.WALL_GRIDS) assert.ok(g.cols * g.rows >= 2 && g.cols * g.rows <= W.WALL_LIMITS.maxScreens, g.key);
});

test('posição na grade: lendo a linha da esquerda para a direita', () => {
  assert.deepEqual(W.cellOf(1, 3), { col: 0, row: 0 });
  assert.deepEqual(W.cellOf(3, 3), { col: 2, row: 0 });
  assert.deepEqual(W.cellOf(4, 3), { col: 0, row: 1 });
  assert.deepEqual(W.cellOf(9, 3), { col: 2, row: 2 });
});

test('videowall: cada TV mostra a janela dela, com a moldura descontada', () => {
  // sem moldura, 2×1: o quadro tem 2 telas de largura; a TV da direita começa na metade
  assert.deepEqual(W.wallWindow({ cols: 2, rows: 1, col: 1, row: 0 }), { canvasW: 2, canvasH: 1, left: 1, top: 0, scaleX: 200, scaleY: 100, offsetX: -100, offsetY: -0 });
  // 2×2 com moldura de 2% na largura e 4% na altura: o pedaço atrás da borda fica escondido
  const w = W.wallWindow({ cols: 2, rows: 2, col: 1, row: 1, bezel: { x: 2, y: 4 } });
  assert.equal(w.canvasW, 2.02); assert.equal(w.canvasH, 2.04);
  assert.equal(w.left, 1.02); assert.equal(w.top, 1.04);
  assert.equal(w.scaleX, 202); assert.equal(w.offsetX, -102); assert.equal(w.offsetY, -104);
  // as janelas cobrem o quadro sem passar: a última termina na borda do quadro
  for (const [cols, rows] of [[3, 1], [1, 3], [3, 3]]) {
    const last = W.wallWindow({ cols, rows, col: cols - 1, row: rows - 1, bezel: { x: 1.5, y: 2.5 } });
    assert.ok(Math.abs(last.left + 1 - last.canvasW) < 1e-9 && Math.abs(last.top + 1 - last.canvasH) < 1e-9, `${cols}x${rows}`);
  }
});

test('moldura em % a partir das polegadas e dos milímetros', () => {
  // TV de 55" deitada: 121,8 cm × 68,5 cm; 12 mm de borda somada
  assert.deepEqual(W.bezelPct({ inches: 55, gapMm: 12 }), { x: 1, y: 1.8 });
  assert.deepEqual(W.bezelPct({ inches: 55, gapMm: 12, orientation: 'port' }), { x: 1.8, y: 1 });
  assert.deepEqual(W.bezelPct({ inches: 0, gapMm: 12 }), { x: 0, y: 0 });
  assert.equal(W.bezelPct({ inches: 10, gapMm: 200 }).y, W.WALL_LIMITS.maxBezel, 'teto');
});

test('troca sincronizada: o mesmo relógio e o mesmo epoch dão o mesmo item em todas as TVs', () => {
  const dur = [10_000, 5_000, 15_000]; const epoch = 1_700_000_000_000;
  assert.deepEqual(W.syncPosition(dur, epoch, epoch), { index: 0, offset: 0, remaining: 10_000 });
  assert.deepEqual(W.syncPosition(dur, epoch, epoch + 12_000), { index: 1, offset: 2_000, remaining: 3_000 });
  assert.deepEqual(W.syncPosition(dur, epoch, epoch + 30_000 + 16_000), { index: 2, offset: 1_000, remaining: 14_000 }, 'volta ao começo');
  assert.deepEqual(W.syncPosition(dur, epoch, epoch - 1_000), { index: 2, offset: 14_000, remaining: 1_000 }, 'relógio antes do epoch');
  // duas TVs com o mesmo relógio: o mesmo item, sempre
  for (let t = 0; t < 200_000; t += 777) assert.deepEqual(W.syncPosition(dur, epoch, epoch + t), W.syncPosition([...dur], epoch, epoch + t));
  assert.equal(W.syncPosition([], epoch, epoch), null);
  assert.equal(W.syncPosition([0, 0], epoch, epoch), null);
});

test('servidor: cleanWall valida o modo, a grade, a moldura e as posições; o epoch não muda ao editar', () => {
  const w = K.cleanWall({ name: 'Praça', cols: 3, rows: 1, cells: [{ pos: 3, deviceId: 7 }, { pos: 1, deviceId: 5 }, { pos: 2, deviceId: '' }] }, null, { now: 1000 });
  assert.deepEqual(w, { name: 'Praça', data: { mode: 'menu', cols: 3, rows: 1, orientation: 'land', bezel: { x: 0, y: 0 }, sync: true, epoch: 1000, cells: [{ pos: 1, deviceId: 5 }, { pos: 3, deviceId: 7 }] } });
  const e = K.cleanWall({ mode: 'wall', layoutId: 4 }, w, { now: 99_999 });
  assert.equal(e.data.epoch, 1000); assert.equal(e.data.layoutId, 4); assert.equal(e.data.cells.length, 2);
  assert.equal(K.cleanWall({ name: 'Tela', layoutId: 4 }).data.layoutId, undefined, 'cardápio por tela não leva layout');
  assert.throws(() => K.cleanWall({ name: 'Tela', cols: 4, rows: 3 }), /Grade/);
  assert.throws(() => K.cleanWall({ name: 'Tela', mode: 'mosaico' }), /Modo/);
  assert.throws(() => K.cleanWall({ name: 'Tela', bezel: { x: 25 } }), /Moldura/);
  assert.throws(() => K.cleanWall({ name: 'Tela', cells: [{ pos: 3, deviceId: 1 }] }), /fora da grade/);
  assert.throws(() => K.cleanWall({ name: 'Tela', cells: [{ pos: 1, deviceId: 1 }, { pos: 1, deviceId: 2 }] }), /posição 1/);
  assert.throws(() => K.cleanWall({ name: 'Tela', cells: [{ pos: 1, deviceId: 1 }, { pos: 2, deviceId: 1 }] }), /duas posições/);
});

test('servidor: wallFor dá a posição só para a tela do conjunto (as outras não recebem signage.wall)', () => {
  const wall = { id: 3, name: 'Parede', data: K.cleanWall({ name: 'Parede', mode: 'wall', cols: 2, rows: 2, bezel: { x: 1, y: 2 }, cells: [{ pos: 4, deviceId: 9 }] }, null, { now: 5 }).data };
  assert.deepEqual(K.wallFor(wall, 9), { id: 3, name: 'Parede', mode: 'wall', cols: 2, rows: 2, pos: 4, col: 1, row: 1, orientation: 'land', bezel: { x: 1, y: 2 }, sync: true, epoch: 5 });
  assert.equal(K.wallFor(wall, 8), null);
  // o app antigo lê só os campos que conhece: signage.wall é um campo a mais, que ele ignora
  const antigo = ({ tz, brand, blocks, fallback }) => ({ tz, brand, blocks, fallback });
  const sg = { tz: 'America/Sao_Paulo', brand: {}, blocks: [], fallback: null };
  assert.deepEqual(antigo({ ...sg, wall: K.wallFor(wall, 9) }), antigo(sg));
});
