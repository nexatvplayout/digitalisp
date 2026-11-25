// NEXA Telas: o município da prefeitura no servidor de verdade (server/telas.js, server/telas-malha.js; docs/TELAS.md §6), nos
// dois bancos (SQLite e Postgres, o mesmo roteiro): salvar o município pela lista do IBGE (código inválido, de outra UF ou
// fora da lista = 400, sem pedido nenhum ao IBGE), o contorno buscado UMA vez e guardado com a caixa envolvente (simplificado
// quando é grande), a falha do IBGE (500, demora, resposta que não é contorno) que não derruba nada (o município fica salvo,
// "tentar de novo" resolve depois), o isolamento entre clientes, a permissão prefeitura.manage e o freio do tentar de novo.
// O IBGE aqui é um servidor HTTP local (TELAS_IBGE_URL): o teste nunca depende da internet.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpDir } from './helpers/tmp.js'; // pastas nexa-* apagadas no fim, mesmo com o teste falhando
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';
import { canal, usuario, auditoria } from './helpers/prefeitura.js'; // DIGITAL ISP: canal ao vivo (HLS) e usuário de permissão limitada

process.env.DATA_DIR = tmpDir('nexa-telasmun');
const { OUTLINE, countPoints, pointInOutline } = await import('../public/shared/telas-geo.js');

const square = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const coast = (cx, cy, r, n) => { const out = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; const rr = r * (1 + 0.02 * Math.sin(37 * a) + 0.006 * Math.sin(611 * a) + 0.002 * Math.sin(4999 * a)); out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); } out.push(out[0].slice()); return out; };
const fc = (geometry, code) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: { codarea: String(code) } }] });
// códigos de verdade da lista do IBGE (public/shared/municipios-ibge.json)
const CARAPEBUS = 3300936; const RIO = 3304557; const SAO_LUIS = 2111300; const SAO_PAULO = 3550308; const CURITIBA = 4106902;

/** O "IBGE" do teste: responde a malha de cada código como o serviço de verdade (ou falha de propósito) e anota os pedidos. */
async function fakeIbge(t) {
  const seen = []; const state = { down: new Set([SAO_LUIS]) };
  const srv = http.createServer((req, res) => {
    const code = Number(/\/malhas\/(\d+)\?/.exec(req.url)?.[1]);
    seen.push({ url: req.url, code, headers: req.headers });
    const json = (obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/vnd.geo+json; charset=utf-8' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
    if (state.down.has(code)) return json({ erro: 'interno' }, 500);
    if (code === CARAPEBUS) return json(fc({ type: 'Polygon', coordinates: [square(-41.8, -22.3, -41.5, -22.1)] }, code));
    if (code === SAO_LUIS) return json(fc({ type: 'MultiPolygon', coordinates: [[square(-44.4, -2.8, -44.1, -2.4)], [square(-44.05, -2.6, -44.0, -2.55)]] }, code));
    if (code === RIO) return json(fc({ type: 'MultiPolygon', coordinates: [[coast(-43.45, -22.92, 0.3, 40000), square(-43.5, -22.95, -43.45, -22.9)], [square(-43.05, -22.8, -43.0, -22.75)]] }, code));
    if (code === SAO_PAULO) return undefined; // nunca responde: o servidor desiste no prazo
    if (code === CURITIBA) return json(fc({ type: 'LineString', coordinates: square(-49.4, -25.6, -49.2, -25.3) }, code));
    return json({ erro: 'não achado' }, 404);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections?.(); srv.close(); });
  return { url: `http://127.0.0.1:${srv.address().port}/malhas`, seen, state, hits: (code) => seen.filter((x) => x.code === code).length };
}

async function roteiro(t, s, ibge) {
  const anon = api(s.base);
  const P = api(s.base, await platformLogin(s.base));
  const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true } });
  assert.equal(prof.status, 201, JSON.stringify(prof.data));
  assert.equal((await P('POST', '/api/platform/plans', { code: 'p-mun', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
  const A = await newTenant(P, s.base, { slug: 'mun-a', planCode: 'p-mun', status: 'active' });
  const B = await newTenant(P, s.base, { slug: 'mun-b', planCode: 'p-mun', status: 'active' });
  const put = (T, body) => T.api('PUT', '/api/prefeitura/municipio', body);
  // o Superadmin: o único que troca ou tira o município depois do primeiro cadastro
  const sa = (T, body) => P('PUT', `/api/platform/tenants/${T.id}/telas-municipio`, body);
  const mun = async (T) => { const r = await T.api('GET', '/api/prefeitura'); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.municipio; };

  /* ---- antes de escolher: nada (o painel mostra o pedido da escolha) */
  assert.equal(await mun(A), null); assert.equal(await mun(B), null);
  assert.deepEqual((await A.api('GET', '/api/prefeitura/municipio')).data, { municipio: null });
  assert.equal((await A.api('POST', '/api/prefeitura/municipio/outline', {})).status, 409, 'tentar de novo sem município');

  /* ---- permissão: sem sessão 401; sem prefeitura.manage 403; grupo limitado a um canal 403 */
  await canal(A.api, 'TV Prefeitura A'); // DIGITAL ISP: o canal ao vivo (HLS) no lugar do canal do NEXA
  for (const [m, u, b] of [['GET', '/api/prefeitura/municipio'], ['PUT', '/api/prefeitura/municipio', { uf: 'RJ', ibge: CARAPEBUS }], ['POST', '/api/prefeitura/municipio/outline', {}], ['DELETE', '/api/prefeitura/municipio']]) assert.equal((await anon(m, u, b)).status, 401, `${m} ${u} sem sessão`);
  // DIGITAL ISP: sem a tela de usuários do NEXA, os usuários de permissão limitada nascem no banco (test/helpers/prefeitura.js)
  await usuario(s, A.id, { username: 'semtelas.m', password: 'senha-sem-telas-123', permissions: ['tvcorp.manage'] });
  const V = api(s.base, (await anon('POST', '/api/admin/login', { tenant: 'mun-a', username: 'semtelas.m', password: 'senha-sem-telas-123' })).data.token);
  await usuario(s, A.id, { username: 'umcanal.m', password: 'senha-um-canal-1234', permissions: ['prefeitura.manage'], channels: ['mun-a-tv'] });
  const L = api(s.base, (await anon('POST', '/api/admin/login', { tenant: 'mun-a', username: 'umcanal.m', password: 'senha-um-canal-1234' })).data.token);
  for (const U of [V, L]) {
    assert.equal((await U('GET', '/api/prefeitura/municipio')).status, 403);
    assert.equal((await U('PUT', '/api/prefeitura/municipio', { uf: 'RJ', ibge: CARAPEBUS })).status, 403);
    assert.equal((await U('POST', '/api/prefeitura/municipio/outline', {})).status, 403);
    assert.equal((await U('DELETE', '/api/prefeitura/municipio')).status, 403);
  }
  assert.equal(await mun(A), null, 'ninguém sem permissão gravou');

  /* ---- código inválido: 400 com a mensagem, e nenhum pedido chega ao IBGE */
  const bad = [
    {}, { uf: 'RJ' }, { ibge: CARAPEBUS }, { uf: 'RJ', ibge: 123 }, { uf: 'RJ', ibge: 9999999 }, { uf: 'RJ', ibge: 'abc' }, { uf: 'RJ', ibge: 3300936.5 }, { uf: 'RJ', ibge: '3300936/../1' },
    { uf: 'SP', ibge: CARAPEBUS }, { uf: 'XX', ibge: CARAPEBUS }, { uf: 'RJ', city: 'Cidade Que Não Existe' }, { uf: 'RJ', ibge: -3300936 },
  ];
  for (const b of bad) { const r = await put(A, b); assert.equal(r.status, 400, `${JSON.stringify(b)}: ${JSON.stringify(r.data)}`); assert.match(r.data.error, /Município/); }
  assert.equal(ibge.seen.length, 0, 'nada foi pedido ao IBGE');
  assert.equal(await mun(A), null);

  /* ---- salvar: o nome e a UF vêm da lista do IBGE, o contorno é buscado e guardado com a caixa */
  const first = await put(A, { uf: 'rj', ibge: String(CARAPEBUS) });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const m = first.data.municipio;
  assert.deepEqual([m.ibge, m.name, m.uf], [CARAPEBUS, 'Carapebus', 'RJ']);
  assert.equal(m.outline.status, 'ok'); assert.equal(m.outline.error, null); assert.equal(m.outline.points, 5); assert.ok(m.outline.at > 0);
  assert.deepEqual(m.outline.polygons, [[square(-41.8, -22.3, -41.5, -22.1)]]);
  assert.deepEqual(m.bbox, { south: -22.3, west: -41.8, north: -22.1, east: -41.5 });
  assert.equal(m.updatedBy, 'admin.mun-a');
  // do cliente só saiu o código do município: nada de sessão, nome do cliente ou repartição
  assert.equal(ibge.seen.length, 1);
  assert.equal(ibge.seen[0].url, `/malhas/${CARAPEBUS}?formato=application%2Fvnd.geo%2Bjson`);
  for (const h of ['cookie', 'authorization', 'x-admin-token', 'referer', 'origin']) assert.equal(ibge.seen[0].headers[h], undefined, h);
  assert.ok(!/mun-a|Cliente|admin/.test(JSON.stringify(ibge.seen[0])), 'nada do cliente no pedido');
  // fica guardado: o painel recebe o contorno do banco, sem novo pedido ao IBGE
  assert.deepEqual(await mun(A), m); assert.deepEqual((await A.api('GET', '/api/prefeitura/municipio')).data.municipio, m);
  assert.equal((await put(A, { uf: 'RJ', ibge: CARAPEBUS })).data.municipio.outline.at, m.outline.at, 'salvar o mesmo município não busca de novo');
  assert.equal((await put(A, { uf: 'RJ', city: 'carapebus' })).data.municipio.ibge, CARAPEBUS, 'pelo nome dentro da UF (sem acento nem caixa)');
  assert.equal(ibge.seen.length, 1);

  /* ---- isolamento: o município de um cliente não aparece nem muda no outro */
  assert.equal(await mun(B), null);
  // falha do IBGE (500): o município fica salvo, sem contorno e com o motivo; nada cai
  const fb = await put(B, { uf: 'MA', ibge: SAO_LUIS });
  assert.equal(fb.status, 200, JSON.stringify(fb.data));
  assert.deepEqual([fb.data.municipio.ibge, fb.data.municipio.name, fb.data.municipio.uf], [SAO_LUIS, 'São Luís', 'MA']);
  assert.equal(fb.data.municipio.outline.status, 'missing'); assert.equal(fb.data.municipio.outline.polygons, null); assert.equal(fb.data.municipio.bbox, null);
  assert.match(fb.data.municipio.outline.error, /O IBGE respondeu 500/); assert.ok(fb.data.municipio.outline.triedAt > 0);
  assert.equal((await mun(B)).name, 'São Luís'); assert.equal((await B.api('GET', '/api/prefeitura')).status, 200, 'o painel continua abrindo');
  assert.deepEqual(await mun(A), m, 'o cliente A segue com o dele');
  // "tentar de novo": ainda falha (200 com ok: false), depois o IBGE volta e o contorno é guardado
  const again = await B.api('POST', '/api/prefeitura/municipio/outline', {});
  assert.equal(again.status, 200); assert.equal(again.data.ok, false); assert.equal(again.data.municipio.outline.status, 'missing');
  ibge.state.down.clear();
  const fixed = await B.api('POST', '/api/prefeitura/municipio/outline', {});
  assert.equal(fixed.status, 200); assert.equal(fixed.data.ok, true);
  assert.equal(fixed.data.municipio.outline.status, 'ok'); assert.equal(fixed.data.municipio.outline.error, null); assert.equal(fixed.data.municipio.outline.polygons.length, 2);
  assert.deepEqual(fixed.data.municipio.bbox, { south: -2.8, west: -44.4, north: -2.4, east: -44.0 });
  assert.equal(ibge.hits(SAO_LUIS), 3);
  // um contorno bom não se perde numa nova tentativa que falha
  ibge.state.down.add(SAO_LUIS);
  const keep = await B.api('POST', '/api/prefeitura/municipio/outline', {});
  assert.equal(keep.data.ok, false); assert.equal(keep.data.municipio.outline.status, 'ok'); assert.deepEqual(keep.data.municipio.bbox, fixed.data.municipio.bbox);
  assert.match(keep.data.municipio.outline.error, /500/, 'o erro da última tentativa fica anotado');
  ibge.state.down.clear();

  /* ---- o contorno que o PAINEL busca no IBGE e manda (o IBGE não responde a servidores fora do Brasil): mesmo crivo */
  const sq = (w, so, e, n) => ({ type: 'Polygon', coordinates: [[[w, so], [e, so], [e, n], [w, n], [w, so]]] });
  const before = ibge.seen.length;
  const sent = await B.api('POST', '/api/prefeitura/municipio/outline', { geojson: sq(-44.5, -2.9, -44.1, -2.5) });
  assert.equal(sent.status, 200, JSON.stringify(sent.data)); assert.equal(sent.data.ok, true);
  assert.deepEqual(sent.data.municipio.bbox, { south: -2.9, west: -44.5, north: -2.5, east: -44.1 }); assert.equal(sent.data.municipio.outline.status, 'ok');
  assert.equal(ibge.seen.length, before, 'com o contorno enviado, o servidor não chama o IBGE');
  const abroad = await B.api('POST', '/api/prefeitura/municipio/outline', { geojson: sq(2.2, 48.8, 2.4, 48.9) });
  assert.equal(abroad.data.ok, false); assert.match(abroad.data.municipio.outline.error, /fora do Brasil/);
  assert.deepEqual(abroad.data.municipio.bbox, sent.data.municipio.bbox, 'o recusado não troca o que estava guardado');
  const junk = await B.api('POST', '/api/prefeitura/municipio/outline', { geojson: { type: 'Point', coordinates: [-44, -2] } });
  assert.equal(junk.data.ok, false); assert.match(junk.data.municipio.outline.error, /não é um contorno/);

  /* ---- trocar de município: o contorno antigo sai e o novo, grande, chega simplificado (teto de pontos) */
  // travado no primeiro cadastro: o cliente não troca nem tira; o Superadmin troca
  const locked = await put(A, { uf: 'RJ', ibge: RIO });
  assert.equal(locked.status, 403, JSON.stringify(locked.data)); assert.equal(locked.data.code, 'municipio_locked'); assert.match(locked.data.error, /travado/);
  assert.equal((await A.api('DELETE', '/api/prefeitura/municipio')).status, 403);
  assert.deepEqual(await mun(A), m, 'a recusa não mexe em nada');
  assert.equal((await A.api('PUT', `/api/platform/tenants/${A.id}/telas-municipio`, { uf: 'RJ', ibge: RIO })).status >= 401, true, 'a rota do Superadmin não abre para o cliente');
  assert.deepEqual((await P('GET', `/api/platform/tenants/${A.id}/telas-municipio`)).data.municipio, m);
  assert.equal((await P('PUT', '/api/platform/tenants/999999/telas-municipio', { uf: 'RJ', ibge: RIO })).status, 404);
  const rio = (await sa(A, { uf: 'RJ', ibge: RIO })).data.municipio;
  assert.deepEqual([rio.ibge, rio.name, rio.uf, rio.outline.status], [RIO, 'Rio de Janeiro', 'RJ', 'ok']);
  assert.ok(rio.outline.points <= OUTLINE.maxPoints && rio.outline.points > 500 && rio.outline.points === countPoints(rio.outline.polygons), String(rio.outline.points));
  assert.ok(Math.abs(rio.bbox.west + 43.756) < 0.02 && Math.abs(rio.bbox.east + 43.0) < 0.02 && rio.bbox.south < -23.2 && rio.bbox.north > -22.65, JSON.stringify(rio.bbox));
  assert.equal(pointInOutline(-22.8, -43.3, rio.outline.polygons), true); assert.equal(pointInOutline(-22.92, -43.47, rio.outline.polygons), false, 'o buraco continua'); assert.equal(pointInOutline(-22.78, -43.02, rio.outline.polygons), true, 'a ilha continua');
  assert.ok(JSON.stringify(rio).length < 120000, 'o que vai ao painel fica pequeno');
  assert.deepEqual(await mun(A), rio);

  /* ---- IBGE que não responde e resposta que não é contorno: o município novo fica salvo, sem o contorno do anterior */
  const slow = await sa(A, { uf: 'SP', ibge: SAO_PAULO });
  assert.equal(slow.status, 200, JSON.stringify(slow.data));
  assert.deepEqual([slow.data.municipio.name, slow.data.municipio.outline.status, slow.data.municipio.bbox, slow.data.municipio.outline.polygons], ['São Paulo', 'missing', null, null]);
  assert.match(slow.data.municipio.outline.error, /demorou demais/);
  const weird = await sa(A, { uf: 'PR', ibge: CURITIBA });
  assert.equal(weird.data.municipio.name, 'Curitiba'); assert.equal(weird.data.municipio.outline.status, 'missing'); assert.match(weird.data.municipio.outline.error, /não é um contorno/);
  assert.equal((await A.api('GET', '/api/prefeitura')).status, 200);
  // o resto do painel segue funcionando com o município sem contorno
  const office = await A.api('POST', '/api/prefeitura/offices', { name: 'Escola Centro', type: 'escola', lat: -25.43, lng: -49.27 });
  assert.equal(office.status, 201, JSON.stringify(office.data));

  /* ---- o freio do "tentar de novo" (6 por minuto por cliente) não segura o outro cliente */
  let limited = 0;
  for (let i = 0; i < 8; i++) { const r = await A.api('POST', '/api/prefeitura/municipio/outline', {}); if (r.status === 429) limited++; else assert.equal(r.status, 200); }
  assert.ok(limited >= 2, `freio: ${limited}`);
  assert.equal((await B.api('POST', '/api/prefeitura/municipio/outline', {})).status, 200);

  /* ---- tirar o município: volta ao estado vazio só naquele cliente */
  assert.equal((await P('DELETE', `/api/platform/tenants/${A.id}/telas-municipio`)).status, 200);
  assert.equal(await mun(A), null); assert.equal((await mun(B)).ibge, SAO_LUIS);
  assert.equal((await P('DELETE', `/api/platform/tenants/${A.id}/telas-municipio`)).status, 200, 'tirar de novo não é erro');
  assert.equal((await put(A, { uf: 'RJ', ibge: CARAPEBUS })).status, 200, 'sem município, o cliente define de novo (e trava de novo)');
  assert.equal((await put(A, { uf: 'RJ', ibge: RIO })).status, 403);
  assert.equal((await P('DELETE', `/api/platform/tenants/${A.id}/telas-municipio`)).status, 200);
  // e a auditoria do cliente registra a escolha (sem nada além do nome do município)
  // DIGITAL ISP: sem a tela de auditoria do cliente, a leitura é direto no banco (as linhas da conta dele)
  const txt = JSON.stringify(await auditoria(s, A.id));
  assert.match(txt, /município das telas definido: Carapebus\/RJ \(contorno guardado\); fica travado/);
  assert.doesNotMatch(txt, /São Paulo/, 'a troca feita pelo Superadmin fica na auditoria da plataforma, não na do cliente');
}

test('SQLite: município da prefeitura, contorno guardado, falha do IBGE, isolamento e permissão', { timeout: 300000 }, async (t) => {
  const ibge = await fakeIbge(t);
  const s = await boot({ TELAS_IBGE_URL: ibge.url, TELAS_IBGE_TIMEOUT_MS: '1200' });
  try { await roteiro(t, s, ibge); } finally { await s.stop(); cleanup(s.dataDir); }
});

test('Postgres: o mesmo roteiro do município (a tabela nasce no banco, a caixa em DOUBLE PRECISION, ON CONFLICT pelo cliente)', { timeout: 300000 }, async (t) => {
  const { startPg } = await import('./helpers/pg.js');
  const { createPg } = await import('../server/db/pg.js');
  let pgs;
  try { pgs = await startPg(); } catch (err) { t.skip(`Postgres embutido indisponível: ${err.message}`); return; }
  let s = null; let db = null;
  try {
    const ibge = await fakeIbge(t);
    s = await boot({ DATABASE_URL: pgs.url, TELAS_IBGE_URL: ibge.url, TELAS_IBGE_TIMEOUT_MS: '1200' });
    await roteiro(t, s, ibge);
    db = await createPg(pgs.url, { max: 2 });
    const cols = await db.all("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'telas_municipio'");
    const type = (c) => cols.find((x) => x.column_name === c)?.data_type;
    assert.equal(type('tenant_id'), 'bigint'); assert.equal(type('south'), 'double precision'); assert.equal(type('outline'), 'text'); assert.equal(type('outline_at'), 'bigint');
    const rows = await db.all('SELECT tenant_id, ibge, name, uf, south, outline_points FROM telas_municipio');
    assert.equal(rows.length, 1, 'uma linha por cliente (o A tirou o dele)');
    assert.deepEqual([Number(rows[0].ibge), rows[0].name, rows[0].uf, Number(rows[0].south)], [2111300, 'São Luís', 'MA', -2.8]);
  } finally {
    if (db) await db.close().catch(() => {});
    if (s) { await s.stop(); cleanup(s.dataDir); }
    await pgs.stop().catch(() => {});
  }
});
