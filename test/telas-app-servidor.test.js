// NEXA Telas: o APK do app servido pelo próprio servidor (server/telas-app.js, docs/TELAS.md §23): o latest.json, o arquivo,
// o `update` do /api/telas/config quando a prefeitura não definiu outro (e o dela quando definiu), a versão no painel e o
// APK que não confere com o latest.json (nada é oferecido).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { boot, cleanup, api, platformLogin, newTenant } from './helpers/srv.js';
import { canal, usuario } from './helpers/prefeitura.js'; // DIGITAL ISP: canal ao vivo (HLS) e usuário de permissão limitada
import { tmpDir } from './helpers/tmp.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');

test('Prefeitura: APK do app pelo servidor (latest.json, latest.apk, update de fábrica e o da prefeitura)', { timeout: 240000 }, async () => {
  const dir = tmpDir('nexa-telas-app');
  const apk = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(50_000, 7)]); // "APK" de mentira
  fs.writeFileSync(path.join(dir, 'Telas.apk'), apk);
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ versionCode: 8, versionName: '1.2.4', sha256: sha(apk), bytes: apk.length }));
  const s = await boot({ TELAS_APP_DIR: dir });
  try {
    const anon = api(s.base);
    // a versão disponível e o arquivo
    const j = await anon('GET', '/telas/app/latest.json');
    assert.equal(j.status, 200, JSON.stringify(j.data));
    assert.deepEqual({ ...j.data, url: undefined }, { versionCode: 8, versionName: '1.2.4', sha256: sha(apk), bytes: apk.length, url: undefined });
    assert.match(j.data.url, /\/telas\/app\/latest\.apk\?v=8$/);
    const r = await fetch(`${s.base}/telas/app/latest.apk`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/vnd.android.package-archive');
    const got = Buffer.from(await r.arrayBuffer());
    assert.equal(sha(got), sha(apk), 'o arquivo servido é o do latest.json');
    // o kit do pendrive da Philips: ZIP com o mesmo APK e o leia-me
    const z = await fetch(`${s.base}/telas/app/philips-pendrive.zip`);
    assert.equal(z.status, 200);
    assert.equal(z.headers.get('content-type'), 'application/zip');
    assert.match(z.headers.get('content-disposition'), /DIGITAL-ISP-Philips-pendrive-1\.2\.4\.zip/);
    const zb = Buffer.from(await z.arrayBuffer());
    assert.equal(zb.readUInt32LE(0), 0x04034b50);
    const n1 = zb.readUInt16LE(26);
    assert.equal(zb.subarray(30, 30 + n1).toString(), 'DIGITAL-ISP-Telas.apk');
    assert.equal(sha(zb.subarray(30 + n1, 30 + n1 + apk.length)), sha(apk), 'o APK dentro do ZIP é o do latest.json');
    assert.ok(zb.includes(Buffer.from('LEIA-ME.txt')) && zb.includes(Buffer.from('Fontes desconhecidas')));
    assert.ok(zb.includes(Buffer.from('INSTALAR.bat')) && zb.includes(Buffer.from('instalar-philips.ps1')), 'o instalador .bat vai no kit');
    assert.ok(zb.includes(Buffer.from('%~dp0instalar-philips.ps1"\r\n')), 'o .bat com fim de linha do Windows');

    // a tela recebe o update de fábrica (o APK deste servidor)
    const P = api(s.base, await platformLogin(s.base));
    const prof = await P('POST', '/api/platform/feature-profiles', { name: 'Prefeitura', code: 'prefeitura', features: { prefeitura: true } });
    assert.equal((await P('POST', '/api/platform/plans', { code: 'p-pref', name: 'Prefeitura', priceCents: 0, profileId: prof.data.id, limits: { channels: 1 } })).status, 201);
    const A = await newTenant(P, s.base, { slug: 'app-a', planCode: 'p-pref', status: 'active' });
    await canal(A.api, 'TV A'); // DIGITAL ISP: o canal ao vivo (HLS) no lugar do canal do NEXA
    const office = (await A.api('POST', '/api/prefeitura/offices', { name: 'UBS Centro', type: 'ubs' })).data;
    const key = (await A.api('POST', '/api/prefeitura/keys', { officeId: office.id })).data.key;
    const act = await anon('POST', '/api/telas/activate', { key, device: { model: 'TV Box de teste' } });
    assert.equal(act.status, 200, JSON.stringify(act.data));
    const T = (m, u, b) => anon(m, u, b, { authorization: `Bearer ${act.data.token}` });
    let cfg = (await T('GET', '/api/telas/config')).data;
    assert.deepEqual(cfg.update, { url: j.data.url, sha256: sha(apk), versionCode: 8 }, 'sem padrão da prefeitura: o APK do servidor');
    // o painel mostra a versão disponível
    const view = (await A.api('GET', '/api/prefeitura')).data;
    assert.equal(view.appLatest.versionName, '1.2.4'); assert.equal(view.appLatest.versionCode, 8);
    // a prefeitura que define a dela vence
    const mine = { url: 'https://dl.exemplo.test/telas.apk', sha256: 'c'.repeat(64), versionCode: 9 };
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { update: mine })).status, 200);
    cfg = (await T('GET', '/api/telas/config')).data;
    assert.deepEqual(cfg.update, mine);
    assert.equal((await A.api('PUT', '/api/prefeitura/defaults', { update: null })).status, 200);
    assert.equal((await T('GET', '/api/telas/config')).data.update.versionCode, 8, 'tirou a dela: volta o do servidor');

    // APK trocado sem atualizar o latest.json: o SHA-256 não confere e nada é oferecido
    fs.writeFileSync(path.join(dir, 'Telas.apk'), Buffer.concat([apk.subarray(0, apk.length - 1), Buffer.from([9])]));
    const later = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'Telas.apk'), later, later);
    assert.equal((await anon('GET', '/telas/app/latest.json')).status, 404);
    assert.equal((await fetch(`${s.base}/telas/app/latest.apk`)).status, 404);
    assert.equal('update' in (await T('GET', '/api/telas/config')).data, false);
  } finally {
    await s.stop(); cleanup(s.dataDir); cleanup(dir);
  }
});
