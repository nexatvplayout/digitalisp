// DIGITAL ISP: os pacotes que o instalador pelo celular baixa (server/telas-tv.js): o .wgt (Samsung), o .ipk (LG) e o
// APK do próprio instalador, cada um só quando o tamanho e o SHA-256 conferem com o latest.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import express from 'express';
import { createTvStore, createInstaladorStore } from '../server/telas-tv.js';
import { tmpDir } from './helpers/tmp.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');

async function servidor(stores) {
  const app = express();
  for (const s of stores) s.mount(app, { publicUrl: () => 'https://www.exemplo.test' });
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  return { base: `http://127.0.0.1:${srv.address().port}`, fechar: () => new Promise((ok) => srv.close(ok)) };
}

test('pacotes das TVs: latest.json, .wgt e .ipk conferidos', async () => {
  const dir = tmpDir('nexa-telas-tv');
  const wgt = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(40_000, 3)]);
  const ipk = Buffer.concat([Buffer.from('!<arch>\n'), Buffer.alloc(30_000, 5)]);
  fs.writeFileSync(path.join(dir, 'DigitalISP-1.0.27.wgt'), wgt);
  fs.writeFileSync(path.join(dir, 'br.com.digitalisp.telas_1.0.27_all.ipk'), ipk);
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({
    tizen: { version: '1.0.27', appId: 'DgIspTela1.Telas', file: 'DigitalISP-1.0.27.wgt', sha256: sha(wgt), bytes: wgt.length },
    webos: { version: '1.0.27', appId: 'br.com.digitalisp.telas', file: 'br.com.digitalisp.telas_1.0.27_all.ipk', sha256: sha(ipk), bytes: ipk.length },
  }));
  const s = await servidor([createTvStore({ dir })]);
  try {
    const j = await (await fetch(`${s.base}/telas/tv/latest.json`)).json();
    assert.equal(j.tizen.appId, 'DgIspTela1.Telas');
    assert.equal(j.tizen.version, '1.0.27');
    assert.equal(j.tizen.bytes, wgt.length);
    assert.match(j.tizen.url, /^https:\/\/www\.exemplo\.test\/telas\/tv\/latest\.wgt\?v=[0-9a-f]{12}$/);
    assert.equal(j.webos.file, 'br.com.digitalisp.telas_1.0.27_all.ipk');
    assert.match(j.webos.url, /\/telas\/tv\/latest\.ipk\?v=/);
    const w = await fetch(`${s.base}/telas/tv/latest.wgt`);
    assert.equal(w.status, 200);
    assert.equal(sha(Buffer.from(await w.arrayBuffer())), sha(wgt));
    const i = await fetch(`${s.base}/telas/tv/latest.ipk`);
    assert.equal(sha(Buffer.from(await i.arrayBuffer())), sha(ipk));

    // .ipk trocado sem atualizar o latest.json: some só ele; o .wgt continua
    fs.writeFileSync(path.join(dir, 'br.com.digitalisp.telas_1.0.27_all.ipk'), Buffer.concat([ipk.subarray(0, ipk.length - 1), Buffer.from([9])]));
    const later = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'br.com.digitalisp.telas_1.0.27_all.ipk'), later, later);
    const j2 = await (await fetch(`${s.base}/telas/tv/latest.json`)).json();
    assert.equal(j2.webos, null);
    assert.ok(j2.tizen);
    assert.equal((await fetch(`${s.base}/telas/tv/latest.ipk`)).status, 404);
  } finally {
    await s.fechar();
  }
});

test('pacotes das TVs: sem nada publicado, 404; nome de arquivo com caminho é recusado', async () => {
  const vazio = tmpDir('nexa-telas-tv-vazio');
  const torto = tmpDir('nexa-telas-tv-torto');
  fs.writeFileSync(path.join(torto, 'latest.json'), JSON.stringify({ tizen: { file: '../segredo.wgt', sha256: 'a'.repeat(64), bytes: 1 } }));
  const a = await servidor([createTvStore({ dir: vazio })]);
  const b = await servidor([createTvStore({ dir: torto })]);
  try {
    assert.equal((await fetch(`${a.base}/telas/tv/latest.json`)).status, 404);
    assert.equal((await fetch(`${a.base}/telas/tv/latest.wgt`)).status, 404);
    assert.equal((await fetch(`${b.base}/telas/tv/latest.json`)).status, 404);
  } finally {
    await a.fechar(); await b.fechar();
  }
});

test('instalador: latest.json, o APK e o atalho /instalador', async () => {
  const dir = tmpDir('nexa-instalador');
  const apk = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(20_000, 1)]);
  fs.writeFileSync(path.join(dir, 'DIGITAL-ISP-Instalador.apk'), apk);
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ versionCode: 2, versionName: '0.2.0', file: 'DIGITAL-ISP-Instalador.apk', sha256: sha(apk), bytes: apk.length }));
  const s = await servidor([createInstaladorStore({ dir })]);
  try {
    const j = await (await fetch(`${s.base}/instalador/latest.json`)).json();
    assert.deepEqual(j, { versionCode: 2, versionName: '0.2.0', sha256: sha(apk), bytes: apk.length, url: 'https://www.exemplo.test/instalador/latest.apk?v=2' });
    const r = await fetch(`${s.base}/instalador/latest.apk`);
    assert.equal(r.headers.get('content-type'), 'application/vnd.android.package-archive');
    assert.match(r.headers.get('content-disposition'), /DIGITAL-ISP-Instalador-0\.2\.0\.apk/);
    assert.equal(sha(Buffer.from(await r.arrayBuffer())), sha(apk));
    const atalho = await fetch(`${s.base}/instalador`, { redirect: 'manual' });
    assert.equal(atalho.status, 302);
    assert.equal(atalho.headers.get('location'), '/instalador/latest.apk?v=2');
  } finally {
    await s.fechar();
  }
});
