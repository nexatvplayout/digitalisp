// A revenda esqueceu a senha: o superadmin gera uma nova (POST /api/platform/tenants/:id/senha). A senha velha deixa de
// valer, a nova entra pelo /admin e pede a troca no primeiro acesso; só a equipe da plataforma chama a rota.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers/tmp.js';
import { boot, cleanup, api, platformLogin } from './helpers/srv.js';

process.env.DATA_DIR = tmpDir('nexa-revsenha');

test('superadmin gera nova senha para a revenda', async (t) => {
  const s = await boot();
  t.after(async () => { await s.stop?.(); cleanup(process.env.DATA_DIR); });
  const anon = api(s.base);
  const P = api(s.base, await platformLogin(s.base));
  const email = 'dono@revenda-senha.example.com';
  const cad = await P('POST', '/api/platform/tenants', { name: 'Revenda Senha', document: '11.222.333/0001-81', contactEmail: email, adminUsername: email, adminPassword: 'senha-antiga-da-revenda-1', mustChange: false, status: 'active' });
  assert.equal(cad.status, 201, JSON.stringify(cad.data));
  const id = cad.data.tenant.id;
  assert.equal((await anon('POST', '/api/admin/login', { username: email, password: 'senha-antiga-da-revenda-1' })).status, 200);

  assert.ok((await anon('POST', `/api/platform/tenants/${id}/senha`, {})).status >= 401, 'sem sessão da plataforma');
  const rev = await anon('POST', '/api/admin/login', { username: email, password: 'senha-antiga-da-revenda-1' });
  assert.ok((await api(s.base, rev.data.token)('POST', `/api/platform/tenants/${id}/senha`, {})).status >= 401, 'a revenda não chama a rota');

  const r = await P('POST', `/api/platform/tenants/${id}/senha`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.login, email);
  assert.ok(r.data.senha.length >= 12);
  assert.equal((await anon('POST', '/api/admin/login', { username: email, password: 'senha-antiga-da-revenda-1' })).status, 401, 'a senha velha deixa de valer');
  const nova = await anon('POST', '/api/admin/login', { username: ` ${email.toUpperCase()} `, password: r.data.senha });
  assert.equal(nova.status, 200, JSON.stringify(nova.data));
  assert.equal(nova.data.user.mustChange, true, 'troca no primeiro acesso');
  assert.equal((await P('POST', '/api/platform/tenants/999999/senha', {})).status, 404);
});
