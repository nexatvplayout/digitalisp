// A revenda vê as TELAS de cada cliente final (botão Telas na lista de Clientes) e gera a chave de uma tela nova dele:
// a tela ativada com essa chave aparece na lista; o limite do plano do cliente vale; cliente de outra revenda dá 404.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers/tmp.js';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

process.env.DATA_DIR = tmpDir('nexa-rev-telas');

async function entrarCliente(base, slug, acesso) {
  const anon = api(base);
  const l = await anon('POST', '/api/admin/login', { tenant: slug, username: acesso.login, password: acesso.senha });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  const nova = 'senha-nova-da-conta-2026';
  assert.equal((await api(base, l.data.token)('POST', '/api/me/password', { current: acesso.senha, next: nova })).status, 200);
  const l2 = await anon('POST', '/api/admin/login', { tenant: slug, username: acesso.login, password: nova });
  return api(base, l2.data.token);
}

test('revenda: as telas do cliente e a chave de uma tela nova', { timeout: 300000 }, async (t) => {
  const s = await boot();
  t.after(async () => { await s.stop(); cleanup(s.dataDir); });
  const P = api(s.base, await platformLogin(s.base));
  assert.equal((await P('POST', '/api/platform/plans', { code: 'rev-tv', name: 'Revenda TV', priceCents: 0, features: { tvcorp: true } })).status, 201);
  const R = await newTenant(P, s.base, { slug: 'prov-t', planCode: 'rev-tv', status: 'active' });
  const R2 = await newTenant(P, s.base, { slug: 'prov-u', planCode: 'rev-tv', status: 'active' });
  const plano = await R.api('POST', '/api/revenda/planos', { nome: 'Duas telas', telas: 2, modulos: { tvcorp: true } });
  assert.equal(plano.status, 201, JSON.stringify(plano.data));
  const novo = await R.api('POST', '/api/revenda/clientes', { name: 'Lanchonete Teste', contactEmail: 'dono@lanche.example.com', pessoa: 'pj', planoId: plano.data.id });
  assert.equal(novo.status, 201, JSON.stringify(novo.data));
  const id = novo.data.cliente.id;
  const C = await entrarCliente(s.base, novo.data.cliente.slug, novo.data.acesso);

  // sem telas e sem unidade: a chave pede a unidade
  let d = await R.api('GET', `/api/revenda/clientes/${id}/telas`);
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.deepEqual([d.data.telas, d.data.unidades, d.data.chaves], [[], [], []]);
  assert.equal((await R.api('POST', `/api/revenda/clientes/${id}/telas/chave`, { officeId: 999 })).status, 400);

  // o cliente cadastra a unidade; a revenda gera a chave e a TV ativa com ela
  const o = await C('POST', '/api/tvcorp/rede/offices', { name: 'Loja Centro', type: 'outro' });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  const k = await R.api('POST', `/api/revenda/clientes/${id}/telas/chave`, { officeId: o.data.id, name: 'Balcão' });
  assert.equal(k.status, 201, JSON.stringify(k.data));
  assert.equal(k.data.unidade, 'Loja Centro');
  d = await R.api('GET', `/api/revenda/clientes/${id}/telas`);
  assert.deepEqual(d.data.chaves.map((x) => [x.nome, x.unidade]), [['Balcão', 'Loja Centro']]);
  const act = await api(s.base)('POST', '/api/telas/activate', { key: k.data.key, device: { model: 'TV de teste' } });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  d = await R.api('GET', `/api/revenda/clientes/${id}/telas`);
  assert.deepEqual(d.data.telas.map((x) => [x.name, x.unidade]), [['Balcão', 'Loja Centro']]);
  assert.equal(d.data.chaves.length, 0, 'a chave usada sai da lista');

  // o limite do plano do cliente (2 telas, contando as chaves esperando)
  assert.equal((await R.api('POST', `/api/revenda/clientes/${id}/telas/chave`, { officeId: o.data.id })).status, 201);
  assert.equal((await R.api('POST', `/api/revenda/clientes/${id}/telas/chave`, { officeId: o.data.id })).status, 402);

  // outra revenda não vê nem gera
  assert.equal((await R2.api('GET', `/api/revenda/clientes/${id}/telas`)).status, 404);
  assert.equal((await R2.api('POST', `/api/revenda/clientes/${id}/telas/chave`, { officeId: o.data.id })).status, 404);
});
