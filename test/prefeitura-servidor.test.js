// Prefeitura (modo órgão público) nos níveis do DIGITAL ISP: plataforma → revenda → cliente final → telas.
// A plataforma liga o modo no plano da revenda; a revenda oferece o módulo nos planos dos clientes dela; o cliente final
// (a prefeitura) usa o Painel da Prefeitura (/api/prefeitura), que recusa quem não tem o modo (403 feature_unavailable).
// O município da prefeitura trava no primeiro cadastro; trocar ou tirar é da revenda dela e da plataforma (server/prefeitura.js).
// O IBGE aqui é um servidor HTTP local (TELAS_IBGE_URL): o teste nunca depende da internet.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers/tmp.js';
import { boot, cleanup, api, platformLogin, newTenant, root } from './helpers/srv.js';
import { canal, usuario } from './helpers/prefeitura.js';

process.env.DATA_DIR = tmpDir('nexa-prefeitura');
const CARAPEBUS = 3300936; const RIO = 3304557;
const square = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

async function fakeIbge(t) {
  const srv = http.createServer((req, res) => {
    const code = Number(/\/malhas\/(\d+)\?/.exec(req.url)?.[1]);
    const box = { [CARAPEBUS]: [-41.8, -22.3, -41.5, -22.1], [RIO]: [-43.8, -23.1, -43.1, -22.7] }[code];
    res.writeHead(box ? 200 : 404, { 'content-type': 'application/vnd.geo+json; charset=utf-8' });
    res.end(JSON.stringify(box ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [square(...box)] }, properties: { codarea: String(code) } }] } : { erro: 'não achado' }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections?.(); srv.close(); });
  return `http://127.0.0.1:${srv.address().port}/malhas`;
}

/** Entra como o cliente final (a senha inicial pede a troca) e devolve o api() com a sessão. */
async function entrarCliente(base, slug, acesso) {
  const anon = api(base);
  const l = await anon('POST', '/api/admin/login', { tenant: slug, username: acesso.login, password: acesso.senha });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  const nova = 'senha-nova-da-prefeitura-2026';
  const t = await api(base, l.data.token)('POST', '/api/me/password', { current: acesso.senha, next: nova });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const l2 = await anon('POST', '/api/admin/login', { tenant: slug, username: acesso.login, password: nova });
  assert.equal(l2.status, 200, JSON.stringify(l2.data));
  return api(base, l2.data.token);
}

test('prefeitura: plataforma → revenda → cliente → telas, permissões e o município travado', { timeout: 300000 }, async (t) => {
  const s = await boot({ TELAS_IBGE_URL: await fakeIbge(t), TELAS_IBGE_TIMEOUT_MS: '1500' });
  t.after(async () => { await s.stop(); cleanup(s.dataDir); });
  const anon = api(s.base);
  const P = api(s.base, await platformLogin(s.base));

  /* ---- plataforma: o modo órgão público no plano da revenda (optIn: só ligado de propósito) */
  assert.equal((await P('POST', '/api/platform/plans', { code: 'rev-pref', name: 'Revenda com prefeitura', priceCents: 0, features: { prefeitura: true } })).status, 201);
  assert.equal((await P('POST', '/api/platform/plans', { code: 'rev-sem', name: 'Revenda sem prefeitura', priceCents: 0, features: {} })).status, 201);
  const R = await newTenant(P, s.base, { slug: 'prov-pref', planCode: 'rev-pref', status: 'active' });
  const R2 = await newTenant(P, s.base, { slug: 'prov-sem', planCode: 'rev-sem', status: 'active' });

  /* ---- revenda: o módulo aparece nos planos dos clientes só quando o plano dela tem */
  const mods = (r) => r.data.disponiveis.flatMap((x) => x.modulos);
  const dispR = await R.api('GET', '/api/revenda/planos');
  assert.equal(dispR.status, 200, JSON.stringify(dispR.data));
  assert.equal(mods(dispR).find((m) => m.key === 'prefeitura')?.liberado, true, 'a revenda com o modo oferece aos clientes');
  assert.equal(mods(await R2.api('GET', '/api/revenda/planos')).some((m) => m.key === 'prefeitura'), false, 'sem o modo no plano: nem aparece');
  const pPref = await R.api('POST', '/api/revenda/planos', { nome: 'Prefeitura', telas: 20, modulos: { prefeitura: true } });
  assert.equal(pPref.status, 201, JSON.stringify(pPref.data)); assert.equal(pPref.data.modulos.prefeitura, true);
  const pComum = await R.api('POST', '/api/revenda/planos', { nome: 'Comércio', telas: 5, modulos: {} });
  const pSem = await R2.api('POST', '/api/revenda/planos', { nome: 'Tentativa', telas: 5, modulos: { prefeitura: true } });
  assert.equal(pSem.data.modulos.prefeitura, false, 'a revenda não dá o que não tem');

  const novo = async (T, nome, email, planoId) => {
    const r = await T.api('POST', '/api/revenda/clientes', { name: nome, contactEmail: email, pessoa: 'pj', planoId });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return { id: r.data.cliente.id, slug: r.data.cliente.slug, api: await entrarCliente(s.base, r.data.cliente.slug, r.data.acesso) };
  };
  const C = await novo(R, 'Prefeitura de Carapebus', 'ti@carapebus.example.com', pPref.data.id);
  const loja = await novo(R, 'Loja do Centro', 'dono@loja.example.com', pComum.data.id);
  const outra = await novo(R2, 'Prefeitura Vizinha', 'ti@vizinha.example.com', pSem.data.id);

  /* ---- cliente final: o Painel da Prefeitura só com o modo; o resto recusa com feature_unavailable */
  const me = (await C.api('GET', '/api/me')).data;
  assert.equal(me.planFeatures.prefeitura, true); assert.ok(me.permissions.includes('prefeitura.manage'));
  const pf = await C.api('GET', '/api/prefeitura');
  assert.equal(pf.status, 200, JSON.stringify(pf.data));
  for (const X of [loja, outra]) {
    const r = await X.api('GET', '/api/prefeitura');
    assert.equal(r.status, 403); assert.equal(r.data.code, 'feature_unavailable');
    assert.equal((await X.api('POST', '/api/prefeitura/regions', { name: 'Centro' })).status, 403);
  }
  assert.equal((await anon('GET', '/api/prefeitura')).status, 401);
  // usuário da prefeitura sem a permissão do painel
  await usuario(s, C.id, { username: 'recepcao@carapebus.example.com', password: 'senha-da-recepcao-123', permissions: ['tvcorp.manage'] });
  const semPerm = api(s.base, (await anon('POST', '/api/admin/login', { tenant: C.slug, username: 'recepcao@carapebus.example.com', password: 'senha-da-recepcao-123' })).data.token);
  assert.equal((await semPerm('GET', '/api/prefeitura')).status, 403);
  // a revenda (com o modo) também tem o painel para as próprias telas; a revenda sem o modo não
  assert.equal((await R.api('GET', '/api/prefeitura')).status, 200);
  assert.equal((await R2.api('GET', '/api/prefeitura')).status, 403);

  /* ---- as telas: repartição, chave, ativação e o canal ao vivo da prefeitura (o primeiro, sem escolha) */
  const tv = await canal(C.api, 'TV Carapebus');
  const ubs = await C.api('POST', '/api/prefeitura/offices', { name: 'UBS Centro', type: 'ubs', lat: -22.2, lng: -41.65 });
  assert.equal(ubs.status, 201, JSON.stringify(ubs.data));
  const key = await C.api('POST', '/api/prefeitura/keys', { officeId: ubs.data.id, name: 'UBS, recepção' });
  assert.equal(key.status, 201, JSON.stringify(key.data));
  const act = await anon('POST', '/api/telas/activate', { key: key.data.key, device: { model: 'B13', appVersion: '1.0.0' } });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  const cfg = await anon('GET', '/api/telas/config', undefined, { authorization: `Bearer ${act.data.token}` });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.data));
  assert.equal(cfg.data.stream?.hls, tv.url, 'a repartição sem canal escolhido toca o primeiro canal ao vivo da prefeitura');
  assert.equal(cfg.data.device.office, 'UBS Centro');
  // a revenda vê a tela do cliente na lista dela
  const telasR = await R.api('GET', '/api/revenda/telas');
  assert.equal(telasR.status, 200);
  assert.ok(JSON.stringify(telasR.data).includes('UBS, recepção'), 'a tela da prefeitura aparece para a revenda');
  // o selo do menu
  assert.deepEqual(Object.keys((await C.api('GET', '/api/prefeitura/badge')).data).sort(), ['approvals', 'off']);

  /* ---- o município: travado no primeiro cadastro; a revenda dela e a plataforma trocam ou tiram */
  const set = await C.api('PUT', '/api/prefeitura/municipio', { uf: 'RJ', ibge: CARAPEBUS });
  assert.equal(set.status, 200, JSON.stringify(set.data)); assert.equal(set.data.municipio.name, 'Carapebus'); assert.equal(set.data.municipio.outline.status, 'ok');
  const locked = await C.api('PUT', '/api/prefeitura/municipio', { uf: 'RJ', ibge: RIO });
  assert.equal(locked.status, 403); assert.equal(locked.data.code, 'municipio_locked'); assert.match(locked.data.error, /revenda/);
  const rota = `/api/revenda/clientes/${C.id}/telas-municipio`;
  assert.equal((await R.api('GET', rota)).data.municipio.ibge, CARAPEBUS);
  assert.equal((await R2.api('GET', rota)).status, 404, 'outra revenda não vê');
  assert.equal((await R2.api('PUT', rota, { uf: 'RJ', ibge: RIO })).status, 404);
  assert.equal((await C.api('PUT', rota, { uf: 'RJ', ibge: RIO })).status, 403, 'o cliente não usa a rota da revenda');
  assert.equal((await C.api('PUT', `/api/platform/tenants/${C.id}/telas-municipio`, { uf: 'RJ', ibge: RIO })).status >= 401, true, 'nem a da plataforma');
  const troca = await R.api('PUT', rota, { uf: 'RJ', ibge: RIO });
  assert.equal(troca.status, 200, JSON.stringify(troca.data)); assert.equal(troca.data.municipio.name, 'Rio de Janeiro');
  assert.equal((await C.api('GET', '/api/prefeitura/municipio')).data.municipio.ibge, RIO);
  assert.equal((await P('GET', `/api/platform/tenants/${C.id}/telas-municipio`)).data.municipio.ibge, RIO);
  assert.equal((await P('DELETE', `/api/platform/tenants/${C.id}/telas-municipio`)).status, 200);
  assert.equal((await C.api('GET', '/api/prefeitura/municipio')).data.municipio, null, 'sem município: o painel pede a escolha de novo');
  assert.equal((await P('GET', '/api/platform/tenants/999999/telas-municipio')).status, 404);
  assert.equal((await C.api('PUT', '/api/prefeitura/municipio', { uf: 'RJ', ibge: CARAPEBUS })).status, 200, 'e trava de novo');
  assert.equal((await R.api('DELETE', rota)).status, 200);

  /* ---- o cadastro do cliente mostra à revenda que ele tem o modo (o cartão do município no painel) */
  assert.equal((await R.api('GET', `/api/revenda/clientes/${C.id}`)).data.plano.prefeitura, true);
  assert.equal((await R.api('GET', `/api/revenda/clientes/${loja.id}`)).data.plano.prefeitura, false);

  /* ---- o painel: o menu Prefeitura e a tela vêm na casca */
  const html = fs.readFileSync(path.join(root, 'public', 'admin', 'index.html'), 'utf8');
  assert.ok(html.includes('id="view-prefeitura"') && html.includes('href="#prefeitura/mapa"') && html.includes('id="pfBadge"'));
  for (const f of ['prefeitura.js', 'prefeitura-fase3.js', 'prefeitura-controle.js', 'prefeitura-reparticoes.js', 'prefeitura-municipio.js']) {
    const src = fs.readFileSync(path.join(root, 'public', 'admin', 'views', f), 'utf8');
    assert.ok(!/style\s*:\s*`/.test(src) && !/\.innerHTML\s*=/.test(src), `${f}: sem style inline vindo de script nem innerHTML`);
    assert.ok(!/NEXA Broadcast|window\.NEXA/.test(src.replace(/^\s*\/\/.*$/gm, '')), `${f}: sem a marca de origem no que aparece`);
  }
  const page = await fetch(`${s.base}/admin/`);
  assert.equal(page.status, 200); assert.ok((await page.text()).includes('view-prefeitura'));
});
