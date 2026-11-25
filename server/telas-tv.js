/* DIGITAL ISP: os pacotes que o instalador pelo celular baixa (apps-celular/instalador).

   - App de tela das TVs Samsung (.wgt) e LG (.ipk): server/assets/telas-tv/ (latest.json + os dois arquivos, escritos
     por scripts/telas-tv-publicar.mjs a partir de C:\Projetos\digital-isp-pacotes\tv-<versão>).
       GET /telas/tv/latest.json   { tizen: { version, appId, sha256, bytes, file, url }, webos: { ... } }
       GET /telas/tv/latest.wgt    o pacote Samsung
       GET /telas/tv/latest.ipk    o pacote LG
   - O próprio instalador (APK do celular do técnico): server/assets/instalador/ (latest.json + o APK, escritos por
     scripts/instalador-publicar.mjs).
       GET /instalador/latest.json { versionCode, versionName, sha256, bytes, url }
       GET /instalador/latest.apk  (e /instalador, que leva ao arquivo)
   O APK do app Android das TV box continua em server/telas-app.js (/telas/app/latest.*).
   Cada arquivo só é oferecido se o tamanho e o SHA-256 conferirem com o latest.json (conferido uma vez por mtime). */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from './config.js';

export const TV_DIR = process.env.TELAS_TV_DIR || path.join(config.root, 'server', 'assets', 'telas-tv'); // TELAS_TV_DIR: nos testes
export const INSTALADOR_DIR = process.env.INSTALADOR_DIR || path.join(config.root, 'server', 'assets', 'instalador');
const MAX_BYTES = 200 * 1024 * 1024;
const NOME = /^[A-Za-z0-9_.-]{1,100}$/;
const SHA = /^[0-9a-f]{64}$/;

/** Lê e confere uma entrada { file, sha256, bytes, ... } de um latest.json. null se faltar algo ou não conferir. */
function conferir(dir, e, cache, rotulo) {
  if (!e || typeof e !== 'object' || !NOME.test(String(e.file || ''))) return null;
  const arq = path.join(dir, e.file);
  let st;
  try { st = fs.statSync(arq); } catch { return null; }
  const sha = String(e.sha256 || '').toLowerCase();
  if (!SHA.test(sha) || st.size <= 0 || st.size > MAX_BYTES || Number(e.bytes) !== st.size) return null;
  const chave = `${arq}:${st.mtimeMs}:${st.size}`;
  if (!cache.has(chave)) {
    const real = createHash('sha256').update(fs.readFileSync(arq)).digest('hex');
    if (real !== sha) console.warn(`[telas-tv] ${rotulo}: o SHA-256 de ${e.file} não confere com o latest.json; não será oferecido`);
    cache.set(chave, real === sha);
  }
  return cache.get(chave) ? { ...e, sha256: sha, bytes: st.size, arquivo: arq } : null;
}

function lerJson(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8')); } catch { return null; }
}

const base = (b) => String(b).replace(/\/+$/, '');
const curto = (s, n) => String(s || '').slice(0, n);

/** Os pacotes de TV (Samsung e LG). */
export function createTvStore({ dir = TV_DIR } = {}) {
  const cache = new Map();
  function latest() {
    const j = lerJson(dir);
    if (!j) return null;
    const tizen = conferir(dir, j.tizen, cache, 'tizen');
    const webos = conferir(dir, j.webos, cache, 'webos');
    return tizen || webos ? { tizen, webos } : null;
  }
  const dto = (e, url) => e && ({ version: curto(e.version, 20), appId: curto(e.appId, 80), sha256: e.sha256, bytes: e.bytes, file: e.file, url });
  function info(b) {
    const l = latest();
    if (!l) return null;
    return {
      tizen: dto(l.tizen, l.tizen && `${base(b)}/telas/tv/latest.wgt?v=${encodeURIComponent(l.tizen.sha256.slice(0, 12))}`) || null,
      webos: dto(l.webos, l.webos && `${base(b)}/telas/tv/latest.ipk?v=${encodeURIComponent(l.webos.sha256.slice(0, 12))}`) || null,
    };
  }
  function mount(app, { publicUrl }) {
    app.get('/telas/tv/latest.json', (req, res) => {
      res.set('Cache-Control', 'no-cache');
      const i = info(publicUrl(req));
      if (!i) return res.status(404).json({ error: 'Nenhum pacote das TVs neste servidor.' });
      res.json(i);
    });
    const servir = (qual, tipo) => (req, res) => {
      const e = latest()?.[qual];
      if (!e) return res.status(404).json({ error: 'Pacote não disponível neste servidor.' });
      res.set('Content-Type', tipo);
      res.set('Content-Disposition', `attachment; filename="${e.file}"`);
      res.set('Cache-Control', 'public, max-age=300');
      res.set('ETag', `"${e.sha256}"`);
      res.sendFile(e.arquivo);
    };
    app.get('/telas/tv/latest.wgt', servir('tizen', 'application/widget'));
    app.get('/telas/tv/latest.ipk', servir('webos', 'application/vnd.debian.binary-package'));
  }
  return { latest, info, mount };
}

/** O APK do instalador pelo celular. */
export function createInstaladorStore({ dir = INSTALADOR_DIR } = {}) {
  const cache = new Map();
  function latest() {
    const j = lerJson(dir);
    const e = conferir(dir, j, cache, 'instalador');
    const code = Number(j?.versionCode);
    return e && Number.isInteger(code) && code > 0 ? { ...e, versionCode: code, versionName: curto(j.versionName, 20) } : null;
  }
  function info(b) {
    const l = latest();
    return l ? { versionCode: l.versionCode, versionName: l.versionName, sha256: l.sha256, bytes: l.bytes, url: `${base(b)}/instalador/latest.apk?v=${l.versionCode}` } : null;
  }
  function mount(app, { publicUrl }) {
    app.get('/instalador/latest.json', (req, res) => {
      res.set('Cache-Control', 'no-cache');
      const i = info(publicUrl(req));
      if (!i) return res.status(404).json({ error: 'O instalador ainda não foi publicado neste servidor.' });
      res.json(i);
    });
    const apk = (req, res) => {
      const l = latest();
      if (!l) return res.status(404).json({ error: 'O instalador ainda não foi publicado neste servidor.' });
      res.set('Content-Type', 'application/vnd.android.package-archive');
      res.set('Content-Disposition', `attachment; filename="DIGITAL-ISP-Instalador-${l.versionName || l.versionCode}.apk"`);
      res.set('Cache-Control', 'public, max-age=300');
      res.set('ETag', `"${l.sha256}"`);
      res.sendFile(l.arquivo);
    };
    app.get('/instalador/latest.apk', apk);
    app.get(['/instalador', '/instalador/'], (req, res) => {
      res.set('Cache-Control', 'no-cache');
      const l = latest();
      if (!l) return res.status(404).json({ error: 'O instalador ainda não foi publicado neste servidor.' });
      res.redirect(302, `/instalador/latest.apk?v=${l.versionCode}`);
    });
  }
  return { latest, info, mount };
}
