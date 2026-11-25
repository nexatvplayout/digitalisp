// O módulo Prefeitura conta por conta: desligado por padrão em todas as contas (nenhum plano liga sozinho, nem o
// Ilimitado); o superadmin liga para a revenda ou para um cliente final dela, e só aquela conta vê o menu e o Painel da
// Prefeitura. A revenda não liga para ninguém, e não dá para ligar a conta de outra revenda.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers/tmp.js';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

process.env.DATA_DIR = tmpDir('nexa-pref-conta');

async function entrarCliente(base, slug, acesso) {
  const anon = api(base);
  const l = await anon('POST', '/api/admin/login', { tenant: slug, username: acesso.login, password: acesso.senha });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  const nova = 'senha-nova-da-conta-2026';
  assert.equal((await api(base, l.data.token)('POST', '/api/me/password', { current: acesso.senha, next: nova })).status, 200);
  const l2 = await anon('POST', '/api/admin/login', { tenant: slug, username: acesso.login, password: nova });
  assert.equal(l2.status, 200, JSON.stringify(l2.data));
  return api(base, l2.data.token);
}

test('prefeitura: desligada por padrão; o superadmin liga conta por conta', { timeout: 300000 }, async (t) => {
  const s = await boot();
  t.after(async () => { await s.stop(); cleanup(s.dataDir); });
  const P = api(s.base, await platformLogin(s.base));
  // um plano com todos os módulos comuns (como os do site): a Prefeitura não vem junto
  assert.equal((await P('POST', '/api/platform/plans', { code: 'rev-tudo', name: 'Revenda tudo', priceCents: 0, features: { mapa: true, alertas: true, api: true } })).status, 201);
  const R = await newTenant(P, s.base, { slug: 'prov-a', planCode: 'rev-tudo', status: 'active' });
  const R2 = await newTenant(P, s.base, { slug: 'prov-b', planCode: 'rev-tudo', status: 'active' });
  const plano = await R.api('POST', '/api/revenda/planos', { nome: 'Comum', telas: 10, modulos: { mapa: true } });
  assert.equal(plano.status, 201, JSON.stringify(plano.data));
  const novo = async (nome, email) => {
    const r = await R.api('POST', '/api/revenda/clientes', { name: nome, contactEmail: email, pessoa: 'pj', planoId: plano.data.id });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return { id: r.data.cliente.id, api: await entrarCliente(s.base, r.data.cliente.slug, r.data.acesso) };
  };
  const pref = await novo('Prefeitura de Teste', 'ti@pref.example.com');
  const loja = await novo('Loja do Centro', 'dono@loja.example.com');

  const tem = async (X) => (await X('GET', '/api/me')).data.planFeatures?.prefeitura === true;
  for (const [nome, X] of [['revenda', R.api], ['prefeitura', pref.api], ['loja', loja.api]]) {
    assert.equal(await tem(X), false, `${nome}: desligado por padrão`);
    assert.equal((await X('GET', '/api/prefeitura')).status, 403, `${nome}: o painel recusa`);
  }

  const lista = await P('GET', `/api/platform/tenants/${R.id}/prefeitura`);
  assert.equal(lista.status, 200, JSON.stringify(lista.data));
  assert.equal(lista.data.revenda.on, false);
  assert.deepEqual(lista.data.clientes.map((c) => [c.name, c.on]), [['Loja do Centro', false], ['Prefeitura de Teste', false]]);

  // a revenda não liga nada; nem a conta de outra revenda
  assert.ok((await R.api('PUT', `/api/platform/tenants/${R.id}/prefeitura/${pref.id}`, { on: true })).status >= 401);
  assert.equal((await P('PUT', `/api/platform/tenants/${R2.id}/prefeitura/${pref.id}`, { on: true })).status, 404);

  // o superadmin liga só para a prefeitura
  assert.equal((await P('PUT', `/api/platform/tenants/${R.id}/prefeitura/${pref.id}`, { on: true })).status, 200);
  assert.equal(await tem(pref.api), true);
  assert.equal((await pref.api('GET', '/api/prefeitura')).status, 200);
  assert.equal(await tem(loja.api), false, 'a loja continua sem');
  assert.equal(await tem(R.api), false, 'a revenda continua sem');
  assert.equal((await P('GET', `/api/platform/tenants/${R.id}/prefeitura`)).data.clientes.find((c) => c.id === pref.id).on, true);

  // e desliga
  assert.equal((await P('PUT', `/api/platform/tenants/${R.id}/prefeitura/${pref.id}`, { on: false })).status, 200);
  assert.equal(await tem(pref.api), false);
  assert.equal((await pref.api('GET', '/api/prefeitura')).status, 403);
});
