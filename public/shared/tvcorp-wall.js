// DIGITAL ISP · conjunto de telas (várias TVs juntas): as contas que o painel, o servidor e os apps das telas fazem iguais.
// Sem DOM e sem dependências. Dois modos:
//   menu  cada TV com o seu layout e a sua playlist (cardápio por tela); a troca dos itens é sincronizada pelo relógio.
//   wall  videowall: um layout no tamanho do conjunto inteiro, e cada TV mostra só a janela dela (com a moldura descontada).
// O contrato (signage.wall, só para as telas de um conjunto; o app antigo ignora):
//   { id, name, mode: 'menu'|'wall', cols, rows, pos (1 = canto de cima, à esquerda; segue a linha), col, row (0 = a
//     primeira), orientation: 'land'|'port' (de cada TV), bezel: { x, y } (a moldura entre duas telas, em % da largura e
//     da altura de UMA tela), sync: true|false, epoch (ms: o início comum da contagem) }

/** As grades aceitas: colunas × linhas (de 2 a 9 TVs). */
export const WALL_GRIDS = Object.freeze([
  [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [1, 2], [1, 3], [2, 2], [3, 2], [2, 3], [3, 3],
].map(([cols, rows]) => Object.freeze({ key: `${cols}x${rows}`, cols, rows, label: `${cols} × ${rows} (${cols * rows} TVs)` })));
export const WALL_MODES = Object.freeze([
  { key: 'menu', label: 'Cardápio por tela', desc: 'Cada TV com o seu layout e a sua playlist; a troca dos itens acontece junto em todas.' },
  { key: 'wall', label: 'Videowall', desc: 'Um layout só, do tamanho do conjunto inteiro; cada TV mostra a parte dela.' },
]);
export const WALL_LIMITS = Object.freeze({ maxScreens: 9, maxCols: 6, maxRows: 3, maxBezel: 20 });

/**
 * A plataforma da tela pelo campo "android" que o app manda no registro: o app Samsung manda "Tizen x", o LG "webOS x"
 * e a TV box Android a versão do Android ("11"). Vazio: ainda não se registrou.
 */
export function platformOf(system) {
  const s = String(system || '').trim();
  if (!s) return '';
  if (/^tizen/i.test(s)) return 'tizen';
  if (/^webos/i.test(s)) return 'webos';
  return 'android';
}
/**
 * As plataformas cujo app ainda NÃO desenha o videowall (mostrariam o layout inteiro em cada TV, repetido e sem recorte).
 * Tire da lista quando o app da plataforma passar a ler signage.wall.
 */
export const WALL_UNSUPPORTED = Object.freeze(['android']);
export const PLATFORM_LABEL = Object.freeze({ tizen: 'Samsung', webos: 'LG', android: 'TV box Android' });

/** A posição (1, 2, 3…) na grade: { col, row } (0 = a primeira), lendo a linha da esquerda para a direita. */
export const cellOf = (pos, cols) => ({ col: (pos - 1) % cols, row: Math.floor((pos - 1) / cols) });

/**
 * A janela de uma TV no videowall. O conteúdo é desenhado num quadro do tamanho do conjunto, contando a moldura entre as
 * telas (que esconde um pedaço da imagem, como uma janela de verdade). Medidas em "telas": 1 = a largura (ou a altura) de
 * uma TV. Devolve { canvasW, canvasH } (o quadro inteiro) e { left, top } (onde começa a janela desta TV), e as mesmas em %
 * de uma tela, para o app: desenhar o quadro com largura scaleX% e altura scaleY% da tela e deslocar por offsetX% e offsetY%.
 */
export function wallWindow({ cols, rows, col, row, bezel = {} }) {
  const bx = Math.max(0, Number(bezel.x) || 0) / 100; const by = Math.max(0, Number(bezel.y) || 0) / 100;
  const canvasW = cols + (cols - 1) * bx; const canvasH = rows + (rows - 1) * by;
  const left = col * (1 + bx); const top = row * (1 + by);
  const r = (v) => Math.round(v * 10000) / 10000;
  return { canvasW: r(canvasW), canvasH: r(canvasH), left: r(left), top: r(top), scaleX: r(canvasW * 100), scaleY: r(canvasH * 100), offsetX: r(-left * 100), offsetY: r(-top * 100) };
}

/**
 * A moldura entre duas telas em % de uma tela, a partir das medidas que a pessoa sabe: o tamanho da TV (polegadas, a
 * diagonal 16:9) e a soma das bordas de duas TVs vizinhas (mm). orientation: a de cada TV. Devolve { x, y } (uma casa).
 */
export function bezelPct({ inches, gapMm, orientation = 'land' }) {
  const d = Number(inches); const g = Number(gapMm);
  if (!(d > 0) || !(g >= 0)) return { x: 0, y: 0 };
  const diagCm = d * 2.54; const longCm = diagCm * (16 / Math.hypot(16, 9)); const shortCm = diagCm * (9 / Math.hypot(16, 9));
  const wCm = orientation === 'port' ? shortCm : longCm; const hCm = orientation === 'port' ? longCm : shortCm;
  const r = (v) => Math.min(WALL_LIMITS.maxBezel, Math.round(v * 10) / 10);
  return { x: r(((g / 10) / wCm) * 100), y: r(((g / 10) / hCm) * 100) };
}

/**
 * A troca sincronizada sem falar com as outras TVs: todas fazem a mesma conta com o mesmo relógio (a hora confiável do
 * app) e o mesmo epoch. durations: o tempo de cada item (ms), na ordem da playlist. Devolve { index, offset (ms já
 * passados no item), remaining (ms até o próximo) }; playlist vazia ou sem tempo: null.
 */
export function syncPosition(durations, epoch, now) {
  const list = (durations || []).map((x) => Math.max(0, Number(x) || 0));
  const total = list.reduce((a, b) => a + b, 0);
  if (!list.length || total <= 0) return null;
  let t = (Number(now) - Number(epoch)) % total; if (t < 0) t += total;
  for (let i = 0; i < list.length; i++) {
    if (t < list[i]) return { index: i, offset: t, remaining: list[i] - t };
    t -= list[i];
  }
  return { index: list.length - 1, offset: list[list.length - 1], remaining: 0 };
}
