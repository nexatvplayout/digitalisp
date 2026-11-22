// NEXA Telas: o município da prefeitura sem servidor (public/shared/telas-geo.js, server/telas-malha.js,
// public/admin/telas-mapa.js; docs/TELAS.md §6): o GeoJSON da malha conferido (só polígono e multipolígono, números finitos),
// a simplificação (Douglas-Peucker com teto de pontos), a caixa envolvente, o ponto dentro do contorno (com buraco e ilhas),
// a cor do pino da repartição pela situação das telas, a busca no IBGE (só https, só o código, com teto de tempo e de
// tamanho; aqui contra um servidor HTTP local, nunca a internet) e as contas do mapa travado (enquadrar a caixa com zoom
// fracionário, a trava do arrasto e os quadros esticados sem fresta).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const G = await import('../public/shared/telas-geo.js');
const M = await import('../public/admin/telas-mapa.js');
const { createMalha, malhaUrl, MALHA_URL } = await import('../server/telas-malha.js');
const { UFS } = await import('../public/shared/br-docs.js');
const { deviceStatus, OFFICE_TYPE_KEYS, TYPE_SIGLA, typeSigla } = await import('../public/shared/telas-tipos.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/** Quadrado [lng, lat] fechado. */
const square = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
/** Círculo com n pontos e a borda recortada em várias escalas, como um litoral (para a simplificação ter o que tirar). */
const circle = (cx, cy, r, n, wobble = 0) => { const out = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; const rr = r + wobble * (Math.sin(37 * a) + 0.3 * Math.sin(611 * a) + 0.1 * Math.sin(4999 * a) + 0.03 * Math.sin(20011 * a)); out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); } out.push(out[0].slice()); return out; };
// o formato que a malha do IBGE devolve (conferido em 10/11/2026): FeatureCollection com uma Feature { codarea } e a geometria
const ibge = (geometry, code = '3300936') => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: { codarea: code } }] });

test('contorno: aceita o formato da malha (FeatureCollection, Feature ou geometria), fecha o anel e recusa o que não é polígono com números finitos', () => {
  const sq = square(-41.8, -22.3, -41.5, -22.1);
  const a = G.parseOutline(ibge({ type: 'Polygon', coordinates: [sq] }));
  assert.equal(a.length, 1); assert.equal(a[0].length, 1); assert.deepEqual(a[0][0], sq);
  assert.deepEqual(G.parseOutline({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [sq] } }), a);
  assert.deepEqual(G.parseOutline({ type: 'Polygon', coordinates: [sq] }), a);
  // multipolígono (cidade com ilhas) e buraco
  const multi = G.parseOutline(ibge({ type: 'MultiPolygon', coordinates: [[sq, square(-41.7, -22.25, -41.6, -22.15)], [square(-41.4, -22.3, -41.35, -22.25)]] }));
  assert.equal(multi.length, 2); assert.equal(multi[0].length, 2); assert.equal(G.countPoints(multi), 15);
  // anel aberto é fechado; pontos repetidos em seguida saem; as casas decimais ficam em 5
  const open = G.parseOutline({ type: 'Polygon', coordinates: [[[-41.8, -22.3], [-41.8, -22.3], [-41.5, -22.3], [-41.5, -22.1000001234], [-41.8, -22.1]]] });
  assert.deepEqual(open[0][0], [[-41.8, -22.3], [-41.5, -22.3], [-41.5, -22.1], [-41.8, -22.1], [-41.8, -22.3]]);
  // um polígono sem área some; se não sobra nenhum, é erro
  assert.equal(G.parseOutline({ type: 'MultiPolygon', coordinates: [[sq], [[[1, 1], [1, 1], [1, 1]]]] }).length, 1);
  const bad = [
    null, 'x', 42, [], {}, { type: 'FeatureCollection', features: [] }, { type: 'Point', coordinates: [-41, -22] }, ibge({ type: 'LineString', coordinates: sq }),
    { type: 'Polygon' }, { type: 'Polygon', coordinates: 'x' }, { type: 'Polygon', coordinates: [[[1, 1], [1, 1], [1, 1]]] },
    { type: 'Polygon', coordinates: [[[-41.8, -22.3], [-41.5, 'a'], [-41.5, -22.1], [-41.8, -22.3]]] },
    { type: 'Polygon', coordinates: [[[-41.8, -22.3], [-41.5, NaN], [-41.5, -22.1], [-41.8, -22.3]]] },
    { type: 'Polygon', coordinates: [[[-41.8, -22.3], [-41.5, Infinity], [-41.5, -22.1], [-41.8, -22.3]]] },
    { type: 'Polygon', coordinates: [[[-41.8, -22.3], [-41.5], [-41.5, -22.1], [-41.8, -22.3]]] },
    { type: 'Polygon', coordinates: [[[-241.8, -22.3], [-41.5, -22.3], [-41.5, -22.1], [-241.8, -22.3]]] },
    { type: 'Polygon', coordinates: [[[-41.8, -122.3], [-41.5, -22.3], [-41.5, -22.1], [-41.8, -122.3]]] },
    { type: 'Polygon', coordinates: [{ 0: 1 }] },
  ];
  for (const b of bad) assert.throws(() => G.parseOutline(b), (e) => e.status === 400 && /Contorno/.test(e.message), JSON.stringify(b));
  // teto do que se aceita de fora
  assert.throws(() => G.parseOutline({ type: 'Polygon', coordinates: [new Array(G.OUTLINE.maxInputPoints + 1).fill([1, 1])] }), /grande demais/);
});

test('caixa envolvente e ponto dentro do contorno: borda, buraco, ilhas e coordenada inválida', () => {
  const polys = [[square(-41.8, -22.3, -41.5, -22.1), square(-41.7, -22.25, -41.6, -22.15)], [square(-41.4, -22.32, -41.35, -22.25)]];
  assert.deepEqual(G.bboxOf(polys), { south: -22.32, west: -41.8, north: -22.1, east: -41.35 });
  assert.equal(G.bboxOf([]), null); assert.equal(G.bboxOf(null), null);
  assert.ok(G.validBbox(G.bboxOf(polys)));
  for (const b of [null, {}, { south: 1, west: 1, north: 1, east: 2 }, { south: 0, west: 0, north: 1, east: NaN }, { south: 0, west: 0, north: 91, east: 1 }, { south: '0', west: 0, north: 1, east: 1 }]) assert.equal(G.validBbox(b), false, JSON.stringify(b));
  assert.equal(G.pointInOutline(-22.2, -41.75, polys), true, 'dentro da borda');
  assert.equal(G.pointInOutline(-22.2, -41.65, polys), false, 'dentro do buraco');
  assert.equal(G.pointInOutline(-22.28, -41.37, polys), true, 'na ilha');
  assert.equal(G.pointInOutline(-22.2, -41.45, polys), false, 'entre a borda e a ilha');
  assert.equal(G.pointInOutline(-23, -41.7, polys), false); assert.equal(G.pointInOutline(NaN, -41.7, polys), false); assert.equal(G.pointInOutline(-22.2, -41.75, null), false);
  assert.equal(G.inBbox(-22.2, -41.45, G.bboxOf(polys)), true); assert.equal(G.inBbox(-22.33, -41.45, G.bboxOf(polys)), false); assert.equal(G.inBbox(-22.33, -41.45, G.bboxOf(polys), 0.02), true);
  // "fora do município": com o contorno vale o contorno; só com a caixa exata, a caixa; aproximada ou sem nada, nunca diz "fora"
  assert.equal(G.insideCity(-22.2, -41.45, { polygons: polys, bbox: G.bboxOf(polys) }), false);
  assert.equal(G.insideCity(-22.2, -41.75, { polygons: polys, bbox: G.bboxOf(polys) }), true);
  assert.equal(G.insideCity(-22.2, -41.45, { bbox: G.bboxOf(polys) }), true); assert.equal(G.insideCity(-10, -41.45, { bbox: G.bboxOf(polys) }), false);
  assert.equal(G.insideCity(-10, -41.45, { bbox: G.bboxOf(polys), approx: true }), true);
  assert.equal(G.insideCity(-10, -41.45, null), true); assert.equal(G.insideCity(null, null, { polygons: polys }), true, 'sem ponto não está "fora"');
});

test('simplificação: Douglas-Peucker tira o que está na reta, o contorno grande cai para o teto de pontos e continua fechado e no lugar', () => {
  // pontos na mesma reta saem; os extremos e o canto ficam
  assert.deepEqual(G.simplifyLine([[0, 0], [1, 0.00001], [2, 0], [3, 0.00001], [4, 0], [4, 4]], 0.001), [[0, 0], [4, 0], [4, 4]]);
  assert.deepEqual(G.simplifyLine([[0, 0], [1, 1]], 0.5), [[0, 0], [1, 1]]);
  const line = [[0, 0], [1, 5], [2, 0]];
  assert.deepEqual(G.simplifyLine(line, 0), line); assert.notEqual(G.simplifyLine(line, 0), line, 'devolve uma cópia');
  // anel: o quadrado com pontos a mais volta a ter os 4 cantos; o anel que perde a área some
  const dense = []; for (let i = 0; i <= 40; i++) dense.push([i / 40, 0]); for (let i = 1; i <= 40; i++) dense.push([1, i / 40]); for (let i = 1; i <= 40; i++) dense.push([1 - i / 40, 1]); for (let i = 1; i <= 40; i++) dense.push([0, 1 - i / 40]);
  const ring = G.simplifyRing(dense, 0.001);
  assert.equal(ring.length, 5); assert.deepEqual(ring[0], ring[4]);
  assert.equal(G.simplifyRing([[0, 0], [0.00001, 0], [0, 0.00001], [0, 0]], 0.01), null);
  // dentro do teto: os mesmos polígonos (nem copia)
  const small = [[square(-41.8, -22.3, -41.5, -22.1)]];
  assert.equal(G.simplifyOutline(small, 100), small);
  // município grande: 60 mil pontos e 300 ilhotas viram no máximo o teto
  const big = [[circle(-52, -6, 1.5, 60000, 0.03), circle(-52.2, -6.1, 0.2, 3000, 0.004)], ...Array.from({ length: 300 }, (_, i) => [circle(-50 + i * 0.001, -4, 0.00002, 12)])];
  assert.ok(G.countPoints(big) > 60000);
  const out = G.simplifyOutline(big);
  assert.ok(G.countPoints(out) <= G.OUTLINE.maxPoints, `ficou com ${G.countPoints(out)}`);
  assert.ok(G.countPoints(out) > G.OUTLINE.maxPoints * 0.6, `não achatou além do preciso: ${G.countPoints(out)}`);
  for (const poly of out) for (const r of poly) { assert.ok(r.length >= 4); assert.deepEqual(r[0], r[r.length - 1], 'anel fechado'); for (const [x, y] of r) assert.ok(Number.isFinite(x) && Number.isFinite(y)); }
  const b0 = G.bboxOf([big[0]]); const b1 = G.bboxOf([out.reduce((a, p) => (p[0].length > a[0].length ? p : a))]);
  for (const k of ['south', 'west', 'north', 'east']) assert.ok(Math.abs(b0[k] - b1[k]) < 0.02, `${k}: ${b0[k]} x ${b1[k]}`);
  assert.equal(G.pointInOutline(-6, -52.9, out), true, 'dentro continua dentro'); assert.equal(G.pointInOutline(-6.1, -52.2, out), false, 'o buraco continua'); assert.equal(G.pointInOutline(-9, -52, out), false);
  // teto minúsculo: fica só a borda do maior, ainda fechada
  const tiny = G.simplifyOutline(big, 12);
  assert.ok(G.countPoints(tiny) <= 12 + 1); assert.equal(tiny.length, 1); assert.deepEqual(tiny[0][0][0], tiny[0][0].at(-1));
});

test('cor do pino da repartição: verde todas no ar, amarelo ligada sem imagem, vermelho alguma desligada, cinza sem tela (os estados das telas, sem inventar)', () => {
  assert.equal(G.officeStatus([]), 'none'); assert.equal(G.officeStatus(null), 'none'); assert.equal(G.officeStatus(['revoked']), 'none');
  assert.equal(G.officeStatus(['on']), 'on'); assert.equal(G.officeStatus(['on', 'on', 'revoked']), 'on');
  assert.equal(G.officeStatus(['on', 'warn']), 'warn'); assert.equal(G.officeStatus(['warn']), 'warn');
  assert.equal(G.officeStatus(['on', 'off']), 'off'); assert.equal(G.officeStatus(['warn', 'off', 'on']), 'off', 'desligada pesa mais que sem imagem');
  assert.equal(G.officeStatus(['on', 'never']), 'off', 'tela que nunca ligou conta como desligada');
  // as entradas são exatamente as situações de deviceStatus
  const now = 1_000_000_000;
  const st = [{ lastSeen: now - 1000, state: 'playing' }, { lastSeen: now - 1000, state: 'error' }, { lastSeen: now - 600000 }, {}, { revokedAt: 1 }].map((d) => deviceStatus(d, now));
  assert.deepEqual(st, ['on', 'warn', 'off', 'never', 'revoked']);
  assert.equal(G.officeStatus(st.slice(0, 1)), 'on'); assert.equal(G.officeStatus(st.slice(0, 2)), 'warn'); assert.equal(G.officeStatus(st), 'off');
  assert.deepEqual(Object.keys(G.OFFICE_STATUS_LABEL).sort(), ['none', 'off', 'on', 'warn']);
  // todo tipo do catálogo tem a sigla do pino (curta)
  for (const k of OFFICE_TYPE_KEYS) { assert.ok(TYPE_SIGLA[k], `sigla de ${k}`); assert.ok(typeSigla(k).length <= 4, typeSigla(k)); }
  assert.equal(typeSigla('nao-existe'), TYPE_SIGLA.outro);
  // onde o mapa abre sem contorno e sem ponto: um centro para cada UF
  assert.deepEqual(Object.keys(G.UF_VIEW).sort(), Object.keys(UFS).sort());
  for (const [uf, [lat, lng, z]] of Object.entries(G.UF_VIEW)) assert.ok(lat > -34 && lat < 6 && lng > -74 && lng < -34 && z >= 5 && z <= 9, uf);
});

test('malha do IBGE: só https (http só na própria máquina e só no teste), só o código vai no pedido', () => {
  assert.equal(MALHA_URL, 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios');
  assert.equal(malhaUrl(3304557), 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios/3304557?formato=application%2Fvnd.geo%2Bjson');
  assert.equal(malhaUrl('3304557', 'https://exemplo.test/malhas/'), 'https://exemplo.test/malhas/3304557?formato=application%2Fvnd.geo%2Bjson');
  for (const c of [null, '', 'abc', 123, 33045570, 3304557.5, '3304557/../x', -3304557, '3304557?x=1']) assert.throws(() => malhaUrl(c), /Código do município inválido/, String(c));
  assert.throws(() => malhaUrl(3304557, 'http://servicodados.ibge.gov.br/api'), /só é buscada por https/);
  assert.throws(() => malhaUrl(3304557, 'http://127.0.0.1:9/malhas'), /só é buscada por https/, 'http local só com allowHttp');
  assert.throws(() => malhaUrl(3304557, 'http://exemplo.test/malhas', { allowHttp: true }), /só é buscada por https/, 'allowHttp vale só para a própria máquina');
  assert.throws(() => malhaUrl(3304557, 'ftp://127.0.0.1/malhas', { allowHttp: true }), /https/);
  assert.throws(() => malhaUrl(3304557, 'https://user:senha@exemplo.test/malhas'), /inválido/);
  assert.throws(() => malhaUrl(3304557, 'não é endereço'), /inválido/);
  assert.match(malhaUrl(3304557, 'http://127.0.0.1:9/malhas', { allowHttp: true }), /^http:\/\/127\.0\.0\.1:9\/malhas\/3304557\?/);
});

test('busca do contorno: resposta boa guardável; 500, tempo esgotado, grande demais, que não é JSON, que não é polígono e redirecionamento viram erro com mensagem (servidor local, sem internet)', async (t) => {
  const seen = [];
  const sq = square(-41.8, -22.3, -41.5, -22.1);
  const srv = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers, method: req.method });
    const code = /\/(\d+)\?/.exec(req.url)?.[1];
    const json = (obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/vnd.geo+json; charset=utf-8' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
    if (code === '3300936') return json(ibge({ type: 'Polygon', coordinates: [sq] }));
    if (code === '1500602') return json(ibge({ type: 'MultiPolygon', coordinates: [[circle(-52, -6, 1.5, 30000)], [square(-50, -4, -49.9, -3.9)]] }, code));
    if (code === '2111300') return json({ erro: 'interno' }, 500);
    if (code === '3550308') return undefined; // nunca responde
    if (code === '4106902') return json('<html>manutenção</html>');
    if (code === '4314902') return json(ibge({ type: 'LineString', coordinates: sq }));
    if (code === '5300108') return json({ type: 'FeatureCollection', features: [] });
    if (code === '2927408') { res.writeHead(302, { location: 'http://127.0.0.1:1/outro' }); return res.end(); }
    if (code === '2304400') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"type":"Polygon","coordinates":[['); const pad = '[1,1],'.repeat(20000); const iv = setInterval(() => { if (!res.write(pad)) { /* segue */ } }, 5); res.on('close', () => clearInterval(iv)); return undefined; }
    return json({ erro: 'não achado' }, 404);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections?.(); srv.close(); });
  const base = `http://127.0.0.1:${srv.address().port}/malhas`;
  const malha = createMalha({ base, allowHttp: true, timeoutMs: 700, maxBytes: 2500000 });

  const ok = await malha.fetchOutline(3300936);
  assert.deepEqual(ok.polygons, [[sq]]); assert.deepEqual(ok.bbox, { south: -22.3, west: -41.8, north: -22.1, east: -41.5 }); assert.equal(ok.points, 5);
  // do cliente só sai o código: nada de sessão, cookie ou outro dado no pedido
  assert.equal(seen.length, 1); assert.equal(seen[0].method, 'GET'); assert.equal(seen[0].url, '/malhas/3300936?formato=application%2Fvnd.geo%2Bjson');
  for (const h of ['cookie', 'authorization', 'x-admin-token', 'referer', 'origin']) assert.equal(seen[0].headers[h], undefined, h);
  // contorno grande: já vem simplificado, com a caixa e a contagem
  const big = await malha.fetchOutline('1500602');
  assert.ok(big.points <= G.OUTLINE.maxPoints && big.points === G.countPoints(big.polygons), String(big.points));
  assert.ok(Math.abs(big.bbox.west + 53.5) < 0.02 && Math.abs(big.bbox.east + 49.9) < 0.02 && Math.abs(big.bbox.south + 7.5) < 0.02 && Math.abs(big.bbox.north + 3.9) < 0.02, JSON.stringify(big.bbox));

  await assert.rejects(malha.fetchOutline(2111300), /O IBGE respondeu 500/);
  await assert.rejects(malha.fetchOutline(9999999), /O IBGE respondeu 404/);
  await assert.rejects(malha.fetchOutline(3550308), /demorou demais/);
  await assert.rejects(malha.fetchOutline(4106902), /não é um contorno/);
  await assert.rejects(malha.fetchOutline(4314902), /não é um contorno \(.*só polígono ou multipolígono\)/);
  await assert.rejects(malha.fetchOutline(5300108), /não é um contorno \(.*vazio/);
  await assert.rejects(malha.fetchOutline(2927408), /Não foi possível falar com o IBGE/, 'redirecionamento não é seguido');
  await assert.rejects(malha.fetchOutline(2304400), /grande demais/);
  await assert.rejects(malha.fetchOutline('x'), /Código do município inválido/);
  // sem allowHttp o mesmo endereço local é recusado antes de qualquer pedido
  const n = seen.length;
  await assert.rejects(createMalha({ base }).fetchOutline(3300936), /só é buscada por https/);
  assert.equal(seen.length, n);
  // servidor fora do ar e fetch injetado: a falha nunca escapa sem mensagem, e o padrão aponta para o IBGE em https
  await assert.rejects(createMalha({ base: 'http://127.0.0.1:1/malhas', allowHttp: true, timeoutMs: 2000 }).fetchOutline(3300936), /Não foi possível falar com o IBGE|demorou demais/);
  const calls = [];
  const fake = createMalha({ fetch: async (url, opts) => { calls.push({ url, opts }); return new Response(JSON.stringify(ibge({ type: 'Polygon', coordinates: [sq] })), { status: 200 }); } });
  assert.equal((await fake.fetchOutline(3300936)).points, 5);
  assert.equal(calls[0].url, 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios/3300936?formato=application%2Fvnd.geo%2Bjson');
  assert.equal(calls[0].opts.redirect, 'error'); assert.deepEqual(Object.keys(calls[0].opts.headers), ['accept']); assert.equal(calls[0].opts.body, undefined);
});

test('mapa travado: a caixa da cidade ocupa a área toda (zoom fracionário), o arrasto não sai dela e os quadros esticados encostam', () => {
  const rio = { south: -23.0828, west: -43.7965, north: -22.7461, east: -43.0969 };
  const v = M.fitBoundsView(rio, 1000, 600, 24);
  assert.ok(v.zoom > 10 && v.zoom < 12 && !Number.isInteger(v.zoom), String(v.zoom));
  const a = M.project(rio.north, rio.west, v.zoom); const b = M.project(rio.south, rio.east, v.zoom); const c = M.project(v.lat, v.lng, v.zoom);
  assert.ok(b.x - a.x <= 952 + 1e-6 && b.y - a.y <= 552 + 1e-6, 'cabe com a margem');
  assert.ok(Math.abs((b.x - a.x) - 952) < 1e-6 || Math.abs((b.y - a.y) - 552) < 1e-6, 'encosta numa das margens: ocupa a área toda');
  assert.ok(Math.abs(c.x - (a.x + b.x) / 2) < 1e-6 && Math.abs(c.y - (a.y + b.y) / 2) < 1e-6, 'a caixa fica no meio');
  // caixa minúscula ou enorme: o zoom fica nos limites; caixa inválida: null
  assert.equal(M.fitBoundsView({ south: -22.90001, west: -43.20001, north: -22.9, east: -43.2 }, 800, 500).zoom, M.MAX_ZOOM);
  assert.equal(M.fitBoundsView({ south: -60, west: -170, north: 70, east: 170 }, 800, 500).zoom, M.MIN_ZOOM);
  for (const bad of [null, {}, { south: 1, west: 1, north: 1, east: 2 }, { south: 0, west: 0, north: NaN, east: 1 }]) assert.equal(M.fitBoundsView(bad, 800, 500), null);

  // a trava: na vista da cidade inteira o centro não sai do meio (a vista é maior que a caixa)
  const far = M.clampCenter({ lat: -10, lng: -60 }, v.zoom, rio, 1000, 600);
  assert.ok(Math.abs(far.lat - v.lat) < 0.05 && Math.abs(far.lng - v.lng) < 0.05, JSON.stringify(far)); // sobra só a margem pequena
  // aproximado: quem está dentro fica onde está; quem arrasta para fora para na borda (com a margem pequena)
  const z = 14;
  const inside = M.clampCenter({ lat: -22.9068, lng: -43.1729 }, z, rio, 1000, 600);
  assert.ok(Math.abs(inside.lat + 22.9068) < 1e-9 && Math.abs(inside.lng + 43.1729) < 1e-9);
  const out = M.clampCenter({ lat: -21, lng: -40 }, z, rio, 1000, 600);
  const edge = M.project(rio.north, rio.east, z); const oc = M.project(out.lat, out.lng, z);
  const box = { w: M.project(rio.south, rio.east, z).x - M.project(rio.north, rio.west, z).x, h: M.project(rio.south, rio.east, z).y - M.project(rio.north, rio.west, z).y };
  assert.ok(oc.x + 500 <= edge.x + Math.max(24, box.w * 0.06) + 1e-6 && oc.x + 500 >= edge.x, 'a borda direita da vista para logo depois da cidade');
  assert.ok(oc.y - 300 >= edge.y - Math.max(24, box.h * 0.06) - 1e-6 && oc.y - 300 <= edge.y, 'a borda de cima também');
  assert.deepEqual(M.clampCenter({ lat: 1, lng: 2 }, 5, null, 800, 500), { lat: 1, lng: 2 }, 'sem trava, o centro pedido');

  // quadros no zoom fracionário: os do zoom inteiro mais próximo, esticados, cobrindo a caixa sem fresta nem sobra de 1 px
  for (const zoom of [10.37, 10.62, 11, 13.5]) {
    const tiles = M.tilesFor({ lat: v.lat, lng: v.lng }, zoom, 1000, 600);
    const tz = Math.round(zoom);
    assert.ok(tiles.every((x) => x.z === tz), `zoom ${zoom} usa os quadros do ${tz}`);
    assert.equal(new Set(tiles.map((x) => x.key)).size, tiles.length);
    const rows = new Map(); for (const x of tiles) { if (!rows.has(x.top)) rows.set(x.top, []); rows.get(x.top).push(x); }
    for (const row of rows.values()) {
      row.sort((p, q) => p.left - q.left);
      assert.ok(row[0].left <= 0 && row.at(-1).left + row.at(-1).size >= 1000, 'cobre a largura');
      for (let i = 1; i < row.length; i++) assert.equal(row[i].left, row[i - 1].left + row[i - 1].size, 'encostados');
    }
    const tops = [...rows.keys()].sort((p, q) => p - q);
    assert.ok(tops[0] <= 0 && tops.at(-1) + rows.get(tops.at(-1))[0].sizeY >= 600, 'cobre a altura');
    for (let i = 1; i < tops.length; i++) assert.equal(tops[i], tops[i - 1] + rows.get(tops[i - 1])[0].sizeY);
    if (Number.isInteger(zoom)) assert.ok(tiles.every((x) => x.size === 256 && x.sizeY === 256));
    else assert.ok(tiles.every((x) => x.size > 256 * 0.7 && x.size < 256 * 1.42));
  }
});

// (removido no DIGITAL ISP: "painel: o município vem do seletor…" conferia o painel/banco do NEXA Broadcast; o passo 3 escreve o equivalente)
