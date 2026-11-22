// NEXA Telas (docs/TELAS.md §6): a geometria do município da prefeitura, o mesmo arquivo no servidor (server/telas-malha.js:
// confere e simplifica o contorno que vem do IBGE antes de guardar) e no Painel da Prefeitura (o contorno, a trava do mapa e a
// repartição "fora do município"). Sem DOM e sem dependências: só dados e funções puras.
//
// O contorno guardado é uma lista de polígonos; cada polígono, uma lista de anéis (o 1º é a borda, os outros são buracos);
// cada anel, uma lista de pontos [lng, lat] (a ordem do GeoJSON e da malha do IBGE), fechado (o último repete o primeiro).

/** Teto de pontos do contorno guardado e os limites do que se aceita de fora. */
export const OUTLINE = Object.freeze({ maxPoints: 2500, maxInputPoints: 400000, maxPolygons: 2000, decimals: 5 });

const fail = (message) => Object.assign(new Error(message), { status: 400 });
const round = (v, d = OUTLINE.decimals) => { const k = 10 ** d; return Math.round(v * k) / k; };
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

function cleanRing(ring) {
  if (!Array.isArray(ring)) throw fail('Contorno fora do formato: anel que não é lista.');
  const out = [];
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) throw fail('Contorno fora do formato: ponto sem longitude e latitude.');
    const lng = p[0]; const lat = p[1];
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) throw fail('Contorno fora do formato: coordenada que não é número.');
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) throw fail('Contorno fora do formato: coordenada fora do mundo.');
    const q = [round(lng), round(lat)];
    if (!out.length || !same(out[out.length - 1], q)) out.push(q);
  }
  if (out.length && !same(out[0], out[out.length - 1])) out.push([out[0][0], out[0][1]]);
  return out;
}

/**
 * O GeoJSON da malha (FeatureCollection, Feature ou a geometria direta) -> polígonos [[anel, …], …] com números finitos.
 * Só Polygon e MultiPolygon; qualquer outra coisa lança (status 400) com a mensagem.
 */
export function parseOutline(geo) {
  if (!geo || typeof geo !== 'object') throw fail('Contorno fora do formato: não é GeoJSON.');
  const geoms = [];
  const take = (g) => {
    if (!g || typeof g !== 'object') return;
    if (g.type === 'FeatureCollection' && Array.isArray(g.features)) g.features.forEach(take);
    else if (g.type === 'Feature') take(g.geometry);
    else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) g.geometries.forEach(take);
    else if (g.type === 'Polygon' || g.type === 'MultiPolygon') geoms.push(g);
    else throw fail('Contorno fora do formato: só polígono ou multipolígono.');
  };
  take(geo);
  const polygons = [];
  let points = 0;
  for (const g of geoms) {
    if (!Array.isArray(g.coordinates)) throw fail('Contorno fora do formato: geometria sem coordenadas.');
    for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) {
      if (!Array.isArray(poly)) throw fail('Contorno fora do formato: polígono que não é lista.');
      const rings = [];
      for (const [i, ring] of poly.entries()) {
        points += Array.isArray(ring) ? ring.length : 0;
        if (points > OUTLINE.maxInputPoints) throw fail('Contorno grande demais.');
        const r = cleanRing(ring);
        if (r.length >= 4) rings.push(r); else if (i === 0) break; // borda degenerada: o polígono inteiro sai
      }
      if (rings.length) polygons.push(rings);
      if (polygons.length > OUTLINE.maxPolygons) throw fail('Contorno com polígonos demais.');
    }
  }
  if (!polygons.length) throw fail('Contorno vazio: nenhum polígono com área.');
  return polygons;
}

export const countPoints = (polygons) => (polygons || []).reduce((n, poly) => n + poly.reduce((m, r) => m + r.length, 0), 0);

/** A caixa envolvente { south, west, north, east } dos polígonos (ou de uma lista de pontos { lat, lng }); vazio = null. */
export function bboxOf(polygons) {
  let south = Infinity; let west = Infinity; let north = -Infinity; let east = -Infinity;
  for (const poly of polygons || []) for (const ring of poly) for (const [lng, lat] of ring) {
    if (lat < south) south = lat; if (lat > north) north = lat; if (lng < west) west = lng; if (lng > east) east = lng;
  }
  return Number.isFinite(south) ? { south, west, north, east } : null;
}
/** A caixa é uma caixa de verdade (quatro números finitos, com área)? */
export const validBbox = (b) => Boolean(b) && ['south', 'west', 'north', 'east'].every((k) => typeof b[k] === 'number' && Number.isFinite(b[k]))
  && b.south < b.north && b.west < b.east && b.south >= -90 && b.north <= 90 && b.west >= -180 && b.east <= 180;
/** O ponto está na caixa (com folga em graus)? */
export const inBbox = (lat, lng, b, pad = 0) => Boolean(b) && lat >= b.south - pad && lat <= b.north + pad && lng >= b.west - pad && lng <= b.east + pad;

/** Distância ao quadrado do ponto p ao segmento a-b (em graus: basta para comparar). */
function segDist2(p, a, b) {
  let x = a[0]; let y = a[1];
  let dx = b[0] - x; let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}
/** Douglas-Peucker (sem recursão: a pilha não estoura em anel grande). tol em graus. Os extremos ficam. */
export function simplifyLine(points, tol) {
  const n = points.length;
  if (n <= 2 || !(tol > 0)) return points.slice();
  const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0; let at = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist2(points[i], points[a], points[b]); if (d > max) { max = d; at = i; } }
    if (at > 0 && max > t2) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
/** Um anel fechado simplificado; some (null) se deixa de ter área. O anel é cortado no ponto mais distante do início para
    o Douglas-Peucker não achatar um anel fechado num ponto só. */
export function simplifyRing(ring, tol) {
  if (ring.length < 4) return null;
  let far = 1; let max = -1;
  for (let i = 1; i < ring.length - 1; i++) { const dx = ring[i][0] - ring[0][0]; const dy = ring[i][1] - ring[0][1]; const d = dx * dx + dy * dy; if (d > max) { max = d; far = i; } }
  const a = simplifyLine(ring.slice(0, far + 1), tol); const b = simplifyLine(ring.slice(far), tol);
  const out = [...a, ...b.slice(1)];
  return out.length >= 4 ? out : null;
}
const ringArea = (ring) => { let s = 0; for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return Math.abs(s) / 2; };

/**
 * Os polígonos com no máximo maxPoints pontos: a tolerância dobra até caber (começa em ~10 m). O que perde a área sai; o
 * maior polígono fica sempre. Devolve os próprios polígonos quando já cabem.
 */
export function simplifyOutline(polygons, maxPoints = OUTLINE.maxPoints) {
  if (countPoints(polygons) <= maxPoints) return polygons;
  const biggest = polygons.reduce((best, p) => (ringArea(p[0]) > ringArea(best[0]) ? p : best), polygons[0]);
  const at = (tol) => {
    const res = [];
    for (const poly of polygons) {
      const outer = simplifyRing(poly[0], tol);
      if (!outer) { if (poly === biggest) res.push([poly[0].length > 5 ? [poly[0][0], poly[0][Math.floor(poly[0].length / 3)], poly[0][Math.floor(2 * poly[0].length / 3)], poly[0][0]] : poly[0]]); continue; }
      res.push([outer, ...poly.slice(1).map((h) => simplifyRing(h, tol)).filter(Boolean)]);
    }
    return res;
  };
  let out = polygons;
  for (let tol = 0.0001; tol < 2; tol *= 2) {
    out = at(tol);
    if (countPoints(out) > maxPoints) continue;
    // coube: entre a tolerância de antes (que não coube) e esta, fica a menor que cabe (o contorno mais fiel dentro do teto)
    let lo = tol / 2; let hi = tol;
    for (let i = 0; i < 6 && tol > 0.0001; i++) {
      const mid = (lo + hi) / 2; const m = at(mid);
      if (countPoints(m) <= maxPoints) { hi = mid; out = m; } else lo = mid;
    }
    return out;
  }
  // nem com a tolerância no teto: fica só a borda do maior polígono, cortada no número de pontos
  const ring = out.reduce((best, p) => (ringArea(p[0]) > ringArea(best[0]) ? p : best), out[0])[0];
  const step = Math.ceil(ring.length / Math.max(4, maxPoints - 1));
  const cut = ring.filter((_, i) => i % step === 0);
  if (!same(cut[0], cut[cut.length - 1])) cut.push(cut[0]);
  return [[cut]];
}

/** O ponto está dentro do anel? (raio para a direita, regra par-ímpar) */
function inRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    const [xi, yi] = ring[i]; const [xk, yk] = ring[k];
    if ((yi > lat) !== (yk > lat) && lng < (xk - xi) * (lat - yi) / (yk - yi) + xi) inside = !inside;
  }
  return inside;
}
/** O ponto (lat, lng) está dentro do contorno? Dentro da borda de algum polígono e fora dos buracos dele. */
export function pointInOutline(lat, lng, polygons) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  for (const poly of polygons || []) {
    if (!inRing(lat, lng, poly[0])) continue;
    if (!poly.slice(1).some((hole) => inRing(lat, lng, hole))) return true;
  }
  return false;
}

/**
 * O ponto fica no município? city: { polygons, bbox, approx }. Com o contorno, dentro dele; só com a caixa (exata), dentro
 * dela com a folga `slack` em graus; com a caixa aproximada ou sem nada, true (não há como dizer que está fora).
 */
export function insideCity(lat, lng, city, slack = 0.01) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  if (city?.polygons?.length) return pointInOutline(lat, lng, city.polygons);
  if (validBbox(city?.bbox) && !city.approx) return inBbox(lat, lng, city.bbox, slack);
  return true;
}

/**
 * A cor do pino de uma repartição pelas situações das telas dela (as de deviceStatus, public/shared/telas-tipos.js):
 * 'off' (vermelho) alguma desligada ou que nunca ligou; 'warn' (amarelo) alguma ligada sem imagem; 'on' (verde) todas no
 * ar; 'none' (cinza) sem tela. As revogadas não contam.
 */
export function officeStatus(statuses) {
  const list = (statuses || []).filter((s) => s && s !== 'revoked');
  if (!list.length) return 'none';
  if (list.some((s) => s === 'off' || s === 'never')) return 'off';
  if (list.some((s) => s === 'warn')) return 'warn';
  return 'on';
}
export const OFFICE_STATUS_LABEL = Object.freeze({ on: 'Todas as telas no ar', warn: 'Tela ligada sem imagem', off: 'Tela desligada', none: 'Sem tela' });

/** Onde o mapa abre quando o contorno ainda não veio e não há ponto nenhum: o meio de cada estado (aproximado) e o zoom. */
export const UF_VIEW = Object.freeze({
  AC: [-9.0, -70.5, 6], AL: [-9.6, -36.6, 8], AP: [1.4, -51.8, 6], AM: [-4.0, -64.5, 5], BA: [-12.5, -41.7, 6], CE: [-5.2, -39.4, 7], DF: [-15.8, -47.8, 9],
  ES: [-19.6, -40.6, 7], GO: [-16.0, -49.6, 6], MA: [-5.1, -45.3, 6], MT: [-12.9, -55.9, 5], MS: [-20.5, -54.8, 6], MG: [-18.5, -44.6, 6], PA: [-4.0, -52.5, 5],
  PB: [-7.1, -36.7, 7], PR: [-24.6, -51.6, 6], PE: [-8.4, -37.9, 7], PI: [-7.4, -42.8, 6], RJ: [-22.2, -42.7, 7], RN: [-5.8, -36.6, 7], RS: [-29.8, -53.2, 6],
  RO: [-10.9, -63.0, 6], RR: [2.0, -61.4, 6], SC: [-27.3, -50.5, 7], SP: [-22.3, -48.7, 6], SE: [-10.6, -37.4, 8], TO: [-10.2, -48.3, 6],
});
