'use strict';
/* O servidor falso cumpre o contrato que o player usa (para o teste no navegador valer alguma coisa). */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.argv.push('--porta=0');
const falso = require('./servidor-falso.js');
let base;

test.before(() => new Promise((ok) => falso.servidor.listen(0, () => { base = 'http://localhost:' + falso.servidor.address().port; ok(); })));
test.after(() => new Promise((ok) => falso.servidor.close(ok)));

const jf = (url, op) => fetch(base + url, op).then(async (r) => ({ status: r.status, json: r.status === 204 || r.status === 304 ? null : await r.json().catch(() => null), r }));

test('código na TV → aprovado no painel → token uma vez só → configuração com ETag', async () => {
  const p = await jf('/api/telas/pair', { method: 'POST', body: JSON.stringify({ device: { model: 'teste' } }) });
  assert.equal(p.status, 200);
  assert.match(p.json.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal((await jf('/api/telas/pair/' + p.json.pairId)).status, 202);
  assert.equal((await jf('/teste/aprovar?code=' + p.json.code)).status, 200);
  const ok = await jf('/api/telas/pair/' + p.json.pairId);
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token);
  assert.equal((await jf('/api/telas/pair/' + p.json.pairId)).status, 404, 'uso único');

  const auth = { headers: { Authorization: 'Bearer ' + ok.json.token } };
  const c = await jf('/api/telas/config', auth);
  assert.equal(c.status, 200);
  assert.ok(c.json.rev);
  assert.ok(c.json.signage.blocks.length >= 2);
  const c2 = await jf('/api/telas/config', { headers: { Authorization: 'Bearer ' + ok.json.token, 'If-None-Match': c.json.rev } });
  assert.equal(c2.status, 304);
  const hb = await jf('/api/telas/heartbeat', { method: 'POST', headers: auth.headers, body: '{}' });
  assert.equal(hb.json.rev, c.json.rev);
  assert.equal((await jf('/api/telas/config')).status, 401);
});

test('arquivos com Range e sha256 que confere', async () => {
  const cfg = falso.montarConfig({ name: 'x' });
  const logo = cfg.brand.logo;
  const tudo = Buffer.from(await (await fetch(logo.url.replace(falso.BASE, base))).arrayBuffer());
  assert.equal(crypto.createHash('sha256').update(tudo).digest('hex'), logo.sha256);
  const r = await fetch(logo.url.replace(falso.BASE, base), { headers: { Range: 'bytes=10-19' } });
  assert.equal(r.status, 206);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), tudo.subarray(10, 20));
});

test('rede cortada: API e arquivos somem', async () => {
  await jf('/teste/rede?on=0');
  await assert.rejects(fetch(base + '/api/telas/config'));
  await jf('/teste/rede?on=1');
  assert.equal((await jf('/api/telas/config')).status, 401);
});
