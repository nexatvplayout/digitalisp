// Os layouts de demonstração por conta: só a conta principal por padrão; o superadmin liga e desliga outra revenda, e a
// revenda não liga sozinha. O painel lê a chave em /api/me (demoLayouts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers/tmp.js';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

process.env.DATA_DIR = tmpDir('nexa-demo-contas');

test('demonstração: desligada nas outras contas; o superadmin liga por revenda', { timeout: 300000 }, async (t) => {
  const s = await boot();
  t.after(async () => { await s.stop(); cleanup(s.dataDir); });
  const P = api(s.base, await platformLogin(s.base));
  assert.equal((await P('POST', '/api/platform/plans', { code: 'p-demo', name: 'Demo', priceCents: 0, features: { tvcorp: true } })).status, 201);
  const R = await newTenant(P, s.base, { slug: 'rev-demo', planCode: 'p-demo', status: 'active' });
  const tem = async () => (await R.api('GET', '/api/me')).data.demoLayouts;
  assert.equal(await tem(), false, 'desligada por padrão');
  assert.equal((await P('GET', `/api/platform/tenants/${R.id}/demo`)).data.on, false);
  assert.ok((await R.api('PUT', `/api/platform/tenants/${R.id}/demo`, { on: true })).status >= 401, 'a revenda não liga sozinha');
  assert.equal((await P('PUT', `/api/platform/tenants/${R.id}/demo`, { on: true })).status, 200);
  assert.equal(await tem(), true);
  assert.equal((await P('PUT', `/api/platform/tenants/${R.id}/demo`, { on: false })).status, 200);
  assert.equal(await tem(), false);
});
