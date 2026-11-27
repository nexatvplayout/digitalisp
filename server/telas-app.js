/* NEXA Telas: o APK do app das TV box servido pelo próprio servidor (docs/TELAS.md §23; contrato §2 "update").

   O APK da versão atual fica versionado em server/assets/telas-app/ (Telas.apk + latest.json, escritos por
   scripts/telas-app-publicar.mjs a partir do build do android/), e vai junto na imagem (o Dockerfile copia server/).
     GET /telas/app/latest.json   { versionCode, versionName, sha256, bytes, url }
     GET /telas/app/latest.apk    o arquivo (application/vnd.android.package-archive)
   O `update` do /api/telas/config aponta para ele quando a prefeitura não definiu outro no padrão dela; o app só instala
   se o versionCode for maior que o dele e o SHA-256 conferir. Sem os arquivos (ou com o latest.json torto), nada disso
   aparece e o resto segue igual. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { zipSimples } from './zip-simples.js';

export const APP_DIR = process.env.TELAS_APP_DIR || path.join(config.root, 'server', 'assets', 'telas-app'); // TELAS_APP_DIR: nos testes
export const APK_NAME = 'Telas.apk';
const MAX_BYTES = 200 * 1024 * 1024;

/**
 * Lê o latest.json e confere o APK (tamanho e SHA-256, uma vez por mtime). null se faltar algo ou não conferir.
 * { versionCode, versionName, sha256, bytes, file }
 */
/** O kit do pendrive das TVs Philips (GET /telas/app/philips-pendrive.zip): INSTALAR.bat, o script e o LEIA-ME, mais o APK. */
export const KIT_PHILIPS = path.join(config.root, 'server', 'assets', 'instaladores', 'philips');
const KIT_ARQS = ['INSTALAR.bat', 'instalar-philips.ps1', 'LEIA-ME.txt'];

export function createAppStore({ dir = APP_DIR, kitDir = KIT_PHILIPS } = {}) {
  let cache = null; // { key, value }
  function latest() {
    try {
      const meta = path.join(dir, 'latest.json');
      const apk = path.join(dir, APK_NAME);
      const sm = fs.statSync(meta); const sa = fs.statSync(apk);
      const key = `${sm.mtimeMs}:${sa.mtimeMs}:${sa.size}`;
      if (cache?.key === key) return cache.value;
      const j = JSON.parse(fs.readFileSync(meta, 'utf8'));
      let value = null;
      const code = Number(j.versionCode);
      const sha = String(j.sha256 || '').toLowerCase();
      if (Number.isInteger(code) && code > 0 && /^[0-9a-f]{64}$/.test(sha) && sa.size > 0 && sa.size <= MAX_BYTES && Number(j.bytes) === sa.size) {
        const real = createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
        if (real === sha) value = { versionCode: code, versionName: String(j.versionName || '').slice(0, 20), sha256: sha, bytes: sa.size, file: apk };
        else console.warn('[telas] app: o SHA-256 do APK não confere com o latest.json; atualização pelo servidor desligada');
      }
      cache = { key, value };
      return value;
    } catch {
      return null;
    }
  }
  /** O endereço público do APK (o ?v= troca a cada versão: o CDN não guarda a anterior). */
  const urlOf = (base, l) => `${String(base).replace(/\/+$/, '')}/telas/app/latest.apk?v=${l.versionCode}`;
  /** O `update` do contrato a partir do APK do servidor (null sem APK). */
  function update(base) {
    const l = latest();
    return l ? { url: urlOf(base, l), sha256: l.sha256, versionCode: l.versionCode } : null;
  }
  /** Para o painel: a versão disponível. */
  function info(base) {
    const l = latest();
    return l ? { versionCode: l.versionCode, versionName: l.versionName, sha256: l.sha256, bytes: l.bytes, url: urlOf(base, l) } : null;
  }
  function mount(app, { publicUrl }) {
    app.get('/telas/app/latest.json', (req, res) => {
      res.set('Cache-Control', 'no-cache');
      const i = info(publicUrl(req));
      if (!i) return res.status(404).json({ error: 'Nenhum APK do app das telas neste servidor.' });
      res.json(i);
    });
    app.get('/telas/app/latest.apk', (req, res) => {
      const l = latest();
      if (!l) return res.status(404).json({ error: 'Nenhum APK do app das telas neste servidor.' });
      res.set('Content-Type', 'application/vnd.android.package-archive');
      res.set('Content-Disposition', `attachment; filename="Telas-${l.versionName || l.versionCode}.apk"`);
      res.set('Cache-Control', 'public, max-age=300');
      res.set('ETag', `"${l.sha256}"`);
      res.sendFile(l.file);
    });
    // o kit do pendrive para TV Philips (Android TV / Google TV): o APK mais novo + o passo a passo, num ZIP montado na hora
    app.get('/telas/app/philips-pendrive.zip', (req, res) => {
      const z = kitPhilips();
      if (!z) return res.status(404).json({ error: 'Nenhum APK do app das telas neste servidor.' });
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="DIGITAL-ISP-Philips-pendrive-${z.versionName || z.versionCode}.zip"`);
      res.set('Cache-Control', 'public, max-age=300');
      res.set('ETag', `"${z.etag}"`);
      res.send(z.buf);
    });
  }
  let kit = null; // { key, value }: o ZIP guardado enquanto o APK e o leia-me não mudam
  function kitPhilips() {
    const l = latest();
    if (!l) return null;
    try {
      // os textos vão com fim de linha do Windows; o LEIA-ME com BOM (acentos certos no Bloco de Notas)
      const txts = KIT_ARQS.map((n) => [n, fs.readFileSync(path.join(kitDir, n), 'utf8').replace(/^\ufeff/, '').replace(/\r?\n/g, '\r\n')]);
      const key = `${l.sha256.slice(0, 20)}-${createHash('sha256').update(txts.map((x) => x[1]).join('\0')).digest('hex').slice(0, 12)}`;
      if (kit?.key === key) return kit.value;
      const buf = zipSimples([
        { name: 'DIGITAL-ISP-Telas.apk', data: fs.readFileSync(l.file) },
        ...txts.map(([name, t]) => ({ name, data: Buffer.from(name.endsWith('.txt') ? `﻿${t}` : t, 'utf8') })),
      ]);
      kit = { key, value: { buf, versionCode: l.versionCode, versionName: l.versionName, etag: key } };
      return kit.value;
    } catch {
      return null;
    }
  }
  return { latest, update, info, mount };
}
