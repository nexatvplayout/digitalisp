/* NEXA Telas (docs/TELAS.md §6): o contorno do município da prefeitura, buscado na API pública de malhas do IBGE
   (https://servicodados.ibge.gov.br/api/v3/malhas/municipios/<código>?formato=application/vnd.geo+json: uma FeatureCollection
   com Polygon ou MultiPolygon, pontos [longitude, latitude]). Só o servidor fala com o IBGE (o painel nunca), e do cliente só
   sai o código do município (7 dígitos). A resposta é lida com teto de tamanho e de tempo, conferida (public/shared/telas-geo.js:
   só polígonos com números finitos) e simplificada antes de guardar. Qualquer falha vira um Error com a mensagem para a tela:
   quem chama guarda o município assim mesmo e o mapa segue sem o contorno. */
import { parseOutline, simplifyOutline, bboxOf, countPoints, validBbox, OUTLINE } from '../public/shared/telas-geo.js';

export const MALHA_URL = 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios';
/** A caixa do Brasil com folga (ilhas oceânicas incluídas): o contorno que vem do painel precisa caber aqui. */
export const BRAZIL = Object.freeze({ south: -34.5, north: 6, west: -74.5, east: -28 });
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** O endereço da malha de um município. Só https; http só para a própria máquina e só com allowHttp (testes). */
export function malhaUrl(code, base = MALHA_URL, { allowHttp = false } = {}) {
  const n = Number(code);
  if (!Number.isInteger(n) || n < 1000000 || n > 9999999) throw new Error('Código do município inválido.');
  let u;
  try { u = new URL(`${String(base).replace(/\/+$/, '')}/${n}`); } catch { throw new Error('Endereço da malha inválido.'); }
  if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:' && LOOPBACK.has(u.hostname)))) throw new Error('A malha só é buscada por https.');
  if (u.username || u.password) throw new Error('Endereço da malha inválido.');
  u.searchParams.set('formato', 'application/vnd.geo+json');
  return u.href;
}

/**
 * createMalha({ fetch, base, timeoutMs, maxBytes, allowHttp, maxPoints }).fetchOutline(código) ->
 *   { polygons, bbox: { south, west, north, east }, points }
 * Lança Error (mensagem em português, sem dado do cliente) em: tempo esgotado, resposta que não é 200, grande demais, que
 * não é JSON ou que não é um contorno.
 */
export function createMalha({ fetch: fetchImpl = globalThis.fetch, base = MALHA_URL, timeoutMs = 8000, maxBytes = 4 * 1024 * 1024, allowHttp = false, maxPoints = OUTLINE.maxPoints } = {}) {
  async function readCapped(res) {
    const len = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(len) && len > maxBytes) throw new Error('O IBGE mandou um contorno grande demais.');
    if (!res.body?.getReader) { const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > maxBytes) throw new Error('O IBGE mandou um contorno grande demais.'); return buf; }
    const reader = res.body.getReader();
    const parts = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new Error('O IBGE mandou um contorno grande demais.'); }
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts);
  }
  async function fetchOutline(code) {
    const url = malhaUrl(code, base, { allowHttp });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let text;
    try {
      const res = await fetchImpl(url, { signal: ctl.signal, redirect: 'error', headers: { accept: 'application/vnd.geo+json, application/json' } });
      if (!res.ok) { res.body?.cancel?.().catch(() => {}); throw new Error(`O IBGE respondeu ${res.status}.`); }
      text = (await readCapped(res)).toString('utf8');
    } catch (err) {
      if (ctl.signal.aborted) throw new Error('O IBGE demorou demais para responder.');
      if (/^O IBGE /.test(err?.message || '')) throw err;
      throw new Error('Não foi possível falar com o IBGE.');
    } finally { clearTimeout(timer); }
    let geo;
    try { geo = JSON.parse(text); } catch { throw new Error('O IBGE respondeu algo que não é um contorno.'); }
    return fromGeo(geo, 'O IBGE respondeu');
  }
  /**
   * O contorno a partir de um GeoJSON já lido: conferido, simplificado e com a caixa. Serve à resposta do IBGE e ao
   * contorno que o PAINEL busca no IBGE e manda (o IBGE não responde a servidores fora do Brasil: docs/TELAS.md). O que vem
   * do painel passa pelo mesmo crivo e ainda precisa caber no Brasil (brazil: true).
   */
  function fromGeo(geo, who = 'O contorno enviado é', { brazil = false } = {}) {
    let polygons;
    try { polygons = simplifyOutline(parseOutline(geo), maxPoints); } catch (err) { throw new Error(`${who} algo que não é um contorno (${String(err.message).replace(/^Contorno /, '').replace(/\.$/, '')}).`); }
    const bbox = bboxOf(polygons);
    if (!validBbox(bbox)) throw new Error(`${who} um contorno sem área.`);
    if (brazil && !(bbox.south >= BRAZIL.south && bbox.north <= BRAZIL.north && bbox.west >= BRAZIL.west && bbox.east <= BRAZIL.east)) throw new Error('O contorno enviado fica fora do Brasil.');
    return { polygons, bbox, points: countPoints(polygons) };
  }
  return { fetchOutline, fromGeo };
}
