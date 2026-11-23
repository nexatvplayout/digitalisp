// DIGITAL ISP · formatos especiais de zona (recorte não retangular) e o filete na borda do recorte.
// Sem DOM e sem dependências: o painel, o servidor e os apps das telas fazem as mesmas contas.
//
// Contrato (aditivo; o app antigo ignora e desenha o retângulo):
//   zone.shape: uma das chaves de ZONE_SHAPES (ausente = retângulo)
//   zone.edge:  { color: '#rrggbb', width } opcional, só com shape: o filete que acompanha a borda do recorte. width em %
//               da ALTURA da tela (0.2 a 3; 1 = 10,8 px numa tela de 1080).
// O recorte é sempre dentro do retângulo da zona (x, y, w, h). Uma zona com formato pode ficar sobre outra da mesma
// camada; a ordem de desenhar (a do servidor) é: camada de baixo (retângulos, depois formatos), camada de cima (idem).
//
// Para desenhar: shapeCommands(key, W, H) dá o caminho fechado no retângulo W×H (origem no canto de cima, à esquerda),
// em comandos M, L, C e Z com números absolutos; edgeCommands(key, W, H) dá o caminho do filete (aberto ou fechado).
// TVs sem clip-path: path() (Tizen/webOS até 2020): shapePolygon(key, W, H) dá os pontos em % para clip-path: polygon().
// Android: Path com moveTo/lineTo/cubicTo + canvas.clipPath (ou o outline da View).

const K = 0.5523; // o controle da curva de Bézier que imita um quarto de círculo

/** A elipse inscrita no retângulo (x, y, w, h), em 4 curvas. */
function ellipse(x, y, w, h) {
  const rx = w / 2; const ry = h / 2; const cx = x + rx; const cy = y + ry;
  return [['M', cx, y], ['C', cx + rx * K, y, x + w, cy - ry * K, x + w, cy], ['C', x + w, cy + ry * K, cx + rx * K, y + h, cx, y + h],
    ['C', cx - rx * K, y + h, x, cy + ry * K, x, cy], ['C', x, cy - ry * K, cx - rx * K, y, cx, y], ['Z']];
}
/** O retângulo com os cantos arredondados (r: o raio de cada canto, na ordem: cima-esq, cima-dir, baixo-dir, baixo-esq). */
function rounded(W, H, [a, b, c, d]) {
  return [['M', a, 0], ['L', W - b, 0], ['C', W - b + b * K, 0, W, b - b * K, W, b], ['L', W, H - c], ['C', W, H - c + c * K, W - c + c * K, H, W - c, H],
    ['L', d, H], ['C', d - d * K, H, 0, H - d + d * K, 0, H - d], ['L', 0, a], ['C', 0, a - a * K, a - a * K, 0, a, 0], ['Z']];
}
const mirrorX = (W, cmds) => cmds.map(([c, ...p]) => [c, ...p.map((v, i) => (i % 2 === 0 ? W - v : v))]);
const mirrorY = (H, cmds) => cmds.map(([c, ...p]) => [c, ...p.map((v, i) => (i % 2 === 1 ? H - v : v))]);

// a onda na borda esquerda (a zona entra no vizinho da esquerda com a borda curva): o caminho de baixo para cima
const waveLeft = (W, H) => [['M', 0.05 * W, H], ['C', 0.26 * W, 0.7 * H, -0.04 * W, 0.32 * H, 0.16 * W, 0]];
const waveTop = (W, H) => [['M', 0, 0.16 * H], ['C', 0.32 * W, -0.04 * H, 0.7 * W, 0.26 * H, W, 0.05 * H]];

/**
 * Os formatos: path(W, H) fechado e edge(W, H) (o filete: só a borda do recorte, ou o contorno inteiro). label: no
 * editor. square: fica melhor numa zona quadrada (o círculo vira elipse num retângulo).
 */
const DEFS = {
  'onda-esq': { label: 'Onda à esquerda', path: (W, H) => [['M', 0.16 * W, 0], ['L', W, 0], ['L', W, H], ...waveLeft(W, H).map((c, i) => (i === 0 ? ['L', c[1], c[2]] : c)), ['Z']], edge: waveLeft },
  'onda-dir': { label: 'Onda à direita', path: (W, H) => mirrorX(W, DEFS['onda-esq'].path(W, H)), edge: (W, H) => mirrorX(W, waveLeft(W, H)) },
  'onda-topo': { label: 'Onda em cima', path: (W, H) => [...waveTop(W, H), ['L', W, H], ['L', 0, H], ['Z']], edge: waveTop },
  'onda-base': { label: 'Onda embaixo', path: (W, H) => mirrorY(H, DEFS['onda-topo'].path(W, H)), edge: (W, H) => mirrorY(H, waveTop(W, H)) },
  'diagonal-esq': { label: 'Diagonal à esquerda', path: (W, H) => [['M', 0.2 * W, 0], ['L', W, 0], ['L', W, H], ['L', 0, H], ['Z']], edge: (W, H) => [['M', 0, H], ['L', 0.2 * W, 0]] },
  'diagonal-dir': { label: 'Diagonal à direita', path: (W, H) => [['M', 0, 0], ['L', W, 0], ['L', 0.8 * W, H], ['L', 0, H], ['Z']], edge: (W, H) => [['M', 0.8 * W, H], ['L', W, 0]] },
  arco: { label: 'Arco em cima', path: (W, H) => [['M', 0, 0.3 * H], ['C', 0.3 * W, -0.06 * H, 0.7 * W, -0.06 * H, W, 0.3 * H], ['L', W, H], ['L', 0, H], ['Z']],
    edge: (W, H) => [['M', 0, 0.3 * H], ['C', 0.3 * W, -0.06 * H, 0.7 * W, -0.06 * H, W, 0.3 * H]] },
  circulo: { label: 'Círculo', square: true, path: (W, H) => ellipse(0, 0, W, H), edge: (W, H) => ellipse(0, 0, W, H) },
  pilula: { label: 'Pílula', path: (W, H) => { const r = Math.min(W, H) / 2; return rounded(W, H, [r, r, r, r]); }, edge: (W, H) => DEFS.pilula.path(W, H) },
  cantos: { label: 'Cantos arredondados', path: (W, H) => { const r = Math.min(W, H) * 0.12; return rounded(W, H, [r, r, r, r]); }, edge: (W, H) => DEFS.cantos.path(W, H) },
  losango: { label: 'Losango', square: true, path: (W, H) => [['M', W / 2, 0], ['L', W, H / 2], ['L', W / 2, H], ['L', 0, H / 2], ['Z']], edge: (W, H) => DEFS.losango.path(W, H) },
  gota: { label: 'Gota (um canto reto)', path: (W, H) => { const r = Math.min(W, H) * 0.45; return rounded(W, H, [0, r, r, r]); }, edge: (W, H) => DEFS.gota.path(W, H) },
};

export const ZONE_SHAPES = Object.freeze(Object.entries(DEFS).map(([key, d]) => Object.freeze({ key, label: d.label, square: Boolean(d.square) })));
export const ZONE_SHAPE_KEYS = Object.freeze(ZONE_SHAPES.map((s) => s.key));
export const EDGE_LIMITS = Object.freeze({ min: 0.2, max: 3 });
export const EDGE_COLORS = Object.freeze([['#29d3e5', 'Ciano'], ['#f5b31c', 'Amarelo'], ['#ffffff', 'Branco'], ['#22c55e', 'Verde'], ['#ef4444', 'Vermelho'], ['#1d4ed8', 'Azul']]);

/** O caminho fechado do formato num retângulo W×H, com a origem em (ox, oy). null: formato desconhecido (desenhe o retângulo). */
export function shapeCommands(key, W, H, ox = 0, oy = 0) {
  const d = DEFS[key]; if (!d) return null;
  return move(d.path(W, H), ox, oy);
}
/** O caminho do filete (a borda do recorte), na mesma escala. */
export function edgeCommands(key, W, H, ox = 0, oy = 0) {
  const d = DEFS[key]; if (!d) return null;
  return move(d.edge(W, H), ox, oy);
}
const move = (cmds, ox, oy) => cmds.map(([c, ...p]) => [c, ...p.map((v, i) => (i % 2 === 0 ? v + ox : v + oy))]);
const n = (v) => String(Math.round(v * 100) / 100);
/** Os comandos como o "d" de um <path> do SVG. */
export const toPathD = (cmds) => (cmds || []).map(([c, ...p]) => `${c}${p.map(n).join(' ')}`).join(' ');

/**
 * Os pontos do contorno em % do retângulo (para clip-path: polygon() em TVs antigas): as curvas viram `steps` segmentos.
 * Devolve [[x%, y%], ...] (até duas casas).
 */
export function shapePolygon(key, W, H, steps = 12) {
  const cmds = shapeCommands(key, W, H); if (!cmds) return null;
  const pts = []; let cx = 0; let cy = 0;
  for (const [c, ...p] of cmds) {
    if (c === 'M' || c === 'L') { cx = p[0]; cy = p[1]; pts.push([cx, cy]); }
    else if (c === 'C') {
      const [x1, y1, x2, y2, x, y] = p;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps; const u = 1 - t;
        pts.push([u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y]);
      }
      cx = x; cy = y;
    }
  }
  const r = (v) => Math.round(v * 100) / 100;
  return pts.map(([x, y]) => [r(Math.max(0, Math.min(100, (x / W) * 100))), r(Math.max(0, Math.min(100, (y / H) * 100)))]);
}
