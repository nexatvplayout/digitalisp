// Os planos no site (GET /api/site/planos, sem login): só os ativos e marcados "Mostrar no site", sem o Ilimitado e sem
// códigos internos de cobrança; os módulos saem pelo nome que o superadmin vê.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers/tmp.js';
import { boot, cleanup, api, platformLogin } from './helpers/srv.js';

process.env.DATA_DIR = tmpDir('nexa-siteplanos');

test('o site mostra os planos ativos e públicos', async (t) => {
  const s = await boot();
  t.after(async () => { await s.stop?.(); cleanup(process.env.DATA_DIR); });
  const anon = api(s.base);
  const P = api(s.base, await platformLogin(s.base));
  const mk = async (code, extra) => {
    const r = await P('POST', '/api/platform/plans', { code, name: `Plano ${code}`, priceCents: 19900, limits: { telas: 10 }, features: { mapa: true }, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };
  await mk('vitrine', { description: 'Para começar.', trialDays: 7 });
  await mk('inativo', { active: false });
  const oculto = await mk('oculto', { public: false });

  const r = await anon('GET', '/api/site/planos');
  assert.equal(r.status, 200);
  const codes = r.data.plans.map((p) => p.code);
  assert.ok(codes.includes('vitrine'));
  for (const c of ['inativo', 'oculto', 'ilimitado']) assert.ok(!codes.includes(c), c);
  const v = r.data.plans.find((p) => p.code === 'vitrine');
  assert.equal(v.priceCents, 19900);
  assert.equal(v.limits.telas, 10);
  assert.equal(v.trialDays, 7);
  assert.ok(v.modules.includes('Mapa das telas'));
  assert.equal(v.gatewayRefs, undefined, 'nada de dados internos de cobrança');

  // marcar "Mostrar no site" pelo superadmin faz o plano aparecer
  assert.equal((await P('PATCH', `/api/platform/plans/${oculto.id}`, { public: true })).status, 200);
  assert.ok((await anon('GET', '/api/site/planos')).data.plans.some((p) => p.code === 'oculto'));
});
