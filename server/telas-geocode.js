/* NEXA Telas (docs/TELAS.md): "Localizar no mapa" da repartição. O geocodificador do gerador de caracteres (Open-Meteo) só
   conhece nomes de cidades; endereço com rua e número precisa de outro. Aqui a busca vai ao Nominatim (OpenStreetMap), com
   as regras de uso dele: no máximo um pedido por segundo (fila única do servidor), cliente identificado por um nome genérico,
   respostas guardadas. Do cliente só sai o texto do endereço da repartição (um prédio público) mais a cidade e a UF.
   A busca é presa à caixa do município da prefeitura; sem resultado, tenta sem a caixa; sem resultado ainda, cai no
   geocodificador antigo (acha a cidade ou o bairro para a pessoa arrastar o marcador). */
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const AGENT = 'NEXA-Broadcast (painel: localizar endereco de reparticao)';

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** O texto da busca: o endereço mais "cidade, UF, Brasil" quando a pessoa não escreveu a cidade. */
export function addressQuery(q, city = null) {
  const text = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!city?.name) return text;
  return norm(text).includes(norm(city.name)) ? `${text}, Brasil` : `${text}, ${city.name}, ${city.uf}, Brasil`;
}

/** Endereço do pedido ao Nominatim. bbox: { south, west, north, east } prende a busca à caixa (bounded). */
export function nominatimUrl(query, bbox = null) {
  const u = new URL(NOMINATIM);
  u.searchParams.set('format', 'jsonv2'); u.searchParams.set('limit', '5'); u.searchParams.set('countrycodes', 'br');
  u.searchParams.set('accept-language', 'pt-BR'); u.searchParams.set('q', query);
  if (bbox) { u.searchParams.set('viewbox', `${bbox.west},${bbox.north},${bbox.east},${bbox.south}`); u.searchParams.set('bounded', '1'); }
  return u.href;
}

const clean = (rows) => (Array.isArray(rows) ? rows : []).map((x) => ({ name: String(x.display_name || x.name || '').slice(0, 160), lat: Number(x.lat), lng: Number(x.lon) }))
  .filter((x) => x.name && Number.isFinite(x.lat) && Number.isFinite(x.lng) && Math.abs(x.lat) <= 90 && Math.abs(x.lng) <= 180);

/**
 * createGeocoder({ getJson, fallback, gapMs, now }).find(q, { city: { name, uf }, bbox }) -> [{ name, lat, lng }]
 * getJson(url, { headers, timeout }); fallback(q) -> [{ nome, estado, pais, lat, lon }] (o geocodificador antigo).
 */
export function createGeocoder({ getJson, fallback = null, gapMs = 1100, now = () => Date.now(), cacheMs = 24 * 3600_000, maxCache = 500 } = {}) {
  const cache = new Map(); // url -> { at, rows }
  let chain = Promise.resolve(); let last = 0;
  const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
  /** Um pedido por vez, com o intervalo do Nominatim; resposta guardada. */
  function ask(url) {
    const hit = cache.get(url);
    if (hit && now() - hit.at < cacheMs) return Promise.resolve(hit.rows);
    const run = chain.then(async () => {
      const again = cache.get(url);
      if (again && now() - again.at < cacheMs) return again.rows;
      const gap = last + gapMs - now();
      if (gap > 0) await wait(gap);
      last = now();
      const rows = clean(await getJson(url, { headers: { 'user-agent': AGENT, accept: 'application/json' }, timeout: 8000 }));
      if (cache.size >= maxCache) cache.delete(cache.keys().next().value);
      cache.set(url, { at: now(), rows });
      return rows;
    });
    chain = run.catch(() => {});
    return run;
  }
  async function find(q, { city = null, bbox = null } = {}) {
    const query = addressQuery(q, city);
    let rows = []; let failed = null;
    try {
      if (bbox) rows = await ask(nominatimUrl(query, bbox));
      if (!rows.length) rows = await ask(nominatimUrl(query));
    } catch (err) { failed = err; }
    if (!rows.length && fallback) {
      try { rows = (await fallback(String(q).slice(0, 80))).map((r) => ({ name: [r.nome, r.estado, r.pais].filter(Boolean).join(', '), lat: r.lat, lng: r.lon })); failed = null; } catch (err) { failed ||= err; }
    }
    if (!rows.length && failed) throw failed;
    return rows;
  }
  return { find };
}
