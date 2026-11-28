// Os MÓDULOS do plano do cliente final valem: o que o plano da revenda para o cliente desliga some do painel dele
// (planFeatures) e o servidor recusa criar e alterar (clienteRoutes no catálogo); ler continua (as outras telas usam).
// A revenda, com o plano dela da plataforma, segue como antes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers/tmp.js';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

process.env.DATA_DIR = tmpDir('nexa-plano-cliente');

async function entrarCliente(base, slug, acesso) {
  const anon = api(base);
  const l = await anon('POST', '/api/admin/login', { tenant: slug, username: acesso.login, password: acesso.senha });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  const nova = 'senha-nova-da-conta-2026';
  assert.equal((await api(base, l.data.token)('POST', '/api/me/password', { current: acesso.senha, next: nova })).status, 200);
  const l2 = await anon('POST', '/api/admin/login', { tenant: slug, username: acesso.login, password: nova });
  return api(base, l2.data.token);
}

test('plano do cliente final: o módulo desligado some e o servidor recusa criar', { timeout: 300000 }, async (t) => {
  const s = await boot();
  t.after(async () => { await s.stop(); cleanup(s.dataDir); });
  const P = api(s.base, await platformLogin(s.base));
  assert.equal((await P('POST', '/api/platform/plans', { code: 'rev-rh', name: 'Revenda RH', priceCents: 0, features: { tvcorp: true, rh: true, aoVivo: true } })).status, 201);
  const R = await newTenant(P, s.base, { slug: 'prov-rh', planCode: 'rev-rh', status: 'active' });
  const cliente = async (nome, email, modulos) => {
    const pl = await R.api('POST', '/api/revenda/planos', { nome: `Plano ${nome}`, telas: 2, modulos });
    assert.equal(pl.status, 201, JSON.stringify(pl.data));
    const c = await R.api('POST', '/api/revenda/clientes', { name: nome, contactEmail: email, pessoa: 'pj', planoId: pl.data.id });
    assert.equal(c.status, 201, JSON.stringify(c.data));
    return entrarCliente(s.base, c.data.cliente.slug, c.data.acesso);
  };
  const sem = await cliente('Clinica Sem', 'a@clinica.example.com', { tvcorp: true });
  const com = await cliente('Clinica Com', 'b@clinica.example.com', { tvcorp: true, rh: true, aoVivo: true });

  // o painel do cliente recebe o que o plano dele liga
  const me = (await sem('GET', '/api/me')).data;
  assert.match(me.plan.code, /^cliente-/);
  assert.equal(me.planFeatures.rh, false);
  assert.equal(me.planFeatures.aoVivo, false);
  assert.equal((await com('GET', '/api/me')).data.planFeatures.rh, true);

  // sem o módulo: não cria (403 feature_unavailable), mas a lista ainda abre
  const pessoa = { name: 'Maria Teste', birthday: '03-15' };
  const r1 = await sem('POST', '/api/tvcorp/people', pessoa);
  assert.equal(r1.status, 403, JSON.stringify(r1.data));
  assert.equal(r1.data.code, 'feature_unavailable');
  assert.equal((await sem('GET', '/api/tvcorp/people')).status, 200);
  assert.equal((await sem('POST', '/api/hls', { nome: 'Canal', url: 'https://exemplo.test/a.m3u8' })).status, 403);

  // com o módulo: cria
  assert.notEqual((await com('POST', '/api/tvcorp/people', pessoa)).status, 403);
  assert.equal((await com('POST', '/api/hls', { nome: 'Canal', url: 'https://exemplo.test/a.m3u8' })).status, 201);

  // a revenda segue como antes (a regra só vale para o cliente final)
  assert.equal((await R.api('POST', '/api/hls', { nome: 'Canal da revenda', url: 'https://exemplo.test/r.m3u8' })).status, 201);
});
