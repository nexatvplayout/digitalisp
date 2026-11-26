// O canal ao vivo escolhido na zona de vídeo do próprio layout (DIGITAL ISP): vai à TV no `stream` do /config. O canal
// escolhido só para a tela (aba Telas) vence; sem canal no layout nem na tela, vale o da unidade (ou nenhum).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers/tmp.js';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';

process.env.DATA_DIR = tmpDir('nexa-canal-layout');

test('canal ao vivo da zona de vídeo do layout chega à TV', { timeout: 300000 }, async (t) => {
  const s = await boot();
  t.after(async () => { await s.stop(); cleanup(s.dataDir); });
  const ok = async (X, method, url, body, want = 200) => { const r = await X(method, url, body); assert.equal(r.status, want, `${method} ${url}: ${JSON.stringify(r.data)}`); return r.data; };
  const P = api(s.base, await platformLogin(s.base));
  const prof = await ok(P, 'POST', '/api/platform/feature-profiles', { name: 'Empresa', code: 'tvc-canal', features: { tvcorp: true } }, 201);
  await ok(P, 'POST', '/api/platform/plans', { code: 'p-canal', name: 'TV', priceCents: 0, profileId: prof.id, limits: { channels: 1 } }, 201);
  const A = await newTenant(P, s.base, { slug: 'canal-a', planCode: 'p-canal', status: 'active' });

  const um = await ok(A.api, 'POST', '/api/hls', { nome: 'TV do Provedor', url: 'https://tv.exemplo.test/um/index.m3u8' }, 201);
  const dois = await ok(A.api, 'POST', '/api/hls', { nome: 'Câmera da loja', url: 'https://tv.exemplo.test/dois/index.m3u8' }, 201);
  const loja = await ok(A.api, 'POST', '/api/tvcorp/rede/offices', { name: 'Loja Centro', type: 'matriz' }, 201);
  const key = await ok(A.api, 'POST', '/api/tvcorp/rede/keys', { officeId: loja.id, name: 'TV da loja' }, 201);
  const anon = api(s.base);
  const act = await ok(anon, 'POST', '/api/telas/activate', { key: key.key, device: { model: 'AFTKA', android: '9', appVersion: '0.3.4' } });
  const tv = (url) => anon('GET', url, undefined, { authorization: `Bearer ${act.token}` });
  const stream = async () => { const r = await tv('/api/telas/config'); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.stream?.hls ?? null; };

  // o layout com o vídeo ao vivo e o canal escolhido na zona de vídeo
  const lay = await ok(A.api, 'POST', '/api/tvcorp/layouts', { name: 'Ao vivo e lateral', orientation: 'land', zones: [
    { id: 'main', kind: 'video', x: 0, y: 0, w: 70, h: 100, channel: dois.id },
    { id: 'right', kind: 'playlist', x: 70, y: 0, w: 30, h: 100 },
  ] }, 201);
  const salvo = (await ok(A.api, 'GET', '/api/tvcorp/layouts')).layouts?.find((l) => l.id === lay.id) || lay;
  assert.equal(salvo.zones.find((z) => z.id === 'main').channel, dois.id, 'o canal fica guardado na zona');
  assert.equal((await A.api('POST', '/api/tvcorp/layouts', { name: 'Canal ruim', zones: [{ id: 'v', kind: 'video', x: 0, y: 0, w: 100, h: 100, channel: 'abc' }] })).status, 400);

  // sem grade: nenhum canal (a unidade não escolheu)
  assert.equal(await stream(), null);
  await ok(A.api, 'POST', '/api/tvcorp/schedules', { name: 'Todo dia', layoutId: lay.id, scope: { kind: 'all' } }, 201);
  assert.match(JSON.stringify(await stream()), /dois\/index\.m3u8/, 'o canal do layout chega à TV');

  // o canal da tela vence o do layout
  await ok(A.api, 'PUT', `/api/hls/tela/${act.deviceId}`, { hlsId: um.id });
  assert.match(JSON.stringify(await stream()), /um\/index\.m3u8/);
  await ok(A.api, 'PUT', `/api/hls/tela/${act.deviceId}`, { hlsId: null });
  assert.match(JSON.stringify(await stream()), /dois\/index\.m3u8/);
});
